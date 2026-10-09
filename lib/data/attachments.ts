import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/api";

/**
 * Article attachment access.
 *
 * Attachments belong to the *article*, not to a version, so they persist across
 * republication. The stored `file_key` never crosses the wire: the client-
 * facing record omits it, and the bytes are streamed through the API
 * (`GET /api/articles/[slug]/attachments/[id]`) rather than from a raw storage
 * URL.
 */

/** The shape the reader and the API list return. No storage key, ever. */
export interface AttachmentRecord {
  id: string;
  article_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_id: string | null;
  created_at: string;
}

/** Server-only: the list record plus the object key, for the download route. */
export interface StoredAttachmentRecord extends AttachmentRecord {
  file_key: string;
}

interface AttachmentRow {
  id: string;
  articleId: string;
  fileName: string;
  fileKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: Date;
}

function toRecord(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    article_id: row.articleId,
    file_name: row.fileName,
    mime_type: row.mimeType,
    size_bytes: row.sizeBytes,
    uploaded_by_id: row.uploadedById,
    created_at: row.createdAt.toISOString(),
  };
}

async function articleIdForSlug(slug: string): Promise<string> {
  const row = await getDb().article.findUnique({ where: { slug }, select: { id: true } });
  if (!row) throw new ApiError(404, `No article with slug \`${slug}\` exists.`);
  return row.id;
}

export interface CreateAttachmentInput {
  slug: string;
  file_name: string;
  file_key: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_id: string | null;
}

/** Record an attachment that has already been stored in object storage. */
export async function createAttachment(input: CreateAttachmentInput): Promise<AttachmentRecord> {
  const articleId = await articleIdForSlug(input.slug);
  const row = await getDb().articleAttachment.create({
    data: {
      articleId,
      fileName: input.file_name,
      fileKey: input.file_key,
      mimeType: input.mime_type,
      sizeBytes: input.size_bytes,
      uploadedById: input.uploaded_by_id,
    },
  });
  return toRecord(row);
}

/** Every attachment on an article, oldest first. 404 for an unknown article. */
export async function listAttachments(slug: string): Promise<AttachmentRecord[]> {
  const articleId = await articleIdForSlug(slug);
  const rows = await getDb().articleAttachment.findMany({
    where: { articleId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toRecord);
}

/**
 * The attachment record plus its object key, for the download route only. 404
 * when either the article or the attachment is unknown, or when the attachment
 * belongs to a different article.
 */
export async function getAttachmentForDownload(slug: string, id: string): Promise<StoredAttachmentRecord> {
  const articleId = await articleIdForSlug(slug);
  const row = await getDb().articleAttachment.findUnique({ where: { id } });
  if (!row || row.articleId !== articleId) {
    throw new ApiError(404, `No attachment with id \`${id}\` on this article.`);
  }
  return { ...toRecord(row), file_key: row.fileKey };
}
