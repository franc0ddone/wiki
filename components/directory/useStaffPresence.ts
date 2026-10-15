"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  defaultPresentIds,
  facilityDayKey,
  parsePresence,
  presenceStorageKey,
  serializePresence,
  togglePresence,
} from "@/lib/directory/roster";

/**
 * "Who is here today" for the directory — client-side, localStorage-backed, and
 * keyed by the facility-local day so it resets on its own overnight.
 *
 * The store is read through `useSyncExternalStore` rather than an effect: the
 * server snapshot is `null` ("nothing stored"), which renders the deterministic
 * default subset and is identical on the first client render, so hydration never
 * mismatches and no effect has to set state after paint. Once the browser
 * snapshot is live, a stored list for today takes over — including an *empty*
 * one, which is what "nobody is checked in" looks like.
 *
 * The cache is module-level and holds the parsed list by (day, roster signature),
 * so the snapshot is referentially stable between renders — the contract
 * `useSyncExternalStore` requires — and every subscriber re-renders together.
 *
 * Limitation, deliberately: this is per browser, not per workstation and not
 * shared, so two machines can disagree about who is on the floor. It is
 * demo-grade v1 backed by real records; the production version is a
 * `StaffMember.isPresentToday`-style column (see the surface's docblock).
 */

interface Snapshot {
  /** `"<dayKey>|<rosterSignature>"` — the identity of the parsed list. */
  key: string;
  ids: string[] | null;
}

let cache: Snapshot = { key: "", ids: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readSnapshot(key: string, day: string, validIds: readonly string[]): string[] | null {
  if (cache.key !== key) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(presenceStorageKey(day));
    } catch {
      // Storage unavailable (private mode, blocked cookies): the default subset
      // stands in, and a check-in still animates for this session.
      raw = null;
    }
    cache = { key, ids: parsePresence(raw, validIds) };
  }
  return cache.ids;
}

function writeSnapshot(key: string, day: string, ids: string[]): void {
  cache = { key, ids };
  try {
    window.localStorage.setItem(presenceStorageKey(day), serializePresence(ids));
  } catch {
    // Nothing to do: the session state is still correct on screen.
  }
  emit();
}

export function useStaffPresence(staffIds: readonly string[], excludeId?: string | null) {
  /** Recomputed every render; cheap, and it rolls the surface over at midnight. */
  const day = facilityDayKey(new Date());
  const signature = useMemo(() => staffIds.join("|"), [staffIds]);
  const ids = useMemo(
    () => (signature.length > 0 ? signature.split("|") : []),
    [signature],
  );
  const key = `${day}|${signature}`;

  const stored = useSyncExternalStore(
    subscribe,
    () => readSnapshot(key, day, ids),
    () => null,
  );

  /**
   * The pre-seeded default never includes the viewer: the signed-in person's
   * presence is the one thing on this surface they decide for themselves, and
   * arriving already checked in would make the toggle's first click look like it
   * did nothing (or the opposite of what it says).
   */
  const presentIds = useMemo(() => {
    if (stored !== null) return stored;
    const seedable = excludeId ? staffIds.filter((id) => id !== excludeId) : staffIds;
    return defaultPresentIds(seedable, day);
  }, [stored, staffIds, day, excludeId]);

  const toggle = useCallback(
    (id: string) => {
      if (id.length === 0) return;
      writeSnapshot(key, day, togglePresence(presentIds, id));
    },
    [key, day, presentIds],
  );

  return { presentIds, toggle, day };
}
