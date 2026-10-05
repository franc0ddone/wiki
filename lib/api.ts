/**
 * HTTP plumbing shared by every route handler.
 *
 * One error type, one translation to a response. Domain code throws
 * `ApiError`; handlers catch and hand it to `errorResponse()`. Nothing else in
 * the codebase inspects a status code.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra payload merged into the error body (e.g. field-level detail). */
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, options: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code ?? defaultCode(status);
    this.details = options.details;
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 405:
      return "method_not_allowed";
    case 409:
      return "conflict";
    case 413:
      return "payload_too_large";
    case 415:
      return "unsupported_media_type";
    case 422:
      return "unprocessable_entity";
    case 429:
      return "rate_limited";
    case 503:
      return "service_unavailable";
    default:
      return status >= 500 ? "internal_error" : "error";
  }
}

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data as unknown, init);
}

/**
 * Translate any thrown value into a JSON response.
 *
 * Unexpected errors are logged server-side and reported to the client as a
 * generic 500 — an internal message (a driver error, a stack fragment) never
 * crosses the wire.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) },
      { status: error.status },
    );
  }

  console.error("[api] unhandled error:", error);
  return Response.json({ error: "Internal server error.", code: "internal_error" }, { status: 500 });
}

/** Parse a JSON request body, rejecting malformed or non-object payloads. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  options: { maxLength?: number; minLength?: number } = {},
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(422, `\`${field}\` is required and must be a non-empty string.`, {
      details: { field },
    });
  }
  const trimmed = value.trim();
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new ApiError(422, `\`${field}\` must be at most ${options.maxLength} characters.`, {
      details: { field },
    });
  }
  if (options.minLength && trimmed.length < options.minLength) {
    throw new ApiError(422, `\`${field}\` must be at least ${options.minLength} characters.`, {
      details: { field },
    });
  }
  return trimmed;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  options: { maxLength?: number } = {},
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ApiError(422, `\`${field}\` must be a string.`, { details: { field } });
  }
  const trimmed = value.trim();
  if (options.maxLength && trimmed.length > options.maxLength) {
    throw new ApiError(422, `\`${field}\` must be at most ${options.maxLength} characters.`, {
      details: { field },
    });
  }
  return trimmed;
}

/** A list of non-empty strings, de-duplicated, order preserved. */
export function requireStringArray(
  body: Record<string, unknown>,
  field: string,
  options: { allowEmpty?: boolean } = {},
): string[] {
  const value = body[field];
  if (value === undefined && options.allowEmpty) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new ApiError(422, `\`${field}\` must be an array of strings.`, { details: { field } });
  }
  const cleaned = [...new Set(value.map((entry) => (entry as string).trim()).filter(Boolean))];
  if (cleaned.length === 0 && !options.allowEmpty) {
    throw new ApiError(422, `\`${field}\` must contain at least one value.`, { details: { field } });
  }
  return cleaned;
}

export function optionalStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return requireStringArray(body, field, { allowEmpty: true });
}

/** Parse an ISO-8601 timestamp, rejecting anything `new Date` would coerce. */
export function optionalDate(body: Record<string, unknown>, field: string): Date | null | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(422, `\`${field}\` must be an ISO-8601 date string or null.`, {
      details: { field },
    });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(422, `\`${field}\` is not a valid ISO-8601 date string.`, { details: { field } });
  }
  return parsed;
}
