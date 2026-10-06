"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Clock, CornerDownLeft, FileText, Lightbulb, Megaphone, Search, User } from "lucide-react";
import { Highlighted } from "@/components/search/Highlighted";
import { useDebouncedValue } from "@/lib/hooks";
import { useSearchShortcutLabel } from "@/lib/platform";
import { search } from "@/lib/search";
import type { SearchHit, SearchIndex, SearchSurface } from "@/lib/search";
import { logSearch } from "@/lib/search/log";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentsServerSnapshot,
  getRecentsSnapshot,
  subscribeRecents,
} from "@/lib/search/recents";
import { cx } from "@/lib/utils";
import { DEPARTMENT_LABELS } from "@/types/portal";

/**
 * Unified command palette. Owns the global `Ctrl+K` / `⌘K` shortcut.
 *
 * Searches procedures, bulletins, and people at once (grouped), highlights the
 * matched terms in titles and snippets, and recovers from empty results
 * (closest matches → synonym suggestions → a plain-language hint).
 *
 * Dialog semantics: `role="dialog"` + `aria-modal`, focus trapped inside and
 * restored on close, `Esc` closes, `↑`/`↓` move through results with focus
 * staying in the input (`aria-activedescendant`), `Enter` opens.
 *
 * Logging (see `lib/search/log.ts`): the query is debounced (120 ms) before
 * Fuse runs. One search-log row is written per palette search, when it ends —
 * with the selected result's surface on `Enter`/click, or `articles` if the
 * palette is closed without a selection. A query the user abandons by retyping
 * is logged only if it returned nothing (that is the signal the weekly
 * dead-search review exists for). Never per keystroke.
 */

const DEBOUNCE_MS = 120;
const MAX_PER_SURFACE: Record<SearchSurface, number> = { articles: 6, bulletins: 5, staff: 5 };

const SURFACE_META: Record<
  SearchSurface,
  { group: string; badge: string; icon: ReactNode }
> = {
  articles: {
    group: "SOPs",
    badge: "SOP",
    icon: <FileText size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  bulletins: {
    group: "Bulletins",
    badge: "Bulletin",
    icon: <Megaphone size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  staff: {
    group: "People",
    badge: "Person",
    icon: <User size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
};

type Row =
  | { kind: "hit"; id: string; hit: SearchHit }
  | { kind: "recent"; id: string; query: string }
  | { kind: "suggestion"; id: string; text: string };

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  index: SearchIndex;
  onOpenResult: (hit: SearchHit) => void;
}

export function CommandPalette({ open, onOpenChange, index, onOpenResult }: CommandPaletteProps) {
  // The palette owns Ctrl/Cmd+K everywhere, including while typing in a field.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;
  return <PaletteDialog index={index} onClose={() => onOpenChange(false)} onOpenResult={onOpenResult} />;
}

function PaletteDialog({
  index,
  onClose,
  onOpenResult,
}: {
  index: SearchIndex;
  onClose: () => void;
  onOpenResult: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const recents = useSyncExternalStore(subscribeRecents, getRecentsSnapshot, getRecentsServerSnapshot);
  const shortcut = useSearchShortcutLabel();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingLog = useRef<{ query: string; resultCount: number } | null>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const trimmed = query.trim();
  const settled = debounced.trim();
  const isEmptyQuery = trimmed.length === 0;
  const isPending = !isEmptyQuery && settled.length === 0;

  const outcome = useMemo(() => search(index, settled), [index, settled]);

  /* ---- focus: take it on open, give it back on close ------------------- */
  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      openerRef.current?.focus?.();
    };
  }, []);

  /* ---- logging --------------------------------------------------------- */
  useEffect(() => {
    const previous = pendingLog.current;
    if (previous && previous.query !== settled && previous.resultCount === 0) {
      logSearch({ query: previous.query, resultCount: 0, surface: "articles" });
    }
    pendingLog.current = settled.length >= 3 ? { query: settled, resultCount: outcome.total } : null;
  }, [settled, outcome.total]);

  // Closing without a selection logs the final settled query against `articles`.
  useEffect(
    () => () => {
      const pending = pendingLog.current;
      if (pending) {
        pendingLog.current = null;
        logSearch({ query: pending.query, resultCount: pending.resultCount, surface: "articles" });
      }
    },
    [],
  );

  /* ---- rows ------------------------------------------------------------ */
  const { rows, groups } = useMemo(() => {
    const collected: Row[] = [];
    const sections: Array<{ key: string; label: string; icon: ReactNode; rows: Row[] }> = [];

    if (isEmptyQuery) {
      const recentRows = recents.map<Row>((recent, i) => ({ kind: "recent", id: `recent-${i}`, query: recent }));
      collected.push(...recentRows);
      if (recentRows.length > 0) {
        sections.push({ key: "recent", label: "Recent searches", icon: <Clock size={12} aria-hidden="true" />, rows: recentRows });
      }
    } else if (!isPending && outcome.total > 0) {
      (["articles", "bulletins", "staff"] as const).forEach((surface) => {
        const hits = outcome.bySurface[surface].slice(0, MAX_PER_SURFACE[surface]);
        if (hits.length === 0) return;
        const surfaceRows = hits.map<Row>((hit) => ({ kind: "hit", id: `${surface}-${hit.id}`, hit }));
        collected.push(...surfaceRows);
        sections.push({ key: surface, label: SURFACE_META[surface].group, icon: SURFACE_META[surface].icon, rows: surfaceRows });
      });
    } else if (!isPending) {
      const closestRows = outcome.closest.map<Row>((hit) => ({ kind: "hit", id: `closest-${hit.surface}-${hit.id}`, hit }));
      const suggestionRows = outcome.suggestions.map<Row>((text, i) => ({ kind: "suggestion", id: `suggest-${i}`, text }));
      collected.push(...closestRows, ...suggestionRows);
      if (closestRows.length > 0) {
        sections.push({ key: "closest", label: "Closest matches", icon: <Search size={12} aria-hidden="true" />, rows: closestRows });
      }
      if (suggestionRows.length > 0) {
        sections.push({ key: "suggest", label: "Try", icon: <Lightbulb size={12} aria-hidden="true" />, rows: suggestionRows });
      }
    }

    return { rows: collected, groups: sections };
  }, [isEmptyQuery, isPending, outcome, recents]);

  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const optionId = (row: Row) => `${baseId}-${row.id}`;

  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(`${baseId}-${rows[activeIndex].id}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, rows, baseId]);

  /* ---- actions --------------------------------------------------------- */
  const selectHit = useCallback(
    (hit: SearchHit) => {
      const pending = pendingLog.current;
      if (pending) {
        pendingLog.current = null;
        logSearch({ query: pending.query, resultCount: pending.resultCount, surface: hit.surface });
      }
      addRecentSearch(query);
      onClose();
      onOpenResult(hit);
    },
    [query, onClose, onOpenResult],
  );

  const activate = useCallback(
    (row: Row) => {
      if (row.kind === "hit") {
        selectHit(row.hit);
      } else {
        const next = row.kind === "recent" ? row.query : row.text;
        setQuery(next);
        setActive(0);
        inputRef.current?.focus();
      }
    },
    [selectHit],
  );

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      // Don't let a drawer or dialog underneath also close.
      event.nativeEvent.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "Tab" && dialogRef.current) {
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>("input, button:not([disabled])"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (rows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % rows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + rows.length) % rows.length);
    } else if (event.key === "Home" && event.target === inputRef.current && event.ctrlKey) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      activate(rows[activeIndex]);
    }
  };

  const statusMessage = isEmptyQuery
    ? recents.length > 0
      ? `${recents.length} recent searches`
      : "Type to search"
    : isPending
      ? "Searching"
      : outcome.total > 0
        ? `${outcome.total} result${outcome.total === 1 ? "" : "s"}`
        : "No results";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/30 px-4 pb-6 pt-[10vh] backdrop-blur-[2px] print:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search procedures, bulletins, and people"
        onKeyDown={handleKeyDown}
        className="animate-palette-in flex max-h-[min(34rem,80dvh)] w-full max-w-[40rem] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_64px_-16px_rgba(24,24,27,0.35),0_2px_8px_rgba(24,24,27,0.08)]"
      >
        {/* Input */}
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-4">
          <Search size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(rows[activeIndex]) : undefined}
            aria-label="Search"
            placeholder="Search procedures, bulletins, people…"
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
          />
          <kbd className="hidden h-[20px] shrink-0 items-center rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-xs font-medium text-zinc-500 sm:flex">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div id={listId} role="listbox" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {groups.map((group) => (
            <div key={group.key} role="group" aria-labelledby={`${baseId}-g-${group.key}`} className="mb-1 last:mb-0">
              <div className="flex items-center justify-between px-2 pb-1 pt-2">
                <p
                  id={`${baseId}-g-${group.key}`}
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500"
                >
                  {group.icon}
                  {group.label}
                </p>
                {group.key === "recent" ? (
                  <button
                    type="button"
                    onClick={() => clearRecentSearches()}
                    className="rounded-md px-1.5 py-0.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              {group.rows.map((row) => {
                const rowIndex = rows.indexOf(row);
                return (
                  <PaletteRow
                    key={row.id}
                    row={row}
                    id={optionId(row)}
                    isActive={rowIndex === activeIndex}
                    onHover={() => setActive(rowIndex)}
                    onActivate={() => activate(row)}
                  />
                );
              })}
            </div>
          ))}

          {rows.length === 0 && isEmptyQuery ? <IdleState /> : null}
          {!isEmptyQuery && !isPending && outcome.total === 0 ? <RecoveryHint query={trimmed} hasSuggestions={outcome.suggestions.length > 0} hasClosest={outcome.closest.length > 0} /> : null}
          {isPending ? <div className="h-24" aria-hidden="true" /> : null}
        </div>

        {/* Footer: 12px functional text */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50/80 px-4 py-2.5 text-xs text-zinc-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>
                <CornerDownLeft size={11} strokeWidth={2} aria-hidden="true" />
                <span className="sr-only">Enter</span>
              </Kbd>
              Open
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              Close
            </span>
          </div>
          <span className="hidden tabular-nums sm:inline">
            {isEmptyQuery || isPending ? shortcut : `${outcome.total} result${outcome.total === 1 ? "" : "s"}`}
          </span>
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {statusMessage}
        </p>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-zinc-300/80 bg-white px-1 font-sans text-xs font-medium text-zinc-600">
      {children}
    </kbd>
  );
}

function PaletteRow({
  row,
  id,
  isActive,
  onHover,
  onActivate,
}: {
  row: Row;
  id: string;
  isActive: boolean;
  onHover: () => void;
  onActivate: () => void;
}) {
  const base = cx(
    "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-100",
    isActive ? "bg-teal-50 ring-1 ring-inset ring-teal-600/25" : "hover:bg-zinc-50",
  );

  if (row.kind === "recent") {
    return (
      <div id={id} role="option" aria-selected={isActive} onMouseMove={onHover} onClick={onActivate} className={base}>
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-400">
          <Clock size={13} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-800">{row.query}</span>
      </div>
    );
  }

  if (row.kind === "suggestion") {
    return (
      <div id={id} role="option" aria-selected={isActive} onMouseMove={onHover} onClick={onActivate} className={base}>
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-[#0F766E]">
          <Lightbulb size={13} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-800">
          Try <em className="font-semibold not-italic text-teal-800">{row.text}</em>
        </span>
      </div>
    );
  }

  const { hit } = row;
  const meta = SURFACE_META[hit.surface];
  const shownDepartments = hit.departments.slice(0, 2);
  const extraDepartments = hit.departments.length - shownDepartments.length;

  return (
    <div id={id} role="option" aria-selected={isActive} onMouseMove={onHover} onClick={onActivate} className={base}>
      <span
        aria-hidden="true"
        className={cx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-white",
          isActive ? "border-teal-200 text-[#0F766E]" : "border-zinc-200 text-zinc-500",
        )}
      >
        {meta.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-zinc-900">
            <Highlighted text={hit.title} ranges={hit.titleRanges} />
          </span>
          <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-px text-xs font-medium text-zinc-600">
            {meta.badge}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] leading-5 text-zinc-500">
          <Highlighted text={hit.snippet.text} ranges={hit.snippet.ranges} />
        </span>
      </span>
      {shownDepartments.length > 0 ? (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {shownDepartments.map((department) => (
            <span
              key={department}
              className="whitespace-nowrap rounded-full border border-teal-600/30 bg-teal-50/50 px-2 py-px text-xs font-medium text-teal-700"
            >
              {DEPARTMENT_LABELS[department]}
            </span>
          ))}
          {extraDepartments > 0 ? <span className="text-xs font-medium text-zinc-500">+{extraDepartments}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function IdleState() {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-[13.5px] font-semibold text-zinc-800">Search everything at once</p>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-5 text-zinc-500">
        Procedures, bulletins, and people. Try <code className="rounded bg-zinc-100 px-1 py-px font-mono text-xs">parvo isolation</code>,{" "}
        <code className="rounded bg-zinc-100 px-1 py-px font-mono text-xs">epi dose</code>, or a colleague’s name.
      </p>
    </div>
  );
}

function RecoveryHint({
  query,
  hasSuggestions,
  hasClosest,
}: {
  query: string;
  hasSuggestions: boolean;
  hasClosest: boolean;
}) {
  return (
    <div className="px-4 pb-4 pt-3">
      <p className="text-[13.5px] font-semibold text-zinc-800">
        {hasClosest ? "No exact matches for" : "Nothing found for"} “{query}”
      </p>
      <p className="mt-1.5 text-[12.5px] leading-5 text-zinc-500">
        {hasSuggestions ? "Choose a suggestion above, or t" : "T"}ry fewer words —{" "}
        <code className="rounded bg-zinc-100 px-1 py-px font-mono text-xs">parvo isolation</code> beats{" "}
        <code className="rounded bg-zinc-100 px-1 py-px font-mono text-xs">what is the canine parvovirus isolation protocol</code>.
        Abbreviations and common misspellings work too.
      </p>
    </div>
  );
}
