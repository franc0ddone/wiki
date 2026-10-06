"use client";

/**
 * Recent palette searches, persisted in localStorage (last 8, newest first).
 *
 * Exposed as an external store so React components read it with
 * `useSyncExternalStore`: the server snapshot is a constant empty list, so the
 * server HTML and first client render agree (no hydration mismatch) and the
 * list appears right after hydration.
 */

const STORAGE_KEY = "dovewiki.recent-searches";
export const MAX_RECENT_SEARCHES = 8;

const EMPTY: readonly string[] = Object.freeze([]);
const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedValue: readonly string[] = EMPTY;

function read(): readonly string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cachedValue;

  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedValue = Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RECENT_SEARCHES)
      : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

function write(values: readonly string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    /* private mode / quota: recents are a convenience, not a requirement */
  }
  listeners.forEach((listener) => listener());
}

export function subscribeRecents(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const getRecentsSnapshot = read;
export const getRecentsServerSnapshot = (): readonly string[] => EMPTY;

export function addRecentSearch(query: string): void {
  const value = query.trim();
  if (value.length < 2) return;
  const next = [value, ...read().filter((entry) => entry.toLowerCase() !== value.toLowerCase())];
  write(next.slice(0, MAX_RECENT_SEARCHES));
}

export function clearRecentSearches(): void {
  write(EMPTY);
}
