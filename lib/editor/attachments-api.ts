/**
 * Client calls for article attachments. The bytes go up as the raw request body
 * (so the server can stream and cap them), with the file name and the PHI
 * confirmation in headers; downloads always go through the API, never a raw
 * storage URL.
 */
import { request } from "@/lib/editor/api";

export interface AttachmentRecord {
  id: string;
  article_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_id: string | null;
  created_at: string;
}

export function listAttachments(slug: string): Promise<AttachmentRecord[]> {
  return request<AttachmentRecord[]>(`/api/articles/${encodeURIComponent(slug)}/attachments`);
}

export function uploadAttachment(slug: string, file: File, phiConfirmed: boolean): Promise<AttachmentRecord> {
  return request<AttachmentRecord>(`/api/articles/${encodeURIComponent(slug)}/attachments`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-attachment-filename": encodeURIComponent(file.name),
      "x-phi-confirmed": phiConfirmed ? "true" : "false",
    },
    body: file,
  });
}

/** The API endpoint the reader links to; the storage key never reaches the client. */
export function attachmentDownloadUrl(slug: string, id: string): string {
  return `/api/articles/${encodeURIComponent(slug)}/attachments/${encodeURIComponent(id)}`;
}

/** `1048576` → `1.0 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
