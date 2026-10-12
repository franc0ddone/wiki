/**
 * Client calls to the bulletin API, sharing the editor's error plumbing so the
 * API's own `{ error, code }` reasons reach the UI verbatim.
 */
import { ApiRequestError, request } from "@/lib/editor/api";
import type { Bulletin, ClinicalDepartment } from "@/types/portal";

export interface BulletinPayload {
  title: string;
  body_markdown: string;
  departments: ClinicalDepartment[];
  /** Opt-in flags. */
  pinned?: boolean;
  urgent?: boolean;
  /** The optional muted subtitle under the headline. */
  deck?: string | null;
  /** The optional hero banner. `null` = none. */
  heroImageUrl?: string | null;
  /** Required whenever `heroImageUrl` is set. */
  heroImageAlt?: string | null;
  /** ISO-8601, or `null` for "lives until deleted". */
  expires_at?: string | null;
  linked_article_id?: string | null;
  /**
   * The ids of files staged before the notice existed (uploaded with
   * `stageBulletinAttachment`). The API links them to the notice as it is
   * created or updated, in the same transaction.
   */
  attachment_ids?: string[];
}

export function listBulletins(): Promise<Bulletin[]> {
  return request<Bulletin[]>("/api/bulletins");
}

export function createBulletin(payload: BulletinPayload): Promise<Bulletin> {
  return request<Bulletin>("/api/bulletins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function patchBulletin(id: string, payload: Partial<BulletinPayload>): Promise<Bulletin> {
  return request<Bulletin>(`/api/bulletins/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteBulletin(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/bulletins/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface AckResult {
  bulletin_id: string;
  user_id: string;
  acked_at: string;
  created: boolean;
}

export function acknowledgeBulletin(id: string): Promise<AckResult> {
  return request<AckResult>(`/api/bulletins/${encodeURIComponent(id)}/ack`, { method: "POST" });
}

export interface AckEntry {
  user_id: string;
  name: string;
  acked_at: string;
}

export function getBulletinAcks(id: string): Promise<AckEntry[]> {
  return request<AckEntry[]>(`/api/bulletins/${encodeURIComponent(id)}/ack`);
}

/* --------------------------------------------------------------- reactions */

export interface ReactionSummaryEntry {
  emoji: string;
  count: number;
  viewer_reacted: boolean;
}

export function getBulletinReactions(id: string): Promise<ReactionSummaryEntry[]> {
  return request<ReactionSummaryEntry[]>(`/api/bulletins/${encodeURIComponent(id)}/reactions`);
}

export interface ReactionToggleResponse {
  reacted: boolean;
  summary: ReactionSummaryEntry[];
}

export function toggleBulletinReaction(id: string, emoji: string): Promise<ReactionToggleResponse> {
  return request<ReactionToggleResponse>(`/api/bulletins/${encodeURIComponent(id)}/reactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
}

/* ------------------------------------------------------------- attachments */

/**
 * A file attached to a bulletin. The stored object key is deliberately absent —
 * the bytes are streamed through `bulletinAttachmentDownloadUrl`, never handed
 * out as a raw storage URL.
 */
export interface BulletinAttachmentRecord {
  id: string;
  /**
   * `null` while the file is *staged* — uploaded while writing a notice that has
   * not been posted yet. The composer holds those ids and sends them as
   * `attachment_ids` with the save, which links them.
   */
  bulletin_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_id: string | null;
  created_at: string;
}

export function listBulletinAttachments(bulletinId: string): Promise<BulletinAttachmentRecord[]> {
  return request<BulletinAttachmentRecord[]>(
    `/api/bulletins/${encodeURIComponent(bulletinId)}/attachments`,
  );
}

/**
 * Upload one file against a notice that already exists. The bytes are the raw
 * request body (so the server can stream them against the 25 MB cap) with the
 * file name in a header, exactly as the article attachment upload works. The
 * record comes back already linked to `bulletinId`.
 */
export function uploadBulletinAttachment(
  bulletinId: string,
  file: File,
): Promise<BulletinAttachmentRecord> {
  return request<BulletinAttachmentRecord>(
    `/api/bulletins/${encodeURIComponent(bulletinId)}/attachments`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-attachment-filename": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
}

/**
 * Upload one file *before* the notice exists. The bytes go up the same way; the
 * record comes back with `bulletin_id: null`, and the composer sends its id with
 * the save so `createBulletin` can link it. A staged file that never gets linked
 * is swept 24 h later (`STAGED_ATTACHMENT_TTL_MS`).
 */
export function stageBulletinAttachment(file: File): Promise<BulletinAttachmentRecord> {
  return request<BulletinAttachmentRecord>("/api/bulletins/attachments", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-attachment-filename": encodeURIComponent(file.name),
    },
    body: file,
  });
}

/** Discard a staged file (the composer's "remove" before the notice is saved). */
export async function deleteStagedBulletinAttachment(attachmentId: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/bulletins/attachments?attachmentId=${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
}

/** Remove one attachment. The target rides in the `attachmentId` query parameter. */
export async function deleteBulletinAttachment(bulletinId: string, attachmentId: string): Promise<void> {
  await request<{ ok: boolean }>(
    `/api/bulletins/${encodeURIComponent(bulletinId)}/attachments?attachmentId=${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
}

/** The API endpoint the reader links to; the storage key never reaches the client. */
export function bulletinAttachmentDownloadUrl(bulletinId: string, attachmentId: string): string {
  return `/api/bulletins/${encodeURIComponent(bulletinId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** `1048576` → `1.0 MB`. The one byte formatter, shared with article attachments. */
export { formatBytes } from "@/lib/editor/attachments-api";

export { ApiRequestError };
