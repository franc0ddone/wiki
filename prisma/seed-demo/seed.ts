/**
 * Demo reset, **phase 2 — seed** (library).
 *
 * Reads the reviewable files under `prisma/seed-demo/` (see `content.ts`) and
 * writes them into PostgreSQL. Everything here is fictional demo content for
 * Dove Lewis Emergency Hospital; nothing is drawn from a real patient or a real
 * roster.
 *
 * ## What it writes, and what it deliberately does not
 *
 *  - **Staff + authors.** Every directory member gets a `StaffMember` row, and
 *    — because `Article.authorId` / `Bulletin.authorId` are required foreign
 *    keys — a `User` row to author content with. Those accounts are *created
 *    only*: an email that already has an account (the demo user
 *    `foddone@dovelewis.org`) is reused untouched, so no role, name, or
 *    password on an existing account is ever rewritten. The created accounts
 *    carry no `passwordHash`, so they exist purely as authorship identities and
 *    cannot sign in — the demo's login path is unchanged.
 *  - **Content.** 15 SOPs (each with an initial published version), 15
 *    bulletins, and the bulletins' document attachments.
 *  - **Presence.** Nothing. "Who is here today" is per-browser `localStorage`
 *    (see `lib/directory/roster.ts`), not a column, so the seed can neither set
 *    it nor read it; the directory draws its own deterministic on-shift subset.
 *
 * ## Idempotency
 *
 * Every write is an upsert on a natural identity — `User.email`,
 * `StaffMember.systemId`, `Article.slug`, `ArticleVersion (article, 1)`,
 * `Bulletin.id` (fixed in each file's front matter) and
 * `BulletinAttachment (bulletin, fileKey)` — so re-running after a phase-1
 * clear, or twice in a row, produces exactly one of everything and moves no
 * timestamps. Attachment object keys are deterministic
 * (`attachments/demo/<fileName>`), so an upload overwrites rather than piles
 * up.
 *
 * The command-line entry point is `prisma/seed-demo/run.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Prisma } from "@/generated/prisma/client";
import { assertAttachmentType, sanitizeAttachmentFileName } from "@/lib/attachments";
import { staffTypeForDepartments } from "@/lib/staff-type";
import { putObjectAtKey } from "@/lib/storage";
import type { ClinicalDepartment } from "@/types/portal";

import type { SeedClient } from "./client";
import { DEMO_ATTACHMENT_DIR, loadDemoContent, type DemoContent, type DemoStaff } from "./content";

/** JSON columns take an opaque value; the demo rotations are plain objects. */
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export interface SeedSummary {
  usersCreated: number;
  staff: number;
  articles: number;
  versionsCreated: number;
  bulletins: number;
  attachments: number;
  attachmentsSkipped: number;
}

/** Refuse to run on content that would write a broken board. */
function assertConsistent(content: DemoContent): void {
  const emails = new Set<string>();
  const systemIds = new Set<string>();
  for (const member of content.staff) {
    if (emails.has(member.email)) throw new Error(`staff.json: duplicate email ${member.email}`);
    if (systemIds.has(member.systemId)) throw new Error(`staff.json: duplicate system_id ${member.systemId}`);
    emails.add(member.email);
    systemIds.add(member.systemId);
  }

  const slugs = new Set<string>();
  for (const sop of content.sops) {
    if (slugs.has(sop.slug)) throw new Error(`duplicate SOP slug ${sop.slug}`);
    slugs.add(sop.slug);
    if (!emails.has(sop.authorEmail)) {
      throw new Error(`${sop.file}: author ${sop.authorEmail} is not a record in staff.json`);
    }
  }

  const ids = new Set<string>();
  for (const bulletin of content.bulletins) {
    if (ids.has(bulletin.id)) throw new Error(`${bulletin.file}: duplicate bulletin id ${bulletin.id}`);
    ids.add(bulletin.id);
    if (!emails.has(bulletin.authorEmail)) {
      throw new Error(`${bulletin.file}: author ${bulletin.authorEmail} is not a record in staff.json`);
    }
    if (bulletin.linkedSop && !slugs.has(bulletin.linkedSop)) {
      throw new Error(`${bulletin.file}: linked_sop ${bulletin.linkedSop} is not a seeded SOP`);
    }
    for (const attachment of bulletin.attachments) {
      if (!existsSync(join(DEMO_ATTACHMENT_DIR, attachment))) {
        throw new Error(`${bulletin.file}: attachment ${attachment} is missing from prisma/seed-demo/attachments/`);
      }
    }
  }
}

function staffData(member: DemoStaff) {
  return {
    fullName: member.fullName,
    preferredName: member.preferredName,
    pronouns: member.pronouns,
    title: member.title,
    departments: [...member.departments],
    email: member.email,
    phoneExtension: member.phoneExtension,
    directPhone: member.directPhone,
    shiftPreference: member.shiftPreference,
    shiftRotations: json(member.shiftRotations),
    avatarUrl: member.avatarUrl.length > 0 ? member.avatarUrl : null,
  };
}

export async function seedDemo(prisma: SeedClient): Promise<SeedSummary> {
  const content = loadDemoContent();
  assertConsistent(content);

  const summary: SeedSummary = {
    usersCreated: 0,
    staff: 0,
    articles: 0,
    versionsCreated: 0,
    bulletins: 0,
    attachments: 0,
    attachmentsSkipped: 0,
  };

  /* ------------------------------------------------------------- staff + users */

  const userIdByEmail = new Map<string, string>();

  for (const member of content.staff) {
    const existing = await prisma.user.findUnique({ where: { email: member.email } });
    if (existing) {
      // An account already exists (the demo user, or a prior seed). Leave it
      // exactly as it is: no role, name, or password is rewritten.
      userIdByEmail.set(member.email, existing.id);
    } else {
      const created = await prisma.user.create({
        data: {
          email: member.email,
          name: member.fullName,
          title: member.title,
          staffType: staffTypeForDepartments(member.departments as ClinicalDepartment[]),
        },
      });
      userIdByEmail.set(member.email, created.id);
      summary.usersCreated += 1;
    }

    await prisma.staffMember.upsert({
      where: { systemId: member.systemId },
      update: staffData(member),
      create: { systemId: member.systemId, ...staffData(member) },
    });
    summary.staff += 1;
  }

  /* ----------------------------------------------------------------- articles */

  const articleIdBySlug = new Map<string, string>();

  for (const sop of content.sops) {
    const authorId = userIdByEmail.get(sop.authorEmail);
    if (!authorId) throw new Error(`${sop.file}: no author account for ${sop.authorEmail}`);

    const published = sop.status === "published";
    const updatedAt = new Date(sop.updatedAt);
    const data = {
      title: sop.title,
      bodyMarkdown: sop.body,
      departments: [...sop.departments],
      status: sop.status,
      isEssential: sop.essential,
      audience: sop.audience,
      authorId,
      // Publishing *is* the review act, so the effective date is the moment of
      // the demo build; `reviewerId` stays null (nothing gates on it any more).
      effectiveDate: published ? updatedAt : null,
      updatedAt,
      sourceTitle: null,
      importedAt: null,
    };

    const row = await prisma.article.upsert({
      where: { slug: sop.slug },
      update: data,
      create: { slug: sop.slug, ...data },
    });
    articleIdBySlug.set(sop.slug, row.id);
    summary.articles += 1;

    if (published) {
      const existing = await prisma.articleVersion.findUnique({
        where: { articleId_version: { articleId: row.id, version: 1 } },
      });
      if (!existing) {
        await prisma.articleVersion.create({
          data: {
            articleId: row.id,
            version: 1,
            title: sop.title,
            bodyMarkdown: sop.body,
            changeSummary: sop.changeSummary,
            changedById: authorId,
            createdAt: updatedAt,
          },
        });
        summary.versionsCreated += 1;
      }
    }
  }

  /* ---------------------------------------------------------------- bulletins */

  for (const bulletin of content.bulletins) {
    const authorId = userIdByEmail.get(bulletin.authorEmail);
    if (!authorId) throw new Error(`${bulletin.file}: no author account for ${bulletin.authorEmail}`);

    const linkedArticleId = bulletin.linkedSop ? articleIdBySlug.get(bulletin.linkedSop) ?? null : null;

    const data = {
      title: bulletin.title,
      bodyMarkdown: bulletin.body,
      departments: [...bulletin.departments],
      pinned: bulletin.pinned,
      urgent: bulletin.urgent,
      ackRequired: bulletin.ackRequired,
      deck: bulletin.deck,
      heroImageUrl: bulletin.heroImageUrl,
      heroImageAlt: bulletin.heroImageAlt,
      linkedArticleId,
      authorId,
      publishedAt: new Date(bulletin.publishedAt),
      expiresAt: bulletin.expiresAt ? new Date(bulletin.expiresAt) : null,
    };

    await prisma.bulletin.upsert({
      where: { id: bulletin.id },
      update: data,
      create: { id: bulletin.id, ...data },
    });
    summary.bulletins += 1;

    /* --------------------------------------------------- document attachments */

    for (const name of bulletin.attachments) {
      try {
        const bytes = readFileSync(join(DEMO_ATTACHMENT_DIR, name));
        const fileName = sanitizeAttachmentFileName(name);
        // Run the demo file through the same magic-byte gate the upload API
        // applies, so the seeded attachment is one the real pipeline would
        // accept — and the stored MIME type is the detected one, not a guess.
        const { mime } = assertAttachmentType(bytes, fileName);
        const fileKey = `attachments/demo/${fileName}`;

        await putObjectAtKey(fileKey, bytes, { contentType: mime });

        const existing = await prisma.bulletinAttachment.findFirst({
          where: { bulletinId: bulletin.id, fileKey },
        });
        if (existing) {
          await prisma.bulletinAttachment.update({
            where: { id: existing.id },
            data: { fileName, mimeType: mime, sizeBytes: bytes.length },
          });
        } else {
          await prisma.bulletinAttachment.create({
            data: {
              bulletinId: bulletin.id,
              fileName,
              fileKey,
              mimeType: mime,
              sizeBytes: bytes.length,
              uploadedById: authorId,
            },
          });
        }
        summary.attachments += 1;
      } catch (error) {
        // Object storage may simply not be running for a local demo. A notice
        // without its attachment is honest; a row pointing at a missing object
        // is not, so the row is skipped and the reason is printed.
        summary.attachmentsSkipped += 1;
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[seed:demo] skipped attachment ${name} on "${bulletin.title}": ${reason}`);
      }
    }
  }

  return summary;
}
