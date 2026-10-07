/**
 * Client calls to the bulletin API, sharing the editor's error plumbing so the
 * API's own `{ error, code }` reasons reach the UI verbatim.
 */
import { ApiRequestError, request } from "@/lib/editor/api";
import type { Bulletin, ClinicalDepartment } from "@/types/portal";
import type { BulletinPriority } from "@/types/portal";

export interface BulletinPayload {
  title: string;
  body_markdown: string;
  departments: ClinicalDepartment[];
  priority: BulletinPriority;
  /** ISO-8601, `null` for "never", or omitted to apply the priority default. */
  expires_at?: string | null;
  linked_article_id?: string | null;
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

export { ApiRequestError };
