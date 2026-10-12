import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { STAGED_ATTACHMENT_TTL_MS, isStagedAttachmentExpired } from "@/lib/bulletin/lifecycle";
import { roleAtLeast, type Role } from "@/lib/roles";
import { deleteObjectAtKey } from "@/lib/storage";

/**
 * Bulletin attachment access.
 *
 * The bulletin counterpart of `lib/data/attachments.ts`, and the same contract:
 * an attachment belongs to the *bulletin*, so it persists across every later
 * edit; the stored `file_key` never crosses the wire (the client-facing record
 * omits it, and the bytes are streamed through the API rather than from a raw
 * storage URL).
 *
 * Two things are bulletin-specific:
 *
 *  1. **Staging.** A notice does not exist until it is posted, so a file chosen
 *     in the composer beforehand is stored with `bulletinId = null` and linked
 *     when the bulletin is created (`linkStagedAttachments`, called from
 *     `createBulletin`/`updateBulletin` inside their transaction). The composer
 *     holds those ids and sends them with the save — the same "upload now,
 *     reference on save" shape the hero image already uses.
 *  2. **A sweep.** A staged row that is never linked is unreachable — nothing
 *     else points at it — so `sweepStagedAttachments` deletes its object and
 *     then the row once it is older than `STAGED_ATTACHMENT_TTL_MS`. It runs on
 *     the board fetch, next to the expired-notice sweep.
 *
 * Removing a *linked* row deletes the row and leaves the object in place,
 * exactly as a replaced hero image does; the staged sweep is the one path that
 * removes a file from the bucket, because there it is the only pointer left.
 */

/** The shape the reader and the API list return. No storage key, ever. */
export interface BulletinAttachmentRecord {
  id: string;
  /** `null` while the attachment is staged for a bulletin that does not exist yet. */
  bulletin_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_id: string | null;
  created_at: string;
}

/** Server-only: the list record plus the object key, for the download route. */
export interface StoredBulletinAttachmentRecord extends BulletinAttachmentRecord {
  file_key: string;
}

interface BulletinAttachmentRow {
  id: string;
  bulletinId: string | null;
  fileName: string;
  fileKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: Date;
}

function toRecord(row: BulletinAttachmentRow): BulletinAttachmentRecord {
  return {
    id: row.id,
    bulletin_id: row.bulletinId,
    file_name: row.fileName,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    uploaded_by_id: row.uploadedById,
    created_at: row.createdAt.toISOString(),
  };
}

async function assertBulletinExists(bulletinId: string): Promise<void> {
  const row = await getDb().bulletin.findUnique({ where: { id: bulletinId }, select: { id: true } });
  if (!row) throw new ApiError(404, `No bulletin with id \`${bulletinId}\` exists.`);
}

export interface CreateBulletinAttachmentInput {
  bulletin_id: string;
  file_name: string;
  file_key: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_id: string | null;
}

/** Record an attachment that has already been stored in object storage. */
export async function createBulletinAttachment(
  input: CreateBulletinAttachmentInput,
): Promise<BulletinAttachmentRecord> {
  await assertBulletinExists(input.bulletin_id);
  const row = await getDb().bulletinAttachment.create({
    data: {
      bulletinId: input.bulletin_id,
      fileName: input.file_name,
      fileKey: input.file_key,
      mimeType: input.mime_type,
      sizeBytes: input.size_bytes,
      uploadedById: input.uploaded_by_id,
    },
  });
  return toRecord(row);
}

export interface StageBulletinAttachmentInput {
  file_name: string;
  file_key: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_id: string | null;
}

/**
 * Store a file for a notice that does not exist yet — the "attach while writing
 * a new bulletin" path. The row carries no bulletin id until
 * `linkStagedAttachments` gives it one, and is swept after the TTL if that never
 * happens.
 */
export async function stageBulletinAttachment(
  input: StageBulletinAttachmentInput,
): Promise<BulletinAttachmentRecord> {
  const row = await getDb().bulletinAttachment.create({
    data: {
      bulletinId: null,
      fileName: input.file_name,
      fileKey: input.file_key,
      mimeType: input.mime_type,
      sizeBytes: input.size_bytes,
      uploadedById: input.uploaded_by_id,
    },
  });
  return toRecord(row);
}

/**
 * Attach staged rows to a bulletin. Called inside the caller's transaction, so a
 * notice and its files land together or not at all.
 *
 * Every id must still be staged: an id that is unknown, already linked, or
 * someone else's is a `422` rather than a silent no-op, so a client bug cannot
 * look like a successful save. Returns how many rows were linked.
 */
export async function linkStagedAttachments(
  bulletinId: string,
  attachmentIds: readonly string[],
  client: Prisma.TransactionClient = getDb(),
): Promise<number> {
  // A duplicate id is the client's business, not an error: it links once.
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return 0;

  const staged = await client.bulletinAttachment.findMany({
    where: { id: { in: ids }, bulletinId: null },
    select: { id: true },
  });
  if (staged.length !== ids.length) {
    throw new ApiError(422, "One or more of these attachments can no longer be attached.", {
      code: "attachment_not_staged",
      details: { field: "attachment_ids", requested: ids.length, staged: staged.length },
    });
  }

  const linked = await client.bulletinAttachment.updateMany({
    where: { id: { in: ids } },
    data: { bulletinId },
  });
  return linked.count;
}

/** Every attachment on a bulletin, oldest first. 404 for an unknown bulletin. */
export async function listBulletinAttachments(bulletinId: string): Promise<BulletinAttachmentRecord[]> {
  await assertBulletinExists(bulletinId);
  const rows = await getDb().bulletinAttachment.findMany({
    where: { bulletinId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRecord);
}

/**
 * The attachment record plus its object key, for the download route only. 404
 * when either the bulletin or the attachment is unknown, or when the attachment
 * belongs to a different bulletin — an id from one notice can never be used to
 * read another's file, and a *staged* row (no bulletin at all) is not reachable
 * through any bulletin id.
 */
export async function getBulletinAttachmentForDownload(
  bulletinId: string,
  id: string,
): Promise<StoredBulletinAttachmentRecord> {
  await assertBulletinExists(bulletinId);
  const row = await getDb().bulletinAttachment.findUnique({ where: { id } });
  if (!row || row.bulletinId !== bulletinId) {
    throw new ApiError(404, `No attachment with id \`${id}\` on this bulletin.`);
  }
  return { ...toRecord(row), file_key: row.fileKey };
}

/**
 * Remove a linked attachment. Same ownership rule as the read paths — the
 * attachment must belong to the named bulletin — and idempotent from the
 * caller's side: a second delete of the same id is a 404, which the composer
 * treats as "already gone".
 */
export async function deleteBulletinAttachment(bulletinId: string, id: string): Promise<void> {
  const record = await getBulletinAttachmentForDownload(bulletinId, id);
  await getDb().bulletinAttachment.delete({ where: { id: record.id } });
}

/**
 * Remove a *staged* attachment — the composer's "remove" on a file chosen for a
 * notice that has not been saved. There is no bulletin to check, so the rule is
 * the uploader's own file (or a `clinical_lead`+): you may discard what you
 * staged, and a lead may discard anything. 404 for a row that is not staged (a
 * linked attachment is removed through its bulletin), 403 for someone else's.
 */
export async function deleteStagedAttachment(
  id: string,
  actor: { id: string; role: string },
): Promise<void> {
  const row = await getDb().bulletinAttachment.findUnique({ where: { id } });
  if (!row || row.bulletinId !== null) {
    throw new ApiError(404, `No staged attachment with id \`${id}\` exists.`);
  }
  const isLead = roleAtLeast(actor.role as Role, "clinical_lead");
  if (!isLead && row.uploadedById !== actor.id) {
    throw new ApiError(403, "Only the person who staged a file may discard it.", {
      code: "forbidden",
      details: { requiredRole: "clinical_lead", actualRole: actor.role },
    });
  }
  await getDb().bulletinAttachment.delete({ where: { id: row.id } });
}

/** How the sweep removes a file from storage. Injectable, so it is testable. */
export type DeleteStoredObject = (key: string) => Promise<void>;

export interface SweepStagedAttachmentsOptions {
  /** Injectable clock; defaults to now. */
  now?: Date;
  /** Injectable TTL; defaults to `STAGED_ATTACHMENT_TTL_MS`. */
  ttlMs?: number;
  /** Injectable storage delete; defaults to `deleteObjectAtKey`. */
  deleteObject?: DeleteStoredObject;
}

export interface SweepStagedAttachmentsResult {
  /** Staged rows whose object and row were both removed. */
  swept: number;
  /** Staged rows past the TTL whose object could not be removed — kept for the next run. */
  deferred: number;
}

/**
 * Delete staged attachments that were never linked to a bulletin, once they are
 * older than the TTL — object first, then the row.
 *
 * Object first is the whole point: if storage is unreachable the row stays and
 * the next sweep tries again, so a file can never become an orphan with nothing
 * pointing at it. (S3's delete is idempotent, so retrying one that actually
 * succeeded is harmless.) A single failure never aborts the sweep; the run
 * reports how many it deferred.
 *
 * Called from `getBulletins`, next to the expired-notice sweep: no cron exists
 * in this codebase, and that sweep is the established place for "silent cleanup
 * before the board is returned".
 */
export async function sweepStagedAttachments(
  options: SweepStagedAttachmentsOptions = {},
): Promise<SweepStagedAttachmentsResult> {
  const db = getDb();
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? STAGED_ATTACHMENT_TTL_MS;
  const deleteObject = options.deleteObject ?? deleteObjectAtKey;

  // The query narrows on the same boundary the helper defines, so the composite
  // `(bulletin_id, created_at)` index can do the work.
  const candidates = await db.bulletinAttachment.findMany({
    where: { bulletinId: null, createdAt: { lte: new Date(now.getTime() - ttlMs) } },
    select: { id: true, fileKey: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  let swept = 0;
  let deferred = 0;

  for (const row of candidates) {
    if (!isStagedAttachmentExpired(row.createdAt, now, ttlMs)) continue;
    try {
      await deleteObject(row.fileKey);
    } catch {
      deferred += 1;
      continue;
    }
    await db.bulletinAttachment.delete({ where: { id: row.id } });
    swept += 1;
  }

  return { swept, deferred };
}
