/**
 * Client-side calls to the (frozen) article API, with the API's own error
 * reasons carried through verbatim so the editor can show them honestly.
 */
import type { ClinicalDepartment, KnowledgeArticle, KnowledgeArticleStatus } from "@/types/portal";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiRequestError(0, "Could not reach the server. Check your connection and try again.", "network");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; code?: string; details?: Record<string, unknown> }
      | null;
    const fallback =
      response.status === 401
        ? "You are signed out. Sign in again, then retry."
        : `The server refused the request (${response.status}).`;
    throw new ApiRequestError(response.status, body?.error ?? fallback, body?.code ?? "error", body?.details);
  }

  return (await response.json()) as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface CreateArticleBody {
  title: string;
  body_markdown: string;
  departments: ClinicalDepartment[];
}

export function createArticle(body: CreateArticleBody): Promise<KnowledgeArticle> {
  return request<KnowledgeArticle>("/api/articles", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export interface PatchArticleBody {
  title?: string;
  body_markdown?: string;
  departments?: ClinicalDepartment[];
  status?: KnowledgeArticleStatus;
  reviewer_id?: string | null;
  change_summary?: string;
}

export function patchArticle(slug: string, body: PatchArticleBody): Promise<KnowledgeArticle> {
  return request<KnowledgeArticle>(`/api/articles/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export interface UploadResult {
  url: string;
  key: string;
  mime_type: string;
  bytes: number;
  original_bytes: number;
  width: number;
  height: number;
}

export function uploadImage(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  return request<UploadResult>("/api/uploads", { method: "POST", body: form });
}
