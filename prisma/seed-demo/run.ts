/**
 * Demo reset — the command-line entry point.
 *
 *   npm run seed:demo:clear   phase 1: wipe content (accounts untouched)
 *   npm run seed:demo         phase 2: load the fictional demo content
 *   npm run seed:demo:reset   both, in order
 *
 * The npm scripts are thin wrappers around this file, so the same three
 * operations are available directly when a wrapper is inconvenient:
 *
 *   npx tsx prisma/seed-demo/run.ts --clear
 *   npx tsx prisma/seed-demo/run.ts          (--seed is the default)
 *   npx tsx prisma/seed-demo/run.ts --reset
 */
import { clearContent } from "./clear";
import { runScript, type SeedClient } from "./client";
import { seedDemo } from "./seed";

type Mode = "clear" | "seed" | "reset";

function parseMode(argv: readonly string[]): Mode {
  const flags = argv.filter((argument) => argument.startsWith("--"));
  const unknown = flags.filter(
    (flag) => flag !== "--clear" && flag !== "--seed" && flag !== "--reset",
  );
  if (unknown.length > 0) {
    console.error(`Unknown option(s): ${unknown.join(", ")}. Use --clear, --seed, or --reset.`);
    process.exit(2);
  }
  if (flags.includes("--clear") && flags.includes("--seed")) return "reset";
  if (flags.includes("--clear") || flags.includes("--reset")) return "clear";
  if (flags.includes("--seed")) return "seed";
  return "seed";
}

/** Final row counts, so the run ends with the numbers the brief asks about. */
async function reportTotals(prisma: SeedClient): Promise<void> {
  const [staff, articles, bulletins, versions, attachments] = await Promise.all([
    prisma.staffMember.count(),
    prisma.article.count(),
    prisma.bulletin.count(),
    prisma.articleVersion.count(),
    prisma.bulletinAttachment.count(),
  ]);
  console.log(
    [
      "  totals now:",
      `    staff:       ${staff}`,
      `    articles:    ${articles}`,
      `    versions:    ${versions}`,
      `    bulletins:   ${bulletins}`,
      `    attachments: ${attachments}`,
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  await runScript(`seed:demo:${mode}`, async (prisma) => {
    if (mode === "clear" || mode === "reset") {
      const cleared = await clearContent(prisma);
      console.log(
        [
          "[seed:demo:clear] content wiped — user accounts untouched.",
          `  bulletins:          ${cleared.bulletins}`,
          `  articles:           ${cleared.articles}`,
          `  staged attachments: ${cleared.stagedAttachments}`,
          `  staff members:      ${cleared.staff}`,
        ].join("\n"),
      );
    }

    if (mode === "seed" || mode === "reset") {
      const summary = await seedDemo(prisma);
      console.log(
        [
          "[seed:demo] fictional demo content loaded.",
          `  users created:      ${summary.usersCreated}`,
          `  staff:              ${summary.staff}`,
          `  articles:           ${summary.articles} (+${summary.versionsCreated} initial versions)`,
          `  bulletins:          ${summary.bulletins}`,
          `  attachments:        ${summary.attachments} uploaded, ${summary.attachmentsSkipped} skipped`,
        ].join("\n"),
      );
      await reportTotals(prisma);
    }
  });
}

main();
