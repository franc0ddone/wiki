/**
 * Demo reset, **phase 1 — clear** (library).
 *
 * Deletes every piece of user-created content from the database so a fresh
 * demo seed can land on a clean board, and nothing else. This is the
 * destructive half of the reset, and it is deliberately narrow:
 *
 *   cleared   articles + their versions, reads, and attachments
 *             bulletins + their acks, reactions, and attachments
 *             staged bulletin attachments (uploaded but never attached)
 *             staff directory entries
 *
 *   kept      user accounts, roles, and password hashes
 *             auth/session data and role requests
 *             search logs and any other operational bookkeeping
 *
 * The scope rule is one sentence: *content goes, identity stays*. A signed-in
 * account — in particular the demo user `foddone@dovelewis.org` — must still be
 * able to log in and (once phase 2 has run) check itself in against its staff
 * record.
 *
 * All the cascades are declared on the relations in `schema.prisma`
 * (`ArticleVersion`, `ArticleRead`, `ArticleAttachment`, `BulletinAck`,
 * `BulletinReaction`, and linked `BulletinAttachment` are all
 * `onDelete: Cascade`), so a handful of `deleteMany` calls are the whole job.
 * Object-storage bytes are *not* touched: rows are what this phase owns, and
 * the orphaned uploads a wiped demo database leaves behind are storage
 * housekeeping, not content.
 *
 * The command-line entry point is `prisma/seed-demo/run.ts`.
 */
import type { SeedClient } from "./client";

export interface ClearSummary {
  bulletins: number;
  articles: number;
  stagedAttachments: number;
  staff: number;
}

/** Delete all content rows. Safe to run on an already-empty database. */
export async function clearContent(prisma: SeedClient): Promise<ClearSummary> {
  // `article_versions` carries a BEFORE DELETE trigger that makes it append-only
  // (see `prisma/migrations/20261005191407_article_version_immutability`), so the
  // cascade from an article delete is refused until the trigger is stood down.
  // That migration names this exact statement as the deliberate, reviewable step
  // to take — so it is done here, inside the same transaction, and the trigger is
  // stood back up before the transaction commits. A failure rolls both back, so
  // the immutability guarantee can never be left switched off.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("ALTER TABLE article_versions DISABLE TRIGGER article_versions_no_delete");

    const bulletins = await tx.bulletin.deleteMany();
    const articles = await tx.article.deleteMany();
    // Staged uploads (a composer file with no bulletin yet) are not reachable by
    // either cascade above; they are still content, so they go too.
    const stagedAttachments = await tx.bulletinAttachment.deleteMany({ where: { bulletinId: null } });
    const staff = await tx.staffMember.deleteMany();

    await tx.$executeRawUnsafe("ALTER TABLE article_versions ENABLE TRIGGER article_versions_no_delete");

    return {
      bulletins: bulletins.count,
      articles: articles.count,
      stagedAttachments: stagedAttachments.count,
      staff: staff.count,
    };
  });
}
