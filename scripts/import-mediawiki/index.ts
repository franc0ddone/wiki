/**
 * MediaWiki → Dove Wiki importer.
 *
 *   npm run import:mediawiki -- path/to/dump.xml [--dry-run] [--limit N]
 *
 * Reads a MediaWiki XML export, converts each content page's wikitext to
 * markdown, and inserts it as an **Article with `status: "draft"`** plus
 * `sourceTitle` / `importedAt` provenance. A hospital's existing wiki lands as
 * drafts for the clinical leads to review — nothing imported is ever published
 * automatically.
 *
 * Two rules the design leans on:
 *
 *  1. **Wikitext is converted by `pandoc`, not by us.** Hand-rolling a wikitext
 *     parser is a trap: templates, parser functions, magic words, and the
 *     dozens of dialect quirks mean an approximate parser produces silently
 *     wrong clinical content. If `pandoc` is not on PATH this exits immediately
 *     with instructions instead of importing something subtly mangled.
 *     (`pandoc -f mediawiki -t gfm` is the conversion.)
 *
 *  2. **Slugs are the idempotency key.** A page whose slug already exists is
 *     skipped, so re-running against the same dump — or a newer dump that still
 *     contains the old pages — imports only what is new. `Article` is never
 *     overwritten or duplicated.
 *
 * XML is parsed with `fast-xml-parser`; only pages in the main namespace are
 * considered, and redirects (`#REDIRECT`) are counted as skipped.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

import { XMLParser } from "fast-xml-parser";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";

/* ------------------------------------------------------------------- args */

interface Options {
  dumpPath: string;
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: readonly string[]): Options {
  const positional: string[] = [];
  let dryRun = false;
  let limit: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--limit") {
      const raw = argv[index + 1];
      const value = Number(raw);
      if (!Number.isInteger(value) || value <= 0) {
        fail(`--limit needs a positive integer (got ${raw ?? "nothing"}).`);
      }
      limit = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      fail(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length !== 1) {
    fail(
      "Usage: npm run import:mediawiki -- <dump.xml> [--dry-run] [--limit N]\n" +
        "  <dump.xml>  a MediaWiki XML export (Special:Export, or a pages-articles dump)",
    );
  }

  return { dumpPath: positional[0], dryRun, limit };
}

function fail(message: string): never {
  console.error(`\n[import-mediawiki] ${message}\n`);
  process.exit(1);
}

/* ----------------------------------------------------------------- pandoc */

const PANDOC_ARGS = ["-f", "mediawiki", "-t", "gfm", "--wrap=none"];

function assertPandocAvailable(): void {
  const probe = spawnSync("pandoc", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    const detail = probe.error ? ` (${probe.error.message})` : "";
    fail(
      `pandoc is required to convert wikitext and was not found on PATH${detail}.\n` +
        "  Install it and re-run:\n" +
        "    macOS         brew install pandoc\n" +
        "    Debian/Ubuntu sudo apt-get install pandoc\n" +
        "  This importer will not fall back to a hand-written wikitext parser — an\n" +
        "  approximate conversion of clinical content is worse than no import.",
    );
  }
}

function wikitextToMarkdown(wikitext: string): string {
  const result = spawnSync("pandoc", PANDOC_ARGS, { input: wikitext, encoding: "utf8" });
  if (result.error) {
    throw new Error(`pandoc could not be executed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pandoc exited ${result.status}: ${(result.stderr ?? "").trim().split("\n")[0]}`);
  }
  return (result.stdout ?? "").replace(/\r\n/g, "\n").trim();
}

/* -------------------------------------------------------------------- xml */

interface WikiPage {
  title: string;
  namespace: number;
  wikitext: string | null;
  isRedirect: boolean;
}

function readPages(xml: string): WikiPage[] {
  const parser = new XMLParser({
    // `<text xml:space="preserve">` — the attribute is irrelevant, and keeping
    // it would turn the element into an object we then have to unwrap.
    ignoreAttributes: true,
    // Wikitext is whitespace-significant (indentation = preformatted blocks).
    trimValues: false,
    parseTagValue: false,
    processEntities: true,
  });

  const parsed = parser.parse(xml) as {
    mediawiki?: { page?: unknown };
  };

  const rawPages = asArray(parsed.mediawiki?.page);
  return rawPages.map((raw) => {
    const page = raw as {
      title?: unknown;
      ns?: unknown;
      revision?: unknown;
      redirect?: unknown;
    };

    const title = typeof page.title === "string" ? page.title : String(page.title ?? "").trim();
    const namespace = Number(page.ns ?? 0) || 0;

    // A page may carry several revisions; the export contains the current one.
    const revisions = asArray(page.revision);
    let wikitext: string | null = null;
    for (const revision of revisions) {
      const text = (revision as { text?: unknown })?.text;
      if (typeof text === "string") wikitext = text;
      else if (text && typeof text === "object" && "#text" in (text as object)) {
        wikitext = String((text as { "#text": unknown })["#text"]);
      }
    }

    return {
      title,
      namespace,
      wikitext,
      isRedirect: /^\s*#redirect/i.test(wikitext ?? ""),
    };
  });
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/* ------------------------------------------------------------------- main */

const IMPORT_AUTHOR_EMAIL = "mediawiki-import@dove-wiki.local";

async function main() {
  const options = parseArgs(process.argv.slice(2));

  assertPandocAvailable();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    fail("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  let xml: string;
  try {
    xml = readFileSync(options.dumpPath, "utf8");
  } catch (error) {
    fail(`Could not read ${options.dumpPath}: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const allPages = readPages(xml);
  const pages = allPages.filter((page) => page.namespace === 0);
  console.log(
    `[import-mediawiki] ${options.dumpPath}\n` +
      `  ${allPages.length} page(s) in the dump, ${pages.length} in the main namespace` +
      `${options.limit ? `, limited to ${options.limit}` : ""}${options.dryRun ? " (dry run)" : ""}`,
  );

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // A single service account owns everything imported, so the drafts are
    // attributable and visible in the same review queue as authored work.
    const author = await prisma.user.upsert({
      where: { email: IMPORT_AUTHOR_EMAIL },
      update: {},
      create: {
        email: IMPORT_AUTHOR_EMAIL,
        name: "MediaWiki Import",
        title: null,
        role: "author",
        // No local password: nothing signs in as the importer.
        passwordHash: null,
      },
      select: { id: true },
    });

    const existingSlugs = new Set(
      (await prisma.article.findMany({ select: { slug: true } })).map((row) => row.slug),
    );

    const imported: string[] = [];
    const skipped: Array<{ title: string; reason: string }> = [];
    const failed: Array<{ title: string; reason: string }> = [];

    const queue = options.limit ? pages.slice(0, options.limit) : pages;

    for (const page of queue) {
      const label = page.title || "(untitled page)";

      if (!page.title.trim()) {
        failed.push({ title: label, reason: "page has no title" });
        continue;
      }
      if (page.isRedirect) {
        skipped.push({ title: label, reason: "redirect" });
        continue;
      }
      if (page.wikitext === null) {
        failed.push({ title: label, reason: "no revision text in the dump" });
        continue;
      }

      const slug = slugify(page.title) || "untitled";
      if (existingSlugs.has(slug)) {
        skipped.push({ title: label, reason: `slug already exists (${slug})` });
        continue;
      }

      let markdown: string;
      try {
        markdown = wikitextToMarkdown(page.wikitext);
      } catch (error) {
        failed.push({
          title: label,
          reason: error instanceof Error ? error.message : "pandoc conversion failed",
        });
        continue;
      }

      if (options.dryRun) {
        imported.push(label);
        existingSlugs.add(slug);
        continue;
      }

      try {
        await prisma.article.create({
          data: {
            slug,
            title: page.title,
            bodyMarkdown: markdown,
            // Departments are a clinical judgement; the import never guesses.
            departments: [],
            status: "draft",
            authorId: author.id,
            updatedAt: new Date(),
            sourceTitle: page.title,
            importedAt: new Date(),
          },
        });
        existingSlugs.add(slug);
        imported.push(label);
      } catch (error) {
        failed.push({
          title: label,
          reason: error instanceof Error ? error.message : "database insert failed",
        });
      }
    }

    /* ------------------------------------------------------------- summary */

    const line = (heading: string, entries: readonly string[]) =>
      `  ${heading}: ${entries.length}${entries.length > 0 ? `\n${entries.map((entry) => `    - ${entry}`).join("\n")}` : ""}`;

    console.log(
      [
        options.dryRun ? "[import-mediawiki] dry run — nothing was written." : "[import-mediawiki] done.",
        line("imported", imported),
        line(
          "skipped",
          skipped.map((entry) => `${entry.title} (${entry.reason})`),
        ),
        line(
          "failed",
          failed.map((entry) => `${entry.title} (${entry.reason})`),
        ),
      ].join("\n"),
    );

    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[import-mediawiki] fatal:", error);
  process.exit(1);
});
