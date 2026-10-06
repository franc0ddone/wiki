"use client";

import { useEffect, useRef, useState } from "react";
import { logSearch } from "@/lib/search/log";
import type { SearchSurface } from "@/lib/search";

/**
 * A value that follows `value` only after it has stopped changing for `delay`
 * ms. Search runs on the debounced value, never on each keystroke.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** How long a query must sit unchanged before it counts as a settled search. */
export const SEARCH_SETTLE_MS = 800;

/**
 * Log a per-view search once it has *settled*: the (already debounced) query
 * has stopped changing for `SEARCH_SETTLE_MS`, it is at least 3 characters
 * long, and it has not been logged already. Fire-and-forget — see `logSearch`.
 * Typing "parvo" produces one log for "parvo", not five.
 */
export function useSettledSearchLog(query: string, resultCount: number, surface: SearchSurface): void {
  const lastLogged = useRef<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      lastLogged.current = null;
      return;
    }
    const key = `${surface}:${trimmed.toLowerCase()}`;
    const timer = setTimeout(() => {
      if (lastLogged.current === key) return;
      lastLogged.current = key;
      logSearch({ query: trimmed, resultCount, surface });
    }, SEARCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [query, resultCount, surface]);
}
