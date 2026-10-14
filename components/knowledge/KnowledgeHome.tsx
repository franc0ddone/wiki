"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { ArrowLeft, BookOpen, X } from "lucide-react";
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
  PortalView,
  StaffType,
} from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * **The Knowledge Home surface** — one full-width clinical surface, two modes.
 *
 * *Feed Mode* (the search hero is empty): the Essential SOPs group, the
 * audience switcher, the corpus-derived department chips, and the published
 * procedures ranked strictly by when they last went live.
 *
 * *Results Mode* (the hero has non-whitespace text): the Essential group
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
 *  - the row is `SopFeedList`, shared by both modes and both groups;
 *  - the search hero is `SopSearchHero`, the brand slot is `BrandLockup`.
 *
 * **Layout.** There is no master/detail shell here — the surface is a single
 * full-width column, the same no-sidebar architecture as the 7a SOP reader and
 * the bulletin board. A full-bleed dark header band (`#20241E`, the bulletin
 * hero's ground) anchors the top and carries the brand lockup, the portal
 * navigation, the write entry point, and the one search input on the page;
 * everything below it lives on the Clinical Light canvas inside a centered
 * workstation container. Selecting a row opens the 7a reader in place of the
 * feed — never beside it.
 *
 * **Nothing here is a permission boundary.** `audience`/`staffType` pick the
 * default view; every reader can switch, search the whole corpus, and open any
 * procedure. The reader pane is the 7a reader, which `/procedures/<slug>`
 * redirects into.
 */

/** Matches the portal's other per-view search fields. */
const SEARCH_DEBOUNCE_MS = 150;

/** The workstation container the band's inner content and the feed share. */
const CONTAINER = "mx-auto w-full max-w-5xl px-4 sm:px-6";

/** The feed's caption in browse mode, and the one Results Mode swaps in. */
const FEED_SECTION_LABEL = "Recently Published";
const RESULTS_SECTION_LABEL = "Search Results";

/** The quiet reset affordance, shared by the filter bar and the empty states. */
const RESET_BUTTON_CLASS =
  "flex h-7 shrink-0 items-center rounded-md border border-[#5F6E00]/30 bg-white px-2.5 text-[12px] font-medium text-[#3F4A00] transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45";

/** The band's navigation targets, in reading order. */
const NAV_ITEMS: readonly { view: PortalView; label: string }[] = [
  { view: "bulletins", label: "Bulletins" },
  { view: "knowledge", label: "Procedures" },
];

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
  /** The write entry point (the "New SOP" link), gated and owned by the portal shell. */
  listActions?: ReactNode;
  /**
   * The portal's section switch, so the band's Bulletins/Procedures navigation
   * can move between surfaces. Optional: the surface renders its navigation
   * regardless, and without a handler the links simply do not move the shell.
   */
  onNavigate?: (view: PortalView) => void;
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
  onNavigate,
  selectedId,
  onSelect,
  detail,
  now,
}: KnowledgeHomeProps) {
  /** The switcher position this viewer starts on; what "Reset filters" returns to. */
  const defaultView = useMemo(() => defaultAudience(staffType), [staffType]);
  const [audience, setAudience] = useState<ArticleAudience>(defaultView);
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
  /** The curated group — hidden entirely when nothing matches. */
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
  /** The filters are away from where this viewer started, so the bar offers its reset. */
  const filtersTouched = audience !== defaultView || department !== "All";

  /**
   * **Ctrl+Space** focuses the search hero, from anywhere on the surface.
   *
   * The shortcut is bound here, once, and only while this surface is mounted
   * (the portal shell renders it only when the Knowledge Home is the active
   * view) — so it cannot double-fire and cannot fight the command palette, which
   * owns Ctrl+K and is the only other global search shortcut in the app.
   * Nothing else in the repository binds Ctrl+Space, and nothing here relies on
   * the master/detail shell for the ref or the listener.
   *
   * Guarded the way the palette's own shortcut is: while a modal sheet is open
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

  /** The combined-filter escape hatch: Audience back to this viewer's own, Department to All. */
  const resetFilters = useCallback(() => {
    setAudience(defaultView);
    setDepartment("All");
  }, [defaultView]);

  const clearSearch = useCallback(() => onQueryChange(""), [onQueryChange]);

  const reading = selectedId !== null && detail !== null;
  const countLabel = searching
    ? `${items.length} result${items.length === 1 ? "" : "s"} across the published corpus`
    : `${items.length} of ${publishedCount} published procedures`;

  /**
   * The reader takes the surface over completely — the 7a reader is the same
   * full-width column the feed uses, so there is one column and never two
   * panes. The back control is the surface's, not the shell's.
   */
  if (reading) {
    return (
      <div className="dw-knowledge flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        <div className="shrink-0 border-b border-zinc-200 bg-white print:hidden">
          <div className={cx(CONTAINER, "flex items-center py-2")}>
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[#3F4A00] transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45"
            >
              <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
              Knowledge Home
            </button>
          </div>
        </div>
        <div
          data-scroll-root
          aria-label="Procedure reader"
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto print:overflow-visible"
        >
          {detail}
        </div>
      </div>
    );
  }

  return (
    <div className="dw-knowledge flex min-h-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto print:overflow-visible">
        <KnowledgeHeader
          query={query}
          onQueryChange={onQueryChange}
          inputRef={searchRef}
          actions={listActions}
          onNavigate={onNavigate}
          countLabel={countLabel}
        />

        <div className={cx(CONTAINER, "pb-14 pt-4 sm:pt-5")}>
          <div className="space-y-5">
            {searching ? (
              <ResultsBanner onClear={clearSearch} />
            ) : (
              <FilterBar
                audience={audience}
                onAudienceChange={setAudience}
                department={department}
                onDepartmentChange={setDepartment}
                chipOptions={chipOptions}
                chipCounts={chipCounts}
                touched={filtersTouched}
                onReset={resetFilters}
              />
            )}

            {essential.length > 0 ? (
              <FeedGroup
                label={ESSENTIAL_SECTION_LABEL}
                items={essential}
                variant="essential"
                selectedId={selectedId}
                onSelect={onSelect}
                now={now}
              />
            ) : null}

            {items.length > 0 ? (
              <FeedGroup
                label={searching ? RESULTS_SECTION_LABEL : FEED_SECTION_LABEL}
                items={items}
                selectedId={selectedId}
                onSelect={onSelect}
                now={now}
              />
            ) : (
              <div className="rounded-xl border border-zinc-200 bg-white px-6 py-14">
                <div className="flex justify-center">
                  {searching ? (
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
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ header band */

/**
 * The dark header band (`#20241E`, the bulletin hero's ground) at the top of the
 * surface: the brand lockup and the portal navigation on the top rule, the
 * "New SOP" write entry point beside them, and the single search hero beneath.
 *
 * A compact utility header rather than a tall editorial banner (`py-6 sm:py-8`
 * against the hero's `py-8 md:py-10`), so the whole feed is on screen at 1080p.
 * The band is full-bleed; its content sits on the same `max-w-5xl` container as
 * the feed below it, so the two columns line up.
 */
function KnowledgeHeader({
  query,
  onQueryChange,
  inputRef,
  actions,
  onNavigate,
  countLabel,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  actions?: ReactNode;
  onNavigate?: (view: PortalView) => void;
  countLabel: string;
}) {
  return (
    <header className="border-b border-[rgba(175,190,35,0.30)] bg-[#20241E] text-white print:hidden">
      <div className={cx(CONTAINER, "py-6 sm:py-8")}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <BrandLockup tone="light" />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <nav aria-label="Portal sections" className="flex min-w-0 items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const isCurrent = item.view === "knowledge";
                return (
                  <button
                    key={item.view}
                    type="button"
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => onNavigate?.(item.view)}
                    className={cx(
                      "flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#AFBE23]/50",
                      isCurrent
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
            {actions}
          </div>
        </div>

        <div className="mt-5 sm:mt-6">
          <SopSearchHero
            inputRef={inputRef}
            value={query}
            onChange={onQueryChange}
            label="Search all published standard operating procedures"
            placeholder="Search all published SOPs"
          />
        </div>

        <p className="mt-2.5 text-[11.5px] font-medium tabular-nums text-white/55">{countLabel}</p>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------- filter bar */

/**
 * Audience switcher plus department chips, on the Clinical Light canvas directly
 * below the band — one unified row on a workstation, two tiers when the
 * viewport is too narrow for both. The chip track scrolls horizontally rather
 * than widening the page, and the reset affordance appears only once the
 * filters have actually moved off this viewer's starting view.
 */
function FilterBar({
  audience,
  onAudienceChange,
  department,
  onDepartmentChange,
  chipOptions,
  chipCounts,
  touched,
  onReset,
}: {
  audience: ArticleAudience;
  onAudienceChange: (value: ArticleAudience) => void;
  department: Department;
  onDepartmentChange: (department: Department) => void;
  chipOptions: readonly Department[];
  chipCounts: ReturnType<typeof departmentCounts>;
  touched: boolean;
  onReset: () => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
        <AudienceSwitcher
          value={audience}
          onChange={onAudienceChange}
          className="min-w-0 md:w-[19rem] md:shrink-0"
        />
        <DepartmentChips
          options={chipOptions}
          active={department}
          onChange={onDepartmentChange}
          counts={chipCounts}
          className="min-w-0 md:flex-1"
        />
        {touched ? (
          <button type="button" onClick={onReset} className={RESET_BUTTON_CLASS}>
            Reset filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- groups */

/**
 * One labelled group of rows — the Essential SOPs group at the top of the
 * browse view, and "Recently Published" / the result list beneath it.
 *
 * The shape is the bulletin board's pinned group, in the feed's own scale: one
 * white card with a hairline edge, a quiet uppercase tracked-out caption, and
 * rows divided by the same 1px rule. The caption is the only thing that says
 * which group a row is in — a row never repeats it as a pill.
 */
function FeedGroup({
  label,
  items,
  selectedId,
  onSelect,
  now,
  variant,
}: {
  label: string;
  items: readonly KnowledgeArticle[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  now: number;
  variant?: "standard" | "essential";
}) {
  return (
    <section aria-label={label}>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </h2>
      <ul role="list" className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {items.map((article) => {
          const isSelected = article.id === selectedId;
          return (
            <li key={article.id} className="border-b border-zinc-200 last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(article.id)}
                aria-current={isSelected ? "true" : undefined}
                className={cx(
                  "group block w-full min-w-0 px-4 py-3.5 text-left transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5F6E00]/45",
                  isSelected ? "bg-[#AFBE23]/12" : "hover:bg-zinc-50",
                )}
              >
                <SopFeedList
                  article={article}
                  isSelected={isSelected}
                  now={now}
                  variant={variant === "essential" ? "essential" : "standard"}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
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
 * A Clinical Light empty state with an optional escape action, in the bulletin
 * board's empty-state tokens (muted icon plate, quiet title and body) plus the
 * reset affordance the surface offers when nothing matched.
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
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-zinc-300/60 bg-white text-zinc-400 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <p className="mt-1 text-[13.5px] font-semibold text-zinc-800">{title}</p>
      <p className="text-[12.5px] leading-5 text-zinc-500">{message}</p>
      {action ? (
        <button type="button" onClick={action.onClick} className={cx("mt-1", RESET_BUTTON_CLASS)}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export default KnowledgeHome;
