/**
 * Dead-search telemetry: `POST /api/search-log { query, resultCount, surface }`.
 *
 * Fire-and-forget by contract: never awaited, never allowed to throw, never
 * allowed to slow or break search. The weekly review reads the `search_logs`
 * table for queries that returned nothing and feeds `lib/search/synonyms.ts`.
 *
 * Callers decide *when* a search has settled; this function only enforces the
 * floor (3+ characters) and delivery semantics. `keepalive` lets the request
 * survive the palette closing or the page navigating away.
 */
import type { SearchSurface } from "@/lib/search";

export const MIN_LOGGED_QUERY_LENGTH = 3;

export interface SearchLogEntry {
  query: string;
  resultCount: number;
  surface: SearchSurface;
}

export function logSearch(entry: SearchLogEntry): void {
  const query = entry.query.trim();
  if (query.length < MIN_LOGGED_QUERY_LENGTH) return;

  try {
    void fetch("/api/search-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, resultCount: entry.resultCount, surface: entry.surface }),
      keepalive: true,
    }).catch(() => {
      /* telemetry must never surface an error */
    });
  } catch {
    /* ditto — e.g. fetch unavailable */
  }
}
