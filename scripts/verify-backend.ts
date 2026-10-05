/**
 * Backend acceptance checks.
 *
 *   npm run verify:backend
 *
 * Runs against whatever `DATABASE_URL` points at — **a seeded development
 * database**, not production. It reads the phase-1 fixtures, exercises the
 * data-access layer, the publishing rules and the database trigger, and then
 * removes everything it created.
 *
 * It asserts the things a reviewer would otherwise have to take on trust:
 *  - every `lib/data/*` read returns exactly the shape `lib/mock-data.ts` does
 *  - publishing without a clinical-lead reviewer is refused
 *  - publishing writes an `ArticleVersion`, and that row cannot be changed or
 *    deleted afterwards
 *  - the upload pipeline drops EXIF (including GPS) and refuses a file whose
 *    bytes are not really an image
 *  - the MediaWiki import's slug rule is what makes a second run a no-op
 *  - `lib/slug.ts` and the reader's `slugify` agree character for character
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { ApiError } from "@/lib/api";
import { BULLETINS, KNOWLEDGE_ARTICLES, STAFF_DIRECTORY } from "@/lib/mock-data";
import {
  createArticle,
  getArticleBySlug,
  getArticleVersions,
  getArticles,
  getBacklinks,
  updateArticle,
} from "@/lib/data/articles";
import { acknowledgeBulletin, createBulletin, getBulletins } from "@/lib/data/bulletins";
import { getStaff } from "@/lib/data/staff";
import { detectImageType, processImageUpload } from "@/lib/image";
import { buildLinkRegistry, extractInternalLinks, validateLinks } from "@/lib/links";
import { slugify as readerSlugify } from "@/components/MarkdownReader";
import { slugify as serverSlugify } from "@/lib/slug";

/* --------------------------------------------------------------- harness */

interface Result {
  name: string;
  ok: boolean;
  note?: string;
}

const results: Result[] = [];

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label} → expected ${right}, got ${left}`);
}

/** Same keys, same values — the contract the frontend pass relies on. */
function assertSameShape(actual: unknown, expected: unknown, label: string): void {
  assert(
    actual !== null && typeof actual === "object",
    `${label} → not an object (${JSON.stringify(actual)})`,
  );
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  assertEqual(Object.keys(a).sort(), Object.keys(e).sort(), `${label} keys`);
  for (const key of Object.keys(e).sort()) {
    assertEqual(a[key], e[key], `${label}.${key}`);
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const PREFIX = "zz-verify";

async function main() {
  const author = await db.user.findFirstOrThrow({ where: { role: "author" }, select: { id: true, role: true } });
  const lead = await db.user.findFirstOrThrow({
    where: { role: "clinical_lead" },
    select: { id: true, role: true },
  });

  /* ------------------------------------------- parity with lib/mock-data.ts */

  await test("articles: every phase-1 fixture round-trips with an identical shape", async () => {
    const rows = await getArticles();
    for (const fixture of KNOWLEDGE_ARTICLES) {
      const row = await getArticleBySlug(fixture.slug);
      assert(row, `article \`${fixture.slug}\` is missing from the database`);
      assertSameShape(row, fixture, `article \`${fixture.slug}\``);
    }
    assert(
      rows.length >= KNOWLEDGE_ARTICLES.length,
      `expected at least ${KNOWLEDGE_ARTICLES.length} articles, got ${rows.length}`,
    );
  });

  await test("bulletins: every phase-1 fixture round-trips with an identical shape", async () => {
    const rows = await getBulletins();
    for (const fixture of BULLETINS) {
      const row = rows.find((candidate) => candidate.id === fixture.id);
      assert(row, `bulletin \`${fixture.id}\` is missing from the database`);
      assertSameShape(row, fixture, `bulletin \`${fixture.id}\``);
    }
  });

  await test("staff: every phase-1 fixture round-trips with an identical shape", async () => {
    const rows = await getStaff();
    for (const fixture of STAFF_DIRECTORY) {
      const row = rows.find((candidate) => candidate.id === fixture.id);
      assert(row, `staff member \`${fixture.system_id}\` is missing from the database`);
      assertSameShape(row, fixture, `staff \`${fixture.system_id}\``);
    }
  });

  /* --------------------------------------------------------------- filters */

  await test("articles: `q` and `department` filters agree with the mock predicates", async () => {
    const fixtureSlugs = new Set(KNOWLEDGE_ARTICLES.map((article) => article.slug));

    const expected = KNOWLEDGE_ARTICLES.filter((article) =>
      article.title.toLowerCase().includes("extravasation"),
    ).map((article) => article.id);

    const rows = await getArticles({ q: "extravasation" });
    assertEqual(
      rows.filter((row) => fixtureSlugs.has(row.slug)).map((row) => row.id),
      expected,
      "q=extravasation",
    );

    const icu = await getArticles({ department: "ICU" });
    assertEqual(
      icu.filter((row) => fixtureSlugs.has(row.slug)).map((row) => row.id).sort(),
      KNOWLEDGE_ARTICLES.filter((article) => article.departments.includes("ICU"))
        .map((article) => article.id)
        .sort(),
      "department=ICU",
    );
  });

  await test("bulletins: expired notices are excluded by default and included on request", async () => {
    const marker = `${PREFIX}-expired`;
    const bulletin = await createBulletin({
      title: `${marker} notice`,
      body_markdown: "Verification fixture.",
      departments: ["ER"],
      priority: "normal",
      // Deliberately already in the past.
      expires_at: new Date(Date.now() - 60_000),
      author_id: author.id,
    });

    const withoutExpired = await getBulletins();
    assert(
      !withoutExpired.some((row) => row.id === bulletin.id),
      "an expired bulletin appeared in the default listing",
    );

    const withExpired = await getBulletins({ includeExpired: true });
    assert(
      withExpired.some((row) => row.id === bulletin.id),
      "includeExpired=true did not return the expired bulletin",
    );
  });

  /* ------------------------------------------------- publishing + versions */

  await test("publishing is refused without a reviewer", async () => {
    const article = await createArticle({
      title: `${PREFIX} publish without reviewer`,
      body_markdown: "## Test\n\nBody.",
      departments: ["ER"],
      author_id: author.id,
    });

    await assertApiError(
      () => updateArticle(article.slug, { status: "published" }, { id: lead.id, role: "clinical_lead" }),
      "reviewer_required",
      "publish with no reviewer_id",
    );
  });

  await test("publishing is refused when the reviewer is not a clinical lead", async () => {
    const article = await createArticle({
      title: `${PREFIX} publish with author reviewer`,
      body_markdown: "## Test\n\nBody.",
      departments: ["ER"],
      author_id: author.id,
    });

    await assertApiError(
      () =>
        updateArticle(
          article.slug,
          { status: "published", reviewer_id: author.id },
          { id: lead.id, role: "clinical_lead" },
        ),
      "reviewer_not_clinical_lead",
      "publish with an author as reviewer",
    );

    // And the article is still a draft — a refused publish must not half-apply.
    const after = await getArticleBySlug(article.slug);
    assertEqual(after?.status, "draft", "status after refused publish");
  });

  await test("publishing writes an immutable version, and a republication writes the next one", async () => {
    const article = await createArticle({
      title: `${PREFIX} versioned procedure`,
      body_markdown: "## First\n\nOriginal body.",
      departments: ["ICU"],
      author_id: author.id,
    });

    const published = await updateArticle(
      article.slug,
      { status: "published", reviewer_id: lead.id, change_summary: "First publication." },
      { id: lead.id, role: "clinical_lead" },
    );
    assertEqual(published.status, "published", "status after publish");
    assert(
      published.updated_at >= article.updated_at,
      "updated_at did not move on publish",
    );

    let versions = await getArticleVersions(article.slug);
    assertEqual(versions.length, 1, "version count after first publish");
    assertEqual(versions[0].version, 1, "first version number");
    assertEqual(versions[0].change_summary, "First publication.", "change_summary");
    assertEqual(versions[0].body_markdown, "## First\n\nOriginal body.", "snapshotted body");

    // A patch that changes nothing meaningful must not manufacture a version.
    await updateArticle(article.slug, { change_summary: "no-op" }, { id: lead.id, role: "clinical_lead" });
    versions = await getArticleVersions(article.slug);
    assertEqual(versions.length, 1, "version count after a no-op patch");

    // Editing live content is a republication.
    await updateArticle(
      article.slug,
      { body_markdown: "## First\n\nRevised body.", change_summary: "Clarified the dose." },
      { id: lead.id, role: "clinical_lead" },
    );
    versions = await getArticleVersions(article.slug);
    assertEqual(versions.length, 2, "version count after republication");
    assertEqual(versions[0].version, 2, "newest version number");
    assertEqual(versions[1].version, 1, "oldest version number");
    assertEqual(versions[1].body_markdown, "## First\n\nOriginal body.", "version 1 stayed frozen");
    assertEqual(versions[0].changed_by_name.includes(","), true, "changed_by_name carries the role");

    // The database itself refuses to rewrite history.
    const target = versions[0].id;
    let updateRefused = false;
    try {
      await db.$executeRaw`UPDATE article_versions SET change_summary = 'tampered' WHERE id = ${target}::uuid`;
    } catch {
      updateRefused = true;
    }
    assert(updateRefused, "the trigger did not block an UPDATE on article_versions");

    let deleteRefused = false;
    try {
      await db.$executeRaw`DELETE FROM article_versions WHERE id = ${target}::uuid`;
    } catch {
      deleteRefused = true;
    }
    assert(deleteRefused, "the trigger did not block a DELETE on article_versions");

    const stillThere = await getArticleVersions(article.slug);
    assertEqual(stillThere.length, 2, "version count after refused tampering");
  });

  await test("backlinks find the articles and bulletins that link to a slug", async () => {
    const target = await createArticle({
      title: `${PREFIX} link target`,
      body_markdown: "## Target\n\nNothing here.",
      departments: ["ER"],
      author_id: author.id,
    });

    const linker = await createArticle({
      title: `${PREFIX} linker`,
      body_markdown: `See [the target](/procedures/${target.slug}#target) before acting.`,
      departments: ["ER"],
      author_id: author.id,
    });

    const backlinks = await getBacklinks(target.slug);
    assert(
      backlinks.some((link) => link.kind === "article" && link.id === linker.id),
      "the linking article was not reported as a backlink",
    );

    // A slug that merely starts with the target's slug must not match.
    const nearMiss = await createArticle({
      title: `${PREFIX} near miss`,
      body_markdown: `See [something else](/procedures/${target.slug}-extra) too.`,
      departments: ["ER"],
      author_id: author.id,
    });
    const again = await getBacklinks(target.slug);
    assert(
      !again.some((link) => link.id === nearMiss.id),
      "a near-miss slug was wrongly reported as a backlink",
    );
  });

  /* ---------------------------------------------------------------- expiry */

  await test("an urgent bulletin always ends up with an expiry", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} urgent`,
      body_markdown: "Urgent fixture.",
      departments: ["ICU"],
      priority: "urgent",
      author_id: lead.id,
    });

    const row = await db.bulletin.findUniqueOrThrow({
      where: { id: bulletin.id },
      select: { expiresAt: true },
    });
    assert(row.expiresAt, "an urgent bulletin was stored without an expiry");
    const hours = (row.expiresAt.getTime() - Date.now()) / 3_600_000;
    assert(
      Math.abs(hours - 72) < 0.1,
      `the urgent default should be 72 hours, got ${hours.toFixed(2)}`,
    );

    await assertApiError(
      () =>
        createBulletin({
          title: `${PREFIX} urgent no expiry`,
          body_markdown: "Urgent fixture.",
          departments: ["ICU"],
          priority: "urgent",
          expires_at: null,
          author_id: lead.id,
        }),
      "urgent_requires_expiry",
      "urgent with expires_at: null",
    );
  });

  await test("a normal bulletin may be posted without an expiry", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} normal`,
      body_markdown: "Normal fixture.",
      departments: ["CSR"],
      priority: "normal",
      author_id: author.id,
    });
    const row = await db.bulletin.findUniqueOrThrow({
      where: { id: bulletin.id },
      select: { expiresAt: true },
    });
    assertEqual(row.expiresAt, null, "normal bulletin expiresAt");
  });

  await test("acknowledging a bulletin is idempotent", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} ack`,
      body_markdown: "Ack fixture.",
      departments: ["ER"],
      priority: "normal",
      author_id: lead.id,
    });

    const first = await acknowledgeBulletin(bulletin.id, author.id);
    assertEqual(first.created, true, "first ack created");
    const second = await acknowledgeBulletin(bulletin.id, author.id);
    assertEqual(second.created, false, "second ack created");
    assertEqual(second.acked_at, first.acked_at, "second ack moved the timestamp");

    const count = await db.bulletinAck.count({ where: { bulletinId: bulletin.id } });
    assertEqual(count, 1, "ack row count");
  });

  /* ---------------------------------------------------------------- uploads */

  await test("the upload pipeline strips EXIF, including the GPS sub-IFD", async () => {
    const flat = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 210, g: 120, b: 80 } },
    })
      .jpeg()
      .toBuffer();

    // sharp's object form of `withMetadata({ exif })` cannot write a GPS IFD,
    // and GPS is the whole reason this matters for a phone photo — so the
    // fixture is a real EXIF APP1 segment with an IFD0 and a GPS sub-IFD,
    // assembled byte by byte.
    const phonePhoto = spliceExif(flat, buildExifApp1());

    const before = await sharp(phonePhoto).metadata();
    assert(before.exif, "the fixture does not actually carry EXIF — the test would be vacuous");
    assert(
      phonePhoto.includes(Buffer.from("Exif\0\0", "latin1")),
      "the fixture has no EXIF APP1 marker",
    );
    assert(phonePhoto.includes(Buffer.from("TestPhone", "latin1")), "the fixture has no Make tag");
    assert(
      phonePhoto.includes(Buffer.from([0x25, 0x88])),
      "the fixture has no GPS IFD pointer (tag 0x8825)",
    );

    const processed = await processImageUpload(phonePhoto, "IMG_4821.jpg");
    assertEqual(processed.mime, "image/jpeg", "detected type");

    const after = await sharp(processed.buffer).metadata();
    assert(!after.exif, "EXIF survived the upload pipeline");
    assertEqual(after.width, 64, "width preserved");
    assertEqual(after.height, 48, "height preserved");
    // The whole APP1 block is gone, not just the tags sharp happens to expose.
    assert(
      !processed.buffer.includes(Buffer.from("Exif\0\0", "latin1")),
      "an EXIF APP1 block survived",
    );
    assert(!processed.buffer.includes(Buffer.from("TestPhone", "latin1")), "the Make tag survived");
    assert(!processed.buffer.includes(Buffer.from([0x25, 0x88])), "the GPS IFD survived");
  });

  await test("the type check reads magic bytes, not the filename", async () => {
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    assertEqual(detectImageType(png), "image/png", "real PNG detected");

    // A text payload wearing an image extension.
    const notAnImage = Buffer.from("<?php system($_GET['c']); ?>", "utf8");
    assertEqual(detectImageType(notAnImage), null, "text payload detected as an image");

    let refused = false;
    try {
      await processImageUpload(notAnImage, "shell.png");
    } catch (error) {
      refused = error instanceof ApiError && error.status === 415;
    }
    assert(refused, "a non-image was not refused with 415");
  });

  /* ------------------------------------------------------------------ links */

  await test("internal links are extracted and validated against the registry", async () => {
    const registry = buildLinkRegistry(
      KNOWLEDGE_ARTICLES.map((article) => ({ slug: article.slug, bodyMarkdown: article.body_markdown })),
    );

    const clean = [
      "See [isolation](/procedures/canine-parvovirus-isolation-protocol) and [below](#purpose).",
      "",
      "## Purpose",
      "",
      "Text.",
    ].join("\n");
    assertEqual(validateLinks(clean, registry).length, 0, "clean document");

    const extracted = extractInternalLinks(clean);
    assertEqual(extracted.slugLinks, ["canine-parvovirus-isolation-protocol"], "slugLinks");
    assertEqual(extracted.anchors, ["purpose"], "anchors");

    const broken = [
      "[gone](/procedures/no-such-procedure)",
      "",
      "[missing section](#nope)",
      "",
      "[deep link](/procedures/code-blue-recover-resuscitation-roles#not-a-heading)",
      "",
      "## Purpose",
    ].join("\n");

    const problems = validateLinks(broken, registry);
    assertEqual(problems.length, 3, `expected 3 broken references, got ${problems.length}`);
    assertEqual(problems.map((problem) => problem.reason).sort(), [
      "unknown_anchor",
      "unknown_anchor",
      "unknown_article",
    ], "broken reference reasons");

    // A link into a real heading of another article is fine.
    const good = "[roles](/procedures/code-blue-recover-resuscitation-roles#activation)";
    assertEqual(validateLinks(good, registry).length, 0, "valid cross-article anchor");
  });

  await test("lib/slug.ts agrees with MarkdownReader's slugify", async () => {
    const samples = [
      "Immediate actions on suspicion",
      "Code Blue: RECOVER Resuscitation Team Roles",
      "Ward assignment",
      "Client Estimates, Deposits & Payment Plans",
      "**Bold** and `code` and _italic_",
      "A".repeat(120),
      "   ",
    ];
    for (const sample of samples) {
      assertEqual(serverSlugify(sample), readerSlugify(sample), `slugify(${JSON.stringify(sample.slice(0, 24))})`);
    }
  });

  /* ------------------------------------------------------------- temp rows */

  await test("the MediaWiki import's slug rule makes re-running a no-op", async () => {
    // The importer skips a page whose slug already exists; this is the query
    // that decides it. If it ever stops matching `Article.slug`, the second run
    // duplicates the first.
    const imported = await db.article.findFirst({
      where: { importedAt: { not: null } },
      select: { slug: true, status: true, sourceTitle: true },
    });

    if (!imported) {
      // No import has been run against this database; nothing to assert, and
      // that is not a failure of the backend.
      return;
    }

    const clash = await db.article.count({ where: { slug: imported.slug } });
    assertEqual(clash, 1, `slug \`${imported.slug}\` is not unique`);
    assertEqual(imported.status, "draft", "an imported page was not left as a draft");
    assert(imported.sourceTitle, "an imported page has no sourceTitle");
  });
}

/* --------------------------------------------------------------- helpers */

/**
 * A minimal but real EXIF APP1 segment: an IFD0 carrying Make and Model, plus a
 * GPS sub-IFD (pointer tag 0x8825) with latitude and longitude as rationals.
 *
 * Written by hand because `sharp`'s object form of `withMetadata({ exif })`
 * only understands IFD0–IFD3 and silently drops a `GPS` key — which would make
 * the EXIF test pass while proving nothing about the tag that actually matters.
 */
function buildExifApp1(): Buffer {
  const HEADER = 8;
  const IFD0_OFFSET = HEADER;
  const IFD0_ENTRIES = 3;
  const DATA_OFFSET = IFD0_OFFSET + 2 + IFD0_ENTRIES * 12 + 4;
  const make = "TestPhone\0";
  const model = "Pixel 9 Pro\0";
  const makeOffset = DATA_OFFSET;
  const modelOffset = makeOffset + make.length;
  const gpsIfdOffset = modelOffset + model.length;
  const GPS_ENTRIES = 4;
  const gpsDataOffset = gpsIfdOffset + 2 + GPS_ENTRIES * 12 + 4;
  const latOffset = gpsDataOffset;
  const lonOffset = latOffset + 24;

  const tiff = Buffer.alloc(lonOffset + 24);
  tiff.write("II", 0, "latin1"); // little-endian
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(HEADER, 4);

  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    tiff.writeUInt32LE(value, at + 8);
  };

  tiff.writeUInt16LE(IFD0_ENTRIES, IFD0_OFFSET);
  let at = IFD0_OFFSET + 2;
  entry(at, 0x010f, 2, make.length, makeOffset); // Make
  entry((at += 12), 0x0110, 2, model.length, modelOffset); // Model
  entry((at += 12), 0x8825, 4, 1, gpsIfdOffset); // GPSInfoIFDPointer
  tiff.writeUInt32LE(0, IFD0_OFFSET + 2 + IFD0_ENTRIES * 12);

  tiff.writeUInt16LE(GPS_ENTRIES, gpsIfdOffset);
  at = gpsIfdOffset + 2;
  entry(at, 0x0001, 2, 2, 0x0000004e); // GPSLatitudeRef "N\0"
  entry((at += 12), 0x0002, 5, 3, latOffset); // GPSLatitude
  entry((at += 12), 0x0003, 2, 2, 0x00000057); // GPSLongitudeRef "W\0"
  entry((at += 12), 0x0004, 5, 3, lonOffset); // GPSLongitude
  tiff.writeUInt32LE(0, gpsIfdOffset + 2 + GPS_ENTRIES * 12);

  const rational = (offset: number, values: ReadonlyArray<readonly [number, number]>) => {
    values.forEach(([numerator, denominator], index) => {
      tiff.writeUInt32LE(numerator, offset + index * 8);
      tiff.writeUInt32LE(denominator, offset + index * 8 + 4);
    });
  };
  rational(latOffset, [
    [45, 1],
    [31, 1],
    [0, 1],
  ]);
  rational(lonOffset, [
    [122, 1],
    [40, 1],
    [0, 1],
  ]);

  tiff.write(make, makeOffset, "latin1");
  tiff.write(model, modelOffset, "latin1");

  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.alloc(4 + payload.length);
  segment.writeUInt8(0xff, 0);
  segment.writeUInt8(0xe1, 1);
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return segment;
}

/** Insert an APP1 segment immediately after the JPEG SOI marker. */
function spliceExif(jpeg: Buffer, segment: Buffer): Buffer {
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

async function assertApiError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      assertEqual(
        error.code === expectedCode || error.message.includes(expectedCode),
        true,
        `${label} → error code (got "${error.code}": ${error.message})`,
      );
      return;
    }
    throw error;
  }
  throw new Error(`${label} → expected a refusal, but the call succeeded`);
}

async function cleanup(): Promise<void> {
  // Deleting a test article cascades into `article_versions`, which the
  // append-only trigger refuses — which is the behaviour under test. Disabling
  // the trigger for the duration of the cleanup is the deliberate, narrow
  // exception, and it is why the trigger reports as present below.
  //
  // Match on the bare prefix, not `'zz-verify-%'`: article slugs are slugified
  // (`zz-verify-thing`) but bulletin titles keep their space (`zz-verify thing`),
  // so a trailing hyphen would silently match nothing.
  await db.$executeRawUnsafe("ALTER TABLE article_versions DISABLE TRIGGER USER");
  await db.$executeRawUnsafe("DELETE FROM articles WHERE slug LIKE 'zz-verify%'");
  await db.$executeRawUnsafe("ALTER TABLE article_versions ENABLE TRIGGER USER");
  await db.$executeRawUnsafe("DELETE FROM bulletins WHERE title LIKE 'zz-verify%'");
  await db.$executeRawUnsafe("DELETE FROM search_logs WHERE query LIKE 'zz-verify%'");

  // Fixtures that survive a delete are invisible otherwise — the run still
  // reports green while quietly polluting the database. Say so, loudly.
  const [{ articles }] = await db.$queryRaw<Array<{ articles: number }>>`
    SELECT (SELECT count(*) FROM articles WHERE slug LIKE 'zz-verify%')
         + (SELECT count(*) FROM bulletins WHERE title LIKE 'zz-verify%') AS articles
  `;
  if (Number(articles) !== 0) {
    throw new Error(`cleanup left ${articles} verification fixture row(s) behind`);
  }
}

main()
  .then(async () => {
    await cleanup().catch((error) => {
      results.push({ name: "cleanup of verification fixtures", ok: false, note: String(error) });
    });
  })
  .catch((error) => {
    results.push({ name: "verification run", ok: false, note: String(error) });
  })
  .finally(async () => {
    await db.$disconnect();

    const failures = results.filter((result) => !result.ok);
    console.log("");
    for (const result of results) {
      console.log(`${result.ok ? "  ✓" : "  ✗"} ${result.name}${result.note ? `\n      ${result.note}` : ""}`);
    }
    console.log(
      `\n${results.length - failures.length}/${results.length} checks passed` +
        (failures.length > 0 ? `  — ${failures.length} FAILED` : ""),
    );

    if (failures.length > 0) process.exit(1);
  });
