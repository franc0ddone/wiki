"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_READER_FONT_SIZE,
  READER_FONT_STORAGE_KEY,
  parseReaderFontSize,
  toggleReaderFontSize,
  type ReaderFontSize,
} from "@/lib/reader/font-scale";

/**
 * The workstation's reader text-size preference, backed by localStorage.
 *
 * Modelled on `lib/platform.ts`: a `useSyncExternalStore` store, **not** a
 * `useEffect(() => setState(...))`. The effect form fails the repo's
 * `react-hooks` purity lint *and* risks a hydration mismatch (the server cannot
 * read localStorage). Here the server snapshot is the default, so SSR and the
 * first client render agree; a workstation that chose "Large" re-renders once.
 *
 * Same-tab writes notify through a tiny listener set; other tabs arrive via the
 * `storage` event.
 */

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === READER_FONT_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ReaderFontSize {
  try {
    return parseReaderFontSize(window.localStorage.getItem(READER_FONT_STORAGE_KEY));
  } catch {
    // Private mode / storage disabled: fall back to the default.
    return DEFAULT_READER_FONT_SIZE;
  }
}

function getServerSnapshot(): ReaderFontSize {
  return DEFAULT_READER_FONT_SIZE;
}

export function useReaderFontSize(): { size: ReaderFontSize; toggle: () => void } {
  const size = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = toggleReaderFontSize(getSnapshot());
    try {
      window.localStorage.setItem(READER_FONT_STORAGE_KEY, next);
    } catch {
      // Storage unavailable — apply for this session only.
    }
    emit();
  }, []);

  return { size, toggle };
}
