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
 *  - publishing is direct: an `author` publishes with no reviewer to name
 *    (prompt 7c removed the review gate), and `in_review` is gone from the
 *    database's own enum
 *  - publishing writes an `ArticleVersion`, and that row cannot be changed or
 *    deleted afterwards
 *  - the newest two versions surface as the feed's version jump, and curating an
 *    Essential SOP or re-scoping its audience writes neither a version nor a
 *    timestamp
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
import { acknowledgeBulletin, createBulletin, getBulletins, requireEditableBulletin } from "@/lib/data/bulletins";
import {
  createBulletinAttachment,
  deleteBulletinAttachment,
  deleteStagedAttachment,
  getBulletinAttachmentForDownload,
  listBulletinAttachments,
  stageBulletinAttachment,
  sweepStagedAttachments,
} from "@/lib/data/bulletin-attachments";
import { ALLOWED_ATTACHMENT_TYPES, assertAttachmentType } from "@/lib/attachments";
import { STAGED_ATTACHMENT_TTL_MS } from "@/lib/bulletin/lifecycle";
import { decideRoleRequest, requestAuthorAccess } from "@/lib/data/role-requests";
import { staffTypeLabel } from "@/lib/staff-type";
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

  await test("an expired pin is unpinned when the board is fetched, not deleted", async () => {
    const marker = `${PREFIX}-expired`;
    const bulletin = await createBulletin({
      title: `${marker} notice`,
      body_markdown: "Verification fixture.",
      departments: ["ER"],
      pinned: true,
      // Deliberately already in the past.
      expires_at: new Date(Date.now() - 60_000),
      author_id: author.id,
    });

    const board = await getBulletins();
    const swept = board.find((row) => row.id === bulletin.id);
    assert(swept, "the expired bulletin was removed from the board");
    assertEqual(swept?.pinned, false, "the expired pin was not lifted");
    assertEqual(swept?.expires_at, null, "the expiry was not cleared");

    const row = await db.bulletin.findUnique({
      where: { id: bulletin.id },
      select: { pinned: true, expiresAt: true },
    });
    assert(row, "the expired bulletin was deleted from the database");
    assertEqual(row?.pinned, false, "the pin was not lifted in the database");
    assertEqual(row?.expiresAt, null, "the expiry was not cleared in the database");
  });

  /* ------------------------------------------------- publishing + versions */

  await test("publishing is direct: no reviewer to name, and `in_review` is gone", async () => {
    // The gate is gone from the database's own enum, not just from the UI.
    const enumValues = await db.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'ArticleStatus'
      ORDER BY enumsortorder
    `;
    assertEqual(
      enumValues.map((row) => row.enumlabel),
      ["draft", "published"],
      "ArticleStatus values",
    );

    const article = await createArticle({
      title: `${PREFIX} publish without reviewer`,
      body_markdown: "## Test\n\nBody.",
      departments: ["ER"],
      author_id: author.id,
    });

    // An `author` — not a clinical lead — publishes their own draft in one call.
    const published = await updateArticle(
      article.slug,
      { status: "published", change_summary: "First publication." },
      { id: author.id, role: "author" },
    );
    assertEqual(published.status, "published", "status after a direct publish");
    assertEqual(published.latest_published_version, 1, "a publish writes version 1");
    assertEqual(published.previous_published_version, null, "there is no previous version yet");
    assertEqual(published.latest_published_by?.includes(","), true, "the publisher is credited");
    // The reviewer column is legacy: nothing writes it any more.
    const row = await db.article.findUniqueOrThrow({
      where: { slug: article.slug },
      select: { reviewerId: true, effectiveDate: true },
    });
    assertEqual(row.reviewerId, null, "reviewer_id is not written by a publish");
    assert(row.effectiveDate, "a publish must stamp an effective date");
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
      { status: "published", change_summary: "First publication." },
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

    // The portal shape carries the two newest versions, which is what the feed's
    // version-jump badge needs (prompt 7c): v1 → v2.
    const afterRepublication = await getArticleBySlug(article.slug);
    assertEqual(afterRepublication?.latest_published_version, 2, "latest published version");
    assertEqual(afterRepublication?.previous_published_version, 1, "previous published version");

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

  await test("curating an Essential SOP is metadata-only: no version, no timestamp move", async () => {
    const article = await createArticle({
      title: `${PREFIX} curatable procedure`,
      body_markdown: "## Curated\n\nBody.",
      departments: ["ER"],
      author_id: author.id,
    });
    const published = await updateArticle(
      article.slug,
      { status: "published", change_summary: "First publication." },
      { id: author.id, role: "author" },
    );

    // Pin it, and re-scope it, exactly as the composer's controls do.
    const curated = await updateArticle(
      article.slug,
      { is_essential: true },
      { id: lead.id, role: "clinical_lead" },
    );
    assertEqual(curated.is_essential, true, "the Essential flag was not stored");
    assertEqual(
      curated.updated_at,
      published.updated_at,
      "curation moved updated_at (it must not: the feed orders on the publish time)",
    );
    assertEqual(
      curated.last_reviewed_at,
      published.last_reviewed_at,
      "curation moved the publish timestamp",
    );

    const rescoped = await updateArticle(
      article.slug,
      { audience: "NON_MEDICAL" },
      { id: author.id, role: "author" },
    );
    assertEqual(rescoped.audience, "NON_MEDICAL", "the audience was not stored");
    assertEqual(rescoped.updated_at, published.updated_at, "re-scoping moved updated_at");

    // A draft stays a draft, whatever its metadata says.
    const draft = await createArticle({
      title: `${PREFIX} curated draft`,
      body_markdown: "## Draft\n\nBody.",
      departments: ["ER"],
      author_id: author.id,
      audience: "MEDICAL",
    });
    assertEqual(draft.status, "draft", "a new procedure must land as a draft");
    assertEqual(draft.audience, "MEDICAL", "the create-time audience was not stored");
    assertEqual(draft.is_essential, false, "a new procedure must not be Essential by default");
    assertEqual(draft.latest_published_version, null, "a draft has no published version");

    const versions = await getArticleVersions(article.slug);
    assertEqual(versions.length, 1, "metadata-only writes must not add a version");
  });

  await test("the approval flow records the staff type it was approved with", async () => {
    const applicant = await db.user.create({
      data: {
        email: `${PREFIX}-applicant@dovelewis.org`,
        name: "Verify Applicant",
        role: "staff",
      },
      select: { id: true, staffType: true },
    });
    assertEqual(applicant.staffType, null, "a fresh account is unassigned");

    const raised = await requestAuthorAccess(applicant.id);
    assertEqual(raised.created, true, "the request was not created");

    const declined = await decideRoleRequest(
      raised.request.id,
      // A decline must not touch the account, even when a type rides along.
      { status: "declined", staff_type: "MEDICAL" },
      { id: lead.id },
    );
    assertEqual(declined.status, "declined", "the request was not declined");
    const untouched = await db.user.findUniqueOrThrow({
      where: { id: applicant.id },
      select: { role: true, staffType: true },
    });
    assertEqual(untouched.role, "staff", "a decline must not promote anybody");
    assertEqual(untouched.staffType, null, "a decline must not classify anybody");

    const again = await requestAuthorAccess(applicant.id);
    const approved = await decideRoleRequest(
      again.request.id,
      { status: "approved", staff_type: "MEDICAL" },
      { id: lead.id },
    );
    assertEqual(approved.status, "approved", "the request was not approved");
    assertEqual(
      approved.user_staff_type,
      "MEDICAL",
      "the summary should carry the new staff type back to the queue",
    );

    const promoted = await db.user.findUniqueOrThrow({
      where: { id: applicant.id },
      select: { role: true, staffType: true },
    });
    assertEqual(promoted.role, "author", "approval did not promote the requester");
    assertEqual(promoted.staffType, "MEDICAL", "approval did not record the staff type");
    assertEqual(staffTypeLabel(promoted.staffType), "Medical", "the label disagrees with the value");

    await db.user.delete({ where: { id: applicant.id } });
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

  await test("a bulletin may be posted urgent or pinned, and neither forces an expiry", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} urgent`,
      body_markdown: "Urgent fixture.",
      departments: ["ICU"],
      urgent: true,
      author_id: lead.id,
    });

    const row = await db.bulletin.findUniqueOrThrow({
      where: { id: bulletin.id },
      select: { urgent: true, pinned: true, expiresAt: true },
    });
    assertEqual(row.urgent, true, "the urgent flag was not stored");
    assertEqual(row.pinned, false, "the pinned flag was not left false");
    assertEqual(row.expiresAt, null, "an urgent bulletin without an explicit expiry must not expire");

    const pinned = await createBulletin({
      title: `${PREFIX} pinned`,
      body_markdown: "Pinned fixture.",
      departments: ["ICU"],
      pinned: true,
      author_id: lead.id,
    });
    const pinnedRow = await db.bulletin.findUniqueOrThrow({
      where: { id: pinned.id },
      select: { pinned: true, urgent: true, expiresAt: true },
    });
    assertEqual(pinnedRow.pinned, true, "the pinned flag was not stored");
    assertEqual(pinnedRow.urgent, false, "the urgent flag was not left false");
    assertEqual(pinnedRow.expiresAt, null, "a pinned bulletin must not expire by default");
  });

  await test("a bulletin may be posted without an expiry", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} normal`,
      body_markdown: "Normal fixture.",
      departments: ["CSR"],
      author_id: author.id,
    });
    const row = await db.bulletin.findUniqueOrThrow({
      where: { id: bulletin.id },
      select: { expiresAt: true },
    });
    assertEqual(row.expiresAt, null, "a bulletin without an explicit expiry must not expire");
  });

  await test("acknowledging a bulletin is idempotent", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} ack`,
      body_markdown: "Ack fixture.",
      departments: ["ER"],
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

  /* ------------------------------------------------------ attachments (6d) */

  await test("a bulletin carries attachments, and one bulletin's id never opens another's file", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} attachment notice`,
      body_markdown: "Attachment fixture.",
      departments: ["ER"],
      author_id: author.id,
    });
    const other = await createBulletin({
      title: `${PREFIX} attachment notice 2`,
      body_markdown: "Attachment fixture.",
      departments: ["ER"],
      author_id: author.id,
    });

    const bytes = Buffer.from("model,code\nCBC,85025\n", "utf8");
    const { mime, extension } = assertAttachmentType(bytes, "panels.csv");
    assertEqual(mime, "text/csv", "a .csv is detected as CSV");
    assertEqual(extension, "csv", "the storage extension follows the detected type");

    const attachment = await createBulletinAttachment({
      bulletin_id: bulletin.id,
      file_name: `panels-${PREFIX}.csv`,
      file_key: `attachments/${PREFIX}/panels.csv`,
      mime_type: mime,
      size_bytes: bytes.length,
      uploaded_by_id: author.id,
    });
    assertEqual(attachment.bulletin_id, bulletin.id, "attachment owner");
    assertEqual(attachment.size_bytes, bytes.length, "attachment size");
    assert(
      !Object.prototype.hasOwnProperty.call(attachment, "file_key"),
      "the client-facing record must not expose the storage key",
    );

    const listed = await listBulletinAttachments(bulletin.id);
    assertEqual(listed.map((entry) => entry.id), [attachment.id], "the bulletin's attachment list");

    const stored = await getBulletinAttachmentForDownload(bulletin.id, attachment.id);
    assertEqual(stored.file_key, `attachments/${PREFIX}/panels.csv`, "the download key");

    // Reading an attachment through a *different* bulletin must not work.
    await assertApiError(
      () => getBulletinAttachmentForDownload(other.id, attachment.id),
      "not_found",
      "an attachment id from another bulletin",
    );

    await deleteBulletinAttachment(bulletin.id, attachment.id);
    const gone = await db.bulletinAttachment.findUnique({ where: { id: attachment.id } });
    assertEqual(gone, null, "the row is gone after delete");
  });

  await test("deleting a bulletin cascades its attachments; deleting the uploader does not", async () => {
    const bulletin = await createBulletin({
      title: `${PREFIX} cascade notice`,
      body_markdown: "Cascade fixture.",
      departments: ["ER"],
      author_id: author.id,
    });
    const attachment = await createBulletinAttachment({
      bulletin_id: bulletin.id,
      file_name: `cascade-${PREFIX}.pdf`,
      file_key: `attachments/${PREFIX}/cascade.pdf`,
      mime_type: assertAttachmentType(Buffer.from("%PDF-1.7\n%%EOF\n", "latin1"), "cascade.pdf").mime,
      size_bytes: 15,
      uploaded_by_id: author.id,
    });

    // The uploader going away must leave the file in place (`SetNull`).
    const temporary = await db.user.create({
      data: { email: `${PREFIX}-uploader@dovelewis.org`, name: "Verify Uploader", role: "author" },
    });
    const kept = await createBulletinAttachment({
      bulletin_id: bulletin.id,
      file_name: `kept-${PREFIX}.txt`,
      file_key: `attachments/${PREFIX}/kept.txt`,
      mime_type: assertAttachmentType(Buffer.from("Line one\n", "utf8"), "kept.txt").mime,
      size_bytes: 9,
      uploaded_by_id: temporary.id,
    });
    await db.user.delete({ where: { id: temporary.id } });
    const keptRow = await db.bulletinAttachment.findUniqueOrThrow({
      where: { id: kept.id },
      select: { uploadedById: true, fileName: true },
    });
    assertEqual(keptRow.uploadedById, null, "the uploader FK is nulled, not cascaded");
    assertEqual(keptRow.fileName, `kept-${PREFIX}.txt`, "the file survives its uploader");

    // Deleting the notice takes both attachments with it.
    await db.bulletin.delete({ where: { id: bulletin.id } });
    const remaining = await db.bulletinAttachment.count({
      where: { id: { in: [attachment.id, kept.id] } },
    });
    assertEqual(remaining, 0, "attachments cascade with their bulletin");
  });

  await test("the attachment routes' auth rule is the bulletin edit rule", async () => {
    const staff = await db.user.findFirstOrThrow({ where: { role: "staff" }, select: { id: true } });
    const bulletin = await createBulletin({
      title: `${PREFIX} ownership notice`,
      body_markdown: "Ownership fixture.",
      departments: ["ER"],
      author_id: author.id,
    });

    // The author may attach to their own notice...
    const editable = await requireEditableBulletin(bulletin.id, { id: author.id, role: "author" });
    assertEqual(editable.id, bulletin.id, "the author may change their own notice");

    // ...a clinical lead may attach to anyone's...
    const asLead = await requireEditableBulletin(bulletin.id, { id: lead.id, role: "clinical_lead" });
    assertEqual(asLead.id, bulletin.id, "a clinical lead may change any notice");

    // ...and a staff member (or another author) may not.
    await assertApiError(
      () => requireEditableBulletin(bulletin.id, { id: staff.id, role: "staff" }),
      "forbidden",
      "a staff member attaching to someone else's notice",
    );
    await assertApiError(
      () => requireEditableBulletin(bulletin.id, { id: "00000000-0000-4000-8000-000000000000", role: "author" }),
      "forbidden",
      "a different author attaching to this notice",
    );

    // An unknown notice is a 404, not a 403.
    await assertApiError(
      () => requireEditableBulletin("00000000-0000-4000-8000-000000000000", { id: author.id, role: "author" }),
      "not_found",
      "an unknown bulletin",
    );

    // The allowlist the routes validate against, in one place.
    assertEqual(ALLOWED_ATTACHMENT_TYPES.length, 6, "the shared allowlist admits six types");
  });

  /* ------------------------------------------- staged attachments (6d follow-up) */

  await test("a file staged before the notice exists is linked when it is posted", async () => {
    const staged = await stageBulletinAttachment({
      file_name: `staged-${PREFIX}.pdf`,
      file_key: `attachments/${PREFIX}/staged.pdf`,
      mime_type: assertAttachmentType(Buffer.from("%PDF-1.7\n%%EOF\n", "latin1"), "staged.pdf").mime,
      size_bytes: 15,
      uploaded_by_id: author.id,
    });
    assertEqual(staged.bulletin_id, null, "a staged attachment must carry no bulletin id");

    const bulletin = await createBulletin({
      title: `${PREFIX} staged notice`,
      body_markdown: "Staged fixture.",
      departments: ["ER"],
      author_id: author.id,
      attachment_ids: [staged.id],
    });
    const listed = await listBulletinAttachments(bulletin.id);
    assertEqual(listed.map((entry) => entry.id), [staged.id], "the staged file is listed on the notice");
    assertEqual(listed[0]?.bulletin_id, bulletin.id, "and points at the notice");

    // Re-linking the same id is a refusal, not a silent no-op — and the notice
    // it was refused for must not exist.
    await assertApiError(
      () =>
        createBulletin({
          title: `${PREFIX} relinked notice`,
          body_markdown: "Staged fixture.",
          departments: ["ER"],
          author_id: author.id,
          attachment_ids: [staged.id],
        }),
      "attachment_not_staged",
      "re-linking an already-linked attachment",
    );
    const leftover = await db.bulletin.count({ where: { title: `${PREFIX} relinked notice` } });
    assertEqual(leftover, 0, "a refused link must not leave a notice behind");

    // A still-staged file is unreachable through a bulletin, and is discarded
    // through the staging path by its uploader only.
    const orphan = await stageBulletinAttachment({
      file_name: `orphan-${PREFIX}.txt`,
      file_key: `attachments/${PREFIX}/orphan.txt`,
      mime_type: assertAttachmentType(Buffer.from("Line one\n", "utf8"), "orphan.txt").mime,
      size_bytes: 9,
      uploaded_by_id: author.id,
    });
    await assertApiError(
      () => getBulletinAttachmentForDownload(bulletin.id, orphan.id),
      "not_found",
      "a staged file read through a bulletin",
    );
    await assertApiError(
      () => deleteStagedAttachment(orphan.id, { id: "00000000-0000-4000-8000-000000000000", role: "author" }),
      "forbidden",
      "discarding someone else's staged file",
    );
    await deleteStagedAttachment(orphan.id, { id: author.id, role: "author" });
    const discarded = await db.bulletinAttachment.findUnique({ where: { id: orphan.id } });
    assertEqual(discarded, null, "the stage-discard must remove the row");
  });

  await test("a staged file nobody linked is swept with its object, and only past the TTL", async () => {
    const abandoned = await stageBulletinAttachment({
      file_name: `abandoned-${PREFIX}.pptx`,
      file_key: `attachments/${PREFIX}/abandoned.pptx`,
      mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size_bytes: 2048,
      uploaded_by_id: author.id,
    });
    const keep = await stageBulletinAttachment({
      file_name: `keep-${PREFIX}.txt`,
      file_key: `attachments/${PREFIX}/keep.txt`,
      mime_type: assertAttachmentType(Buffer.from("Line one\n", "utf8"), "keep.txt").mime,
      size_bytes: 9,
      uploaded_by_id: author.id,
    });

    await db.bulletinAttachment.update({
      where: { id: abandoned.id },
      data: { createdAt: new Date(Date.now() - STAGED_ATTACHMENT_TTL_MS - 60_000) },
    });

    const deleted: string[] = [];
    const result = await sweepStagedAttachments({
      deleteObject: async (key) => {
        deleted.push(key);
      },
    });

    assert(deleted.includes(`attachments/${PREFIX}/abandoned.pptx`), "the abandoned object was not deleted");
    assert(result.swept >= 1, "the sweep reported nothing");
    assertEqual(await db.bulletinAttachment.findUnique({ where: { id: abandoned.id } }), null, "the swept row");
    assert(
      await db.bulletinAttachment.findUnique({ where: { id: keep.id } }),
      "a staged file inside the TTL must survive the sweep",
    );
    assert(!deleted.includes(`attachments/${PREFIX}/keep.txt`), "a fresh staged object was deleted");

    // A failing delete keeps the row for the next run rather than orphaning the
    // file, and never aborts the sweep.
    await db.bulletinAttachment.update({
      where: { id: keep.id },
      data: { createdAt: new Date(Date.now() - STAGED_ATTACHMENT_TTL_MS - 60_000) },
    });
    const failing = await sweepStagedAttachments({
      deleteObject: async () => {
        throw new Error("storage unreachable");
      },
    });
    assert(failing.deferred >= 1, "the storage failure was not counted");
    assertEqual(failing.swept, 0, "a row was dropped even though its object survived");
    assert(
      await db.bulletinAttachment.findUnique({ where: { id: keep.id } }),
      "the row must be kept so the next sweep can retry",
    );
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
  // Attachments staged for a notice that was never posted belong to no bulletin,
  // so nothing cascades them away.
  await db.$executeRawUnsafe("DELETE FROM bulletin_attachments WHERE file_key LIKE 'attachments/zz-verify%'");
  await db.$executeRawUnsafe("DELETE FROM search_logs WHERE query LIKE 'zz-verify%'");

  // Fixtures that survive a delete are invisible otherwise — the run still
  // reports green while quietly polluting the database. Say so, loudly.
  const [{ leftovers }] = await db.$queryRaw<Array<{ leftovers: number }>>`
    SELECT (SELECT count(*) FROM articles WHERE slug LIKE 'zz-verify%')
         + (SELECT count(*) FROM bulletins WHERE title LIKE 'zz-verify%')
         + (SELECT count(*) FROM bulletin_attachments WHERE file_key LIKE 'attachments/zz-verify%') AS leftovers
  `;
  if (Number(leftovers) !== 0) {
    throw new Error(`cleanup left ${leftovers} verification fixture row(s) behind`);
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
