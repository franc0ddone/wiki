/**
 * `npx prisma db seed` — load the phase-1 fixtures into PostgreSQL.
 *
 * Source of truth is `lib/mock-data.ts` itself, imported rather than copied, so
 * the seed can never drift from what the UI has been rendering. The mock file
 * is deliberately left working: it is the reference the frontend pass swaps
 * away from, and `scripts/verify-backend.ts` compares the two.
 *
 * Idempotent. Every write is an upsert keyed on a natural identity (email,
 * slug, system id, bulletin id), so re-running it neither duplicates rows nor
 * moves timestamps.
 *
 * Notable mapping decisions:
 *  - `User.name` + `User.title` reproduce the fixture's `author_name` string
 *    ("Trevor Lindqvist, ICU Technician II"). Every fixture author is a member
 *    of the staff directory, so the two come from one row.
 *  - `User` roles are assigned from the staff directory below; they are a
 *    clinical judgement, not something the fixtures stated.
 *  - Seeded bulletins carry `expires_at = NULL`. They are historical fixtures,
 *    not live notices, and giving them a real window would silently empty the
 *    board. The expiry policy applies to bulletins posted through the API.
 *  - Each already-published article gets version 1, so publishing history is
 *    never empty for content that is already live.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Prisma } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";
import { BULLETINS, KNOWLEDGE_ARTICLES, STAFF_DIRECTORY } from "@/lib/mock-data";
import type { Role } from "@/lib/roles";

/** JSON columns take an opaque value; the fixture rotations are plain objects. */
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Who administers, who signs off clinical content, who writes, who just reads.
 * Keyed by `system_id` so it survives any reordering of the directory.
 */
const ROLE_BY_SYSTEM_ID: Record<string, Role> = {
  "EH-1042": "clinical_lead", // Dr. Maya Okonkwo — Lead Emergency Clinician
  "EH-1103": "clinical_lead", // Dr. Ilan Weiss — Cardiology Consultant
  "EH-1204": "clinical_lead", // Dr. Sofia Almeida — Medical Oncologist
  "EH-1150": "clinical_lead", // Dr. Hannah Berglund — Rehab & Exotics Specialist
  "EH-0855": "admin", // Nadia Fournier — Practice Finance Manager
  "EH-1097": "author", // Dana Whitfield — Facilities & Safety Officer
  "EH-1081": "author", // Marcus Oyelaran — Diagnostic Imaging Lead
  "EH-0917": "author", // Priya Raghunathan — Client Experience Coordinator
  "EH-1188": "staff", // Trevor Lindqvist — ICU Technician II
};

const DEV_FALLBACK_PASSWORD = "dove-wiki-dev-password";

async function main() {
  const password = process.env.SEED_DEFAULT_PASSWORD?.trim() || DEV_FALLBACK_PASSWORD;
  if (!process.env.SEED_DEFAULT_PASSWORD?.trim()) {
    console.warn(
      `[seed] SEED_DEFAULT_PASSWORD is unset — every account is getting the development ` +
        `password. Never run this seed against anything but a local database.`,
    );
  }
  const passwordHash = await bcrypt.hash(password, 10);

  /* ------------------------------------------------------------- staff + users */

  // Fixture authors are written as "Name, Title"; index them by that exact key.
  const userByAuthorName = new Map<string, string>();

  for (const member of STAFF_DIRECTORY) {
    const role = ROLE_BY_SYSTEM_ID[member.system_id] ?? "staff";

    const user = await prisma.user.upsert({
      where: { email: member.email },
      update: {
        name: member.full_name,
        title: member.title,
        role,
        passwordHash,
      },
      create: {
        email: member.email,
        name: member.full_name,
        title: member.title,
        role,
        passwordHash,
      },
    });

    userByAuthorName.set(`${member.full_name}, ${member.title}`, user.id);

    await prisma.staffMember.upsert({
      where: { systemId: member.system_id },
      update: {
        fullName: member.full_name,
        preferredName: member.preferred_name,
        pronouns: member.pronouns,
        title: member.title,
        departments: [...member.departments],
        email: member.email,
        phoneExtension: member.phone_extension,
        directPhone: member.direct_phone,
        shiftPreference: member.shift_preference,
        shiftRotations: json(member.shift_rotations),
        avatarUrl: member.avatar_url || null,
      },
      create: {
        id: member.id,
        systemId: member.system_id,
        fullName: member.full_name,
        preferredName: member.preferred_name,
        pronouns: member.pronouns,
        title: member.title,
        departments: [...member.departments],
        email: member.email,
        phoneExtension: member.phone_extension,
        directPhone: member.direct_phone,
        shiftPreference: member.shift_preference,
        shiftRotations: json(member.shift_rotations),
        avatarUrl: member.avatar_url || null,
      },
    });
  }

  // The first clinical lead on file reviews anything whose author cannot
  // self-review. Derived from the role map, not hard-coded, so reordering the
  // directory is safe.
  const clinicalLeadIds = STAFF_DIRECTORY.filter(
    (member) => ROLE_BY_SYSTEM_ID[member.system_id] === "clinical_lead",
  ).map((member) => userByAuthorName.get(`${member.full_name}, ${member.title}`) as string);

  const reviewerFor = (authorId: string): string =>
    clinicalLeadIds.includes(authorId) ? authorId : (clinicalLeadIds[0] ?? authorId);

  /* ---------------------------------------------------------------- articles */

  let versionCount = 0;

  for (const article of KNOWLEDGE_ARTICLES) {
    const authorId = userByAuthorName.get(article.author_name);
    if (!authorId) {
      throw new Error(
        `Article "${article.slug}" names an author not present in the staff directory: ${article.author_name}`,
      );
    }

    const published = article.status === "published";
    const data = {
      title: article.title,
      bodyMarkdown: article.body_markdown,
      departments: [...article.departments],
      status: article.status,
      authorId,
      reviewerId: published ? reviewerFor(authorId) : null,
      effectiveDate: published ? new Date(article.updated_at) : null,
      // Explicit, not Prisma's @updatedAt: re-running the seed restores the
      // fixture timestamps instead of stamping "now" on every article.
      updatedAt: new Date(article.updated_at),
      sourceTitle: null,
      importedAt: null,
    };

    const row = await prisma.article.upsert({
      where: { slug: article.slug },
      update: data,
      create: { id: article.id, slug: article.slug, ...data },
    });

    if (published) {
      const existing = await prisma.articleVersion.findUnique({
        where: { articleId_version: { articleId: row.id, version: 1 } },
      });
      if (!existing) {
        await prisma.articleVersion.create({
          data: {
            articleId: row.id,
            version: 1,
            title: article.title,
            bodyMarkdown: article.body_markdown,
            changeSummary: "Initial load of the phase-1 fixture content.",
            changedById: authorId,
            createdAt: new Date(article.updated_at),
          },
        });
        versionCount += 1;
      }
    }
  }

  /* --------------------------------------------------------------- bulletins */

  for (const bulletin of BULLETINS) {
    const authorId = userByAuthorName.get(bulletin.author_name);
    if (!authorId) {
      throw new Error(
        `Bulletin "${bulletin.id}" names an author not present in the staff directory: ${bulletin.author_name}`,
      );
    }

    let linkedArticleId: string | null = null;
    if (bulletin.linked_sop_id) {
      const linked = await prisma.article.findUnique({
        where: { id: bulletin.linked_sop_id },
        select: { id: true },
      });
      if (!linked) {
        throw new Error(
          `Bulletin "${bulletin.id}" links to article ${bulletin.linked_sop_id}, which was not seeded.`,
        );
      }
      linkedArticleId = linked.id;
    }

    const data = {
      title: bulletin.title,
      bodyMarkdown: bulletin.body_markdown,
      departments: [...bulletin.departments],
      priority: bulletin.priority,
      linkedArticleId,
      authorId,
      publishedAt: new Date(bulletin.created_at),
      // Historical fixtures: no window, so the board is not empty after seeding.
      expiresAt: null,
    };

    await prisma.bulletin.upsert({
      where: { id: bulletin.id },
      update: data,
      create: { id: bulletin.id, ...data },
    });
  }

  /* ----------------------------------------------------------------- summary */

  const [users, staff, articles, bulletins, versions] = await Promise.all([
    prisma.user.count(),
    prisma.staffMember.count(),
    prisma.article.count(),
    prisma.bulletin.count(),
    prisma.articleVersion.count(),
  ]);

  console.log(
    [
      "[seed] done.",
      `  users:            ${users}`,
      `  staff members:    ${staff}`,
      `  articles:         ${articles}`,
      `  article versions: ${versions} (+${versionCount} created this run)`,
      `  bulletins:        ${bulletins}`,
    ].join("\n"),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[seed] failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
