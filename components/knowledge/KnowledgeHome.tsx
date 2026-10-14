"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, X } from "lucide-react";
import { MasterDetailShell } from "@/components/MasterDetailShell";
import { AudienceSwitcher } from "@/components/knowledge/AudienceSwitcher";
import { BrandLockup } from "@/components/knowledge/BrandLockup";
import { DepartmentChips } from "@/components/knowledge/DepartmentChips";
import { SopFeedList } from "@/components/knowledge/SopFeedList";
import { SopSearchHero } from "@/components/knowledge/SopSearchHero";
import { useDebouncedValue } from "@/lib/hooks";
import {
  ESSENTIAL_SECTION_LABEL,
  RESULTS_BANNER_TEXT,
  defaultAudience,
  departmentCounts,
  departmentOptions,
  essentialArticles,
  feedArticles,
  searchFeedArticles,
} from "@/lib/knowledge/feed";
import type { SearchIndex } from "@/lib/search";
import type {
  ArticleAudience,
  Department,
  KnowledgeArticle,
  StaffType,
} from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * **The Knowledge Home surface** (prompt 7c) — one surface, two modes.
 *
 * *Feed Mode* (the search hero is empty): the Essential SOPs section, the
 * audience switcher, the corpus-derived department chips, and the published
 * procedures ranked strictly by when they last went live.
 *
 * *Results Mode* (the hero has non-whitespace text): the Essential section
 * collapses, the audience switcher and the department chips are bypassed, and
 * the whole **published corpus** is searched through the shared Fuse index and
 * rendered relevance-first in the very same row component. The active filters
 * are kept, not reset, so clearing the query restores Feed Mode exactly where
 * the reader left it.
 *
 * Where things live:
 *  - the rules (ordering, audience derivation, Essential selection, version-jump
 *    formatting, chip derivation) are pure and unit-tested in
 *    `lib/knowledge/feed.ts`;
 *  - the relative publish time is `lib/knowledge/relative-time.ts`;
 *  - the row is `SopFeedList`, shared by both modes;
 *  - the master/detail shell, its chrome, and the reader pane are unchanged —
 *    this component only supplies the rail's header and list.
 *
 * **Nothing here is a permission boundary.** `audience`/`staffType` pick the
 * default view; every reader can switch, search the whole corpus, and open any
 * procedure. The detail pane is the 7a reader, which `/procedures/<slug>`
 * redirects into.
 */

/** Matches the portal's other per-view search fields. */
const SEARCH_DEBOUNCE_MS = 150;

export interface KnowledgeHomeProps {
  /** Every article, published and draft. The feed itself only ever shows published ones. */
  articles: readonly KnowledgeArticle[];
  /** The shared client-side Fuse index (built once per dataset by the shell). */
  index: SearchIndex;
  /** The viewer's staff type, or `null` when nothing is on file. Not a permission. */
  staffType: StaffType | null;
  /** The current search query — owned by the portal shell so the palette agrees. */
  query: string;
  onQueryChange: (value: string) => void;
  /** Rail actions (the "New procedure" link), owned by the portal shell. */
  listActions?: ReactNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The reader pane, already resolved by the portal shell. */
  detail: ReactNode | null;
  /** A ticking "now", so relative publish times match the rest of the portal. */
  now: number;
}

export function KnowledgeHome({
  articles,
  index,
  staffType,
  query,
  onQueryChange,
  listActions,
  selectedId,
  onSelect,
  detail,
  now,
}: KnowledgeHomeProps) {
  const [audience, setAudience] = useState<ArticleAudience>(() => defaultAudience(staffType));
  const [department, setDepartment] = useState<Department>("All");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const searching = query.trim().length > 0;
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  /**
   * Rank on the debounced query, but fall back to what is on screen while the
   * debounce is still settling — otherwise the first keystrokes of a search
   * flash an empty result list. Clearing is instant (the mode flips on the raw
   * query), which is what makes "clear to return to Feed Mode" feel immediate.
   */
  const rankQuery = searching ? (debouncedQuery.trim().length > 0 ? debouncedQuery : query) : "";

  /* Feed Mode: depth-ordered, audience- and department-filtered. */
  const feed = useMemo(
    () => feedArticles(articles, { audience, department }),
    [articles, audience, department],
  );
  /** The curated section — hidden entirely when nothing matches. */
  const essential = useMemo(
    () => (searching ? [] : essentialArticles(articles, audience)),
    [articles, audience, searching],
  );
  /* Results Mode: the whole published corpus, relevance-ranked, filters bypassed. */
  const results = useMemo(
    () => (searching ? searchFeedArticles(articles, index, rankQuery) : []),
    [articles, index, searching, rankQuery],
  );

  const items = searching ? results : feed;
  const chipOptions = useMemo(() => departmentOptions(articles, audience), [articles, audience]);
  const chipCounts = useMemo(() => departmentCounts(articles, audience), [articles, audience]);
  const publishedCount = useMemo(
    () => articles.filter((article) => article.status === "published").length,
    [articles],
  );

  /**
   * **Ctrl+Space** focuses the search hero, from anywhere on the surface.
   *
   * The shortcut is bound here, once, and only while this surface is mounted
   * (the portal shell renders it only when the Knowledge Home is the active
   * view) — so it cannot double-fire and cannot fight the command palette, which
   * owns Ctrl+K and is the only other global search shortcut in the app.
   * Nothing else in the repository binds Ctrl+Space.
   *
   * Guarded the same way the rail's search field is: while a modal sheet is open
   * (`aria-modal` — the palette, a reader dialog) the keystroke is left alone.
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.code !== "Space" && event.key !== " ") return;
      if (document.querySelector("[aria-modal='true']")) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  /** The combined-filter escape hatch: Audience → All, Department → All Departments. */
  const resetFilters = useCallback(() => {
    setAudience("ALL");
    setDepartment("All");
  }, []);

  const clearSearch = useCallback(() => onQueryChange(""), [onQueryChange]);

  return (
    <MasterDetailShell
      className="dw-knowledge"
      items={items}
      getId={(article) => article.id}
      selectedId={selectedId}
      onSelect={onSelect}
      listTitle="Knowledge Home"
      listSubtitle={
        searching
          ? `${items.length} result${items.length === 1 ? "" : "s"}`
          : `${items.length} of ${publishedCount}`
      }
      listActions={listActions}
      leadingGroup={
        essential.length > 0
          ? {
              label: ESSENTIAL_SECTION_LABEL,
              items: essential,
              renderItem: (article, isSelected) => (
                <SopFeedList article={article} isSelected={isSelected} now={now} variant="essential" />
              ),
            }
          : undefined
      }
      railTop={<BrandLockup />}
      searchField={
        <SopSearchHero
          inputRef={searchRef}
          value={query}
          onChange={onQueryChange}
          label="Search all published standard operating procedures"
          placeholder="Search all published SOPs"
        />
      }
      headerExtras={searching ? <ResultsBanner onClear={clearSearch} /> : <AudienceSwitcher value={audience} onChange={setAudience} />}
      /* Results Mode bypasses the department filter, so the chips go with it. */
      departmentChips={
        searching ? null : (
          <DepartmentChips
            options={chipOptions}
            active={department}
            onChange={setDepartment}
            counts={chipCounts}
          />
        )
      }
      renderListItem={(article, isSelected) => (
        <SopFeedList article={article} isSelected={isSelected} now={now} />
      )}
      /* The shell's defaults are replaced above; these keep the props honest so
         the shell can still fall back to its own controls if a slot is ever
         removed. */
      searchQuery={query}
      onSearchChange={onQueryChange}
      searchPlaceholder="Search all published SOPs"
      searchLabel="Search all published standard operating procedures"
      activeDepartment={department}
      onDepartmentChange={setDepartment}
      counts={chipCounts}
      detail={detail}
      detailLabel="Procedure reader"
      emptyListState={
        searching ? (
          <EmptyPanel
            title="No published SOPs match this search."
            message="Try fewer words, or a clinical abbreviation such as “epi”."
            action={{ label: "Clear search", onClick: clearSearch }}
          />
        ) : (
          <EmptyPanel
            title="No published SOPs match these filters."
            message="Another audience or department may hold what you are after."
            action={{ label: "Reset filters", onClick: resetFilters }}
          />
        )
      }
      emptyDetailState={
        <EmptyPanel
          title="No procedure open"
          message={
            searching
              ? "Choose a result from the list to read it here."
              : "Choose a procedure from the feed to read it here."
          }
        />
      }
    />
  );
}

/**
 * Results Mode's header: what the search is doing, and the way back to Feed
 * Mode. Clearing here keeps the audience and department filters the reader had
 * set before they typed.
 */
function ResultsBanner({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-lg border border-[#5F6E00]/25 bg-[#AFBE23]/12 px-2.5 py-2">
      <p className="text-[11.5px] leading-4 text-[#3F4A00]">{RESULTS_BANNER_TEXT}</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md border border-[#5F6E00]/30 bg-white px-2 text-[11.5px] font-medium text-[#3F4A00] transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45"
      >
        <X size={11} strokeWidth={2.25} aria-hidden="true" />
        Clear search
      </button>
    </div>
  );
}

/**
 * A Clinical Light empty state with an optional escape action. Deliberately a
 * local copy of the portal's `EmptyState` shape: this one carries a button, and
 * the portal's version is scoped to the bulletin and directory surfaces.
 */
function EmptyPanel({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex max-w-xs flex-col items-center gap-2 text-center">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-zinc-300/60 bg-white text-[#5F6E00] shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-1 text-[13.5px] font-semibold text-zinc-800">{title}</p>
      <p className="text-[12.5px] leading-5 text-zinc-500">{message}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={cx(
            "mt-1 flex h-7 items-center rounded-md border border-[#5F6E00]/30 bg-white px-2.5 text-[12px] font-medium text-[#3F4A00]",
            "transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45",
          )}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export default KnowledgeHome;
