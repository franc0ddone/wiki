"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  CalendarDays,
  History,
  Megaphone,
  PenLine,
  Pencil,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { DoveLewisIcon } from "@/components/brand/DoveLewisIcon";
import { BulletinDetail } from "@/components/bulletin/BulletinDetail";
import { BulletinRowBadges } from "@/components/bulletin/BulletinRowBadges";
import { FeedLoader } from "@/components/bulletin/FeedLoader";
import { BulletinReaderEmptyState } from "@/components/bulletin/BulletinReaderEmptyState";
import { StaffDirectory } from "@/components/directory/StaffDirectory";
import { KnowledgeHome } from "@/components/knowledge/KnowledgeHome";
import { MarkdownReader } from "@/components/MarkdownReader";
import { MasterDetailShell } from "@/components/MasterDetailShell";
import { PortalHeader } from "@/components/PortalHeader";
import { ReferencedBy } from "@/components/ReferencedBy";
import { ChangesBanner } from "@/components/reader/ChangesBanner";
import { FreshnessBadge } from "@/components/reader/FreshnessBadge";
import { ReaderTopBar } from "@/components/reader/ReaderTopBar";
import { readerFontPx } from "@/lib/reader/font-scale";
import type { ArticlePreview } from "@/lib/reader/preview";
import type { ArticleReadState } from "@/lib/data/article-reads";
import { useReaderFontSize } from "@/components/reader/readerSettings";
import { VersionDiffDialog } from "@/components/reader/VersionDiffDialog";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { AuthorAccessMenu } from "@/components/auth/AuthorAccessMenu";
import { ArticleAttachments } from "@/components/editor/ArticleAttachments";
import { deleteBulletin, listBulletins, patchBulletin } from "@/lib/bulletin/api";
import { matchesDepartment } from "@/lib/data/filters";
import { searchFeedArticles } from "@/lib/knowledge/feed";
import { useDebouncedValue, useSettledSearchLog } from "@/lib/hooks";
import { roleAtLeast, type Role } from "@/lib/roles";
import type { RoleRequestSummary } from "@/lib/role-requests";
import { buildSearchIndex, searchSurface } from "@/lib/search";
import type { SearchHit, SearchSurface } from "@/lib/search";
import { FACILITY_TIME_ZONE, cx, formatDate } from "@/lib/utils";
import {
  CLINICAL_DEPARTMENTS,
  DEPARTMENT_LABELS,
  type Bulletin,
  type ClinicalDepartment,
  type Department,
  type DepartmentCounts,
  type KnowledgeArticle,
  type PortalView,
  type StaffMember,
  type StaffType,
} from "@/types/portal";

/** Code-split so Tiptap loads only when the composer is opened, never on read. */
const BulletinComposer = dynamic(() => import("@/components/bulletin/BulletinComposer"), { ssr: false });

/**
 * Interactive shell for the portal.
 *
 * The three data sets are fetched on the server (`app/portal/page.tsx` via
 * `lib/data/*`) and handed in as props; everything interactive — view
 * switching, search, department filtering, list/detail selection, the
 * personnel drawer — lives here so the page itself can stay a server
 * component.
 *
 * Search is client-side over those same props (`lib/search`): one Fuse index
 * per surface, built once per dataset. The per-view fields and the global
 * command palette (`Ctrl/Cmd+K`) share it, so they agree on typo tolerance
 * and clinical synonyms. Department filtering (`matchesDepartment`) is
 * unchanged.
 *
 * The knowledge view is the **Knowledge Home** surface (prompt 7c), a
 * component of its own: `KnowledgeHome` owns the full-width clinical surface —
 * its dark header band (surface title, search hero, counter), the feed, the
 * audience switcher, the Essential SOPs group, and both of its modes. This shell
 * supplies the datasets, the index, the selection, and the reader pane.
 */

export interface BulletinBoardProps {
  /** Every pinned notice (the section is never paginated). */
  pinned: readonly Bulletin[];
  /** The loaded pages of the unpinned feed, newest first. */
  items: readonly Bulletin[];
  /** Cursor for the next page; `null` when the feed is exhausted. */
  nextCursor: string | null;
}

export interface OperationsHubClientProps {
  articles: readonly KnowledgeArticle[];
  /** The board: the complete pinned section plus the first page of the feed. */
  board: BulletinBoardProps;
  staff: readonly StaffMember[];
  /** The signed-in user's role; `null` when there is no session. Gates edit affordances only (the API enforces it regardless). */
  viewerRole?: Role | null;
  /** The signed-in user's id, for "have I acknowledged this?" and own-notice affordances. */
  viewerId?: string | null;
  /**
   * The viewer's staff type (prompt 7c), read server-side from their account.
   * It only picks the Knowledge Home feed's default audience — never a
   * permission — so `null` (unassigned) is a perfectly good value.
   */
  viewerStaffType?: StaffType | null;
  /** Signed-in identity, for the account menu. */
  viewer?: { name: string; email: string } | null;
  /** Ids of bulletins this viewer authored (so edit/delete show only where they may act). */
  authoredBulletinIds?: readonly string[];
  /** Open this procedure on load (`/procedures/<slug>` redirects here). */
  initialArticleSlug?: string | null;
  /**
   * The notice to open on load, from `?bulletin=<id>`. Absent means "nothing
   * selected" — the reader pane shows the empty-bowl empty state rather than
   * defaulting to the newest notice, so the board opens calm and link-shareable.
   */
  initialBulletinId?: string | null;
  /** The viewer's own latest author-access request (present for `staff` only). */
  authorRequest?: RoleRequestSummary | null;
  /** The open author-access queue (present for `clinical_lead`+ only). */
  roleRequests?: readonly RoleRequestSummary[];
}

/* ------------------------------------------------------------------ helpers */

/** Counts per department for the chip track. `All` is the unfiltered total. */
function buildCounts<T extends { departments: ClinicalDepartment[] }>(
  items: readonly T[],
): DepartmentCounts {
  const counts: DepartmentCounts = { All: items.length };
  for (const department of CLINICAL_DEPARTMENTS) {
    counts[department] = items.filter((item) => item.departments.includes(department)).length;
  }
  return counts;
}

/** Compact list-row timestamp, pinned to the facility zone for SSR determinism. */
const ROW_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: FACILITY_TIME_ZONE,
});
const ROW_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: FACILITY_TIME_ZONE,
});

function rowTimestamp(iso: string): { date: string; time: string } {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { date: iso, time: "" };
  return { date: ROW_DATE.format(parsed), time: ROW_TIME.format(parsed) };
}

/**
 * A "now" that ticks once a minute, so a notice ages out of the board live.
 * Seeded lazily on mount; the interval callback (async, not the effect body)
 * does the updates, which keeps the render pure.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** First prose paragraph of a markdown body, stripped of inline markers. */
function excerpt(markdown: string, max = 150): string {
  const paragraph =
    markdown
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .find(
        (chunk) =>
          chunk.length > 0 && !/^(#|>|\||```|[-*]\s|\d+[.)]\s)/.test(chunk) && !/^\*\*\w+:\*\*/.test(chunk),
      ) ?? "";
  const plain = paragraph
    .replace(/\*\*|`|\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}...` : plain;
}

/** Display name without the role suffix, e.g. `"Dr. Maya Okonkwo"`. */
function authorName(author: string): string {
  return author.split(",")[0]?.trim() ?? author;
}

/* ------------------------------------------------------------------- badges */

function StatusBadge({ status }: { status: KnowledgeArticle["status"] }) {
  if (status === "published") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-px text-xs font-semibold text-zinc-600">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#5F6E00]" />
        Published
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-px text-xs font-semibold text-amber-800">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Draft
    </span>
  );
}

/**
 * Department badges carry the outline-pill language everywhere — list cards,
 * detail headers, and the drawer all render this exact treatment. Urgency and
 * status are the only filled-tint badges.
 */
function DepartmentTags({ departments }: { departments: readonly ClinicalDepartment[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {departments.map((department) => (
        <span
          key={department}
          className="whitespace-nowrap rounded-full border border-[#5F6E00]/30 bg-[#AFBE23]/15 px-2 py-px text-xs font-medium text-[#5F6E00]"
        >
          {DEPARTMENT_LABELS[department]}
        </span>
      ))}
    </span>
  );
}

function MetaItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-2 text-[13px] text-zinc-500">
      <span className="text-zinc-400">{icon}</span>
      <span className="sr-only">{label}</span>
      <span className="text-zinc-500">{children}</span>
    </span>
  );
}

/**
 * The board's empty state.
 *
 * `accent` is the one brand mark on this surface, and it is opt-in: the three
 * states the brief names as "the bulletin empty states" (an empty board, a
 * filtered-to-zero rail, a search with no hits) all render through the list
 * empty state, while the reader pane's "No notice selected" placeholder is a
 * different thing — a rail and its canvas are on screen at the same time, and
 * two bowls at once would read as noise rather than a whisper. The plate and
 * the copy are untouched either way.
 */
function EmptyState({
  icon,
  title,
  message,
  accent = false,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  accent?: boolean;
}) {
  return (
    <div className="flex max-w-xs flex-col items-center gap-2 text-center">
      {accent ? (
        <DoveLewisIcon className="mx-auto mb-3 opacity-55" color="dark-green" name="empty-bowl" roughness={true} size={44} />
      ) : null}
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-zinc-300/60 bg-white text-zinc-400 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {icon}
      </span>
      <p className="mt-1 text-[13.5px] font-semibold text-zinc-800">{title}</p>
      <p className="text-[12.5px] leading-5 text-zinc-500">{message}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- list rows */

function RowTimestamp({ iso, withTime }: { iso: string; withTime: boolean }) {
  const stamp = rowTimestamp(iso);
  return (
    <time dateTime={iso} className="shrink-0 text-xs font-medium tabular-nums text-zinc-500">
      {stamp.date}
      {withTime && stamp.time ? <span className="text-zinc-400"> {stamp.time}</span> : null}
    </time>
  );
}

/**
 * A board row — the same component for both groups: the pinned section at the
 * top of the rail and the ordinary feed beneath it. Author · date, title,
 * excerpt, and one badge line; the only difference is that badge line, which for
 * a pinned row states the date it comes down instead of the relative chip.
 *
 * Department pills are gone from both variants (see `BulletinRowBadges`): the
 * rail indexes departments for its filter chips and does not repeat them on
 * every card.
 */
function BulletinRow({
  bulletin,
  isSelected,
  now,
  variant = "standard",
}: {
  bulletin: Bulletin;
  isSelected: boolean;
  now: number;
  variant?: "pinned" | "standard";
}) {
  return (
    <span className="block">
      <span className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-medium text-zinc-500">
          {authorName(bulletin.author_name)}
        </span>
        <RowTimestamp iso={bulletin.created_at} withTime />
      </span>
      <span
        className={cx(
          "mt-1 block text-[13.5px] font-semibold leading-snug tracking-[-0.005em]",
          isSelected ? "text-zinc-900" : "text-zinc-800",
        )}
      >
        {bulletin.title}
      </span>
      <span className="mt-1 line-clamp-2 block text-[12.5px] leading-[1.45] text-zinc-500">
        {excerpt(bulletin.body_markdown)}
      </span>
      <BulletinRowBadges bulletin={bulletin} now={now} variant={variant} />
    </span>
  );
}

/* ------------------------------------------------------------- detail panes */

function DetailFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[72rem] px-4 py-6 sm:px-6 md:px-8 md:py-10">{children}</div>;
}

function ArticleDetail({
  article,
  canEdit,
  onOpenHistory,
  onOpenArticleBySlug,
  onOpenBulletin,
  onOpenSearch,
  previewFor,
}: {
  article: KnowledgeArticle;
  canEdit: boolean;
  onOpenHistory: () => void;
  onOpenArticleBySlug: (slug: string, anchor?: string) => void;
  onOpenBulletin: (id: string) => void;
  onOpenSearch: () => void;
  previewFor: (slug: string) => ArticlePreview | null;
}) {
  const now = useNow();
  const { size: fontSize, toggle: toggleFontSize } = useReaderFontSize();
  const [readState, setReadState] = useState<ArticleReadState | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);

  // Read state (item 1): what this user last saw vs. the current version. The
  // marker is written a few seconds in, so a quick glance that is reloaded does
  // not count as "read". Fire-and-forget — a failure just means no highlight.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const response = await fetch(`/api/articles/${encodeURIComponent(article.slug)}/read`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const state = (await response.json()) as ArticleReadState;
        setReadState(state);
        if (state.latest_version !== null) {
          const version = state.latest_version;
          timer = setTimeout(() => {
            void fetch(`/api/articles/${encodeURIComponent(article.slug)}/read`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ version }),
            }).catch(() => {});
          }, 3000);
        }
      } catch {
        // Offline / unauthenticated: no highlight, and no marker to write.
      }
    })();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [article.slug]);

  const latestVersion = readState?.latest_version ?? null;
  const changedFrom =
    readState !== null &&
    readState.last_seen_version !== null &&
    latestVersion !== null &&
    latestVersion > readState.last_seen_version
      ? readState.last_seen_version
      : null;

  const breadcrumbs = [
    "Knowledge base",
    article.departments[0] ? DEPARTMENT_LABELS[article.departments[0]] : "Procedure",
    article.title,
  ];

  return (
    <>
      <ReaderTopBar
        breadcrumbs={breadcrumbs}
        onSearch={onOpenSearch}
        markdown={article.body_markdown}
        fontSize={fontSize}
        onToggleFontSize={toggleFontSize}
      />
      <DetailFrame>
      <MarkdownReader
        source={article.body_markdown}
        onOpenArticle={onOpenArticleBySlug}
        previewArticle={previewFor}
        fontSizePx={readerFontPx(fontSize)}
        header={
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={article.status} />
                <FreshnessBadge lastReviewedAt={article.last_reviewed_at} now={now} />
                <DepartmentTags departments={article.departments} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5 print:hidden">
                <button
                  type="button"
                  onClick={onOpenHistory}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300/60 bg-white px-2.5 text-[13px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35"
                >
                  <History size={14} strokeWidth={1.75} aria-hidden="true" />
                  History
                </button>
                {canEdit ? (
                  <Link
                    href={`/articles/${encodeURIComponent(article.slug)}/edit`}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-[#5F6E00] px-3 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors hover:bg-[#4D5900] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/40 focus-visible:ring-offset-1"
                  >
                    <Pencil size={13} strokeWidth={2} aria-hidden="true" />
                    Edit
                  </Link>
                ) : null}
              </div>
            </div>
            <h1 className="mt-4 text-[1.85rem] font-semibold leading-[1.15] tracking-tight text-zinc-900 md:text-[2.2rem]">
              {article.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <MetaItem icon={<PenLine size={14} strokeWidth={1.75} aria-hidden="true" />} label="Author">
                {article.author_name}
              </MetaItem>
              <MetaItem
                icon={<CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />}
                label="Updated"
              >
                Updated {formatDate(article.updated_at)}
              </MetaItem>
            </div>
            {changedFrom !== null && latestVersion !== null ? (
              <div className="mt-5">
                <ChangesBanner
                  from={changedFrom}
                  to={latestVersion}
                  onViewChanges={() => setDiffOpen(true)}
                />
              </div>
            ) : null}
          </>
        }
        footer={
          <div className="space-y-6">
            {article.status !== "published" ? (
              <aside
                role="note"
                className="flex gap-3 rounded-[10px] border border-amber-200 bg-amber-50/80 px-4 py-3.5 text-[13.5px] leading-relaxed text-amber-900"
              >
                <TriangleAlert
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="mt-[3px] shrink-0 text-amber-700"
                />
                {article.status === "draft"
                  ? "This procedure is a draft and is not in force. Do not follow it for patient care until it is published."
                  : null}
              </aside>
            ) : null}
            <div className="border-t border-zinc-200 pt-6">
              <ReferencedBy
                key={article.slug}
                slug={article.slug}
                onOpenArticleBySlug={onOpenArticleBySlug}
                onOpenBulletin={onOpenBulletin}
              />
            </div>
            <ArticleAttachments slug={article.slug} />
            <p className="font-mono text-xs text-zinc-400">{article.slug}</p>
          </div>
        }
      />
      </DetailFrame>

      {diffOpen && changedFrom !== null && latestVersion !== null ? (
        <VersionDiffDialog
          slug={article.slug}
          articleTitle={article.title}
          fromVersion={changedFrom}
          toVersion={latestVersion}
          onClose={() => setDiffOpen(false)}
        />
      ) : null}
    </>
  );
}

/* --------------------------------------------------------------------- page */

/** Items in relevance order when a search is active; the dataset's own order otherwise. */
function rankBy<T extends { id: string }>(items: readonly T[], order: readonly string[] | null): readonly T[] {
  if (order === null) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  return order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

const SEARCH_DEBOUNCE_MS = 150;

/**
 * The board's single brand accent: one dashed rule, drawn between the pinned
 * section and the feed.
 *
 * It is a *boundary* mark, not a rule for the whole rail, so it is only ever
 * handed to the shell — the shell renders it solely when there is a pinned
 * group with at least one row *and* a feed beneath it (see
 * `MasterDetailShell`'s `leadingGroupDivider`). `border-dashed` is the single
 * dashed row that used to ride inside `borders-set`, on its own in a 400×24
 * box; held at a fixed 240px rather than the element's full bleed, so it reads
 * as a whisper rather than a banner.
 *
 * Three things make it what it is:
 *
 *  - **Hand-drawn.** `roughness` is on, so the shared freehand displacement
 *    filter of `DoveLewisIcon` applies on top of the row's already irregular
 *    dash lengths, gaps and baselines: organic, never a CSS `border-dashed`.
 *  - **Centred in its whitespace.** The wrapper owns the whole gap between the
 *    two groups as symmetric padding (`py-12`), and the shell drops the leading
 *    group's own `mb-24` while this divider is present — so the rule sits in the
 *    middle of the whitespace rather than anchored against either group's edge.
 *  - **Full strength.** No opacity utility, and the icon carries none of its
 *    own either: `dark-green` at 100%, crisp and legible beside the rows.
 *
 * It carries no `title`, so the icon marks itself `aria-hidden`/
 * `role="presentation"`, and the wrapper is `aria-hidden` besides.
 */
const PINNED_FEED_DIVIDER = (
  <div className="flex select-none justify-center py-12 pointer-events-none" aria-hidden="true">
    <DoveLewisIcon className="h-auto" color="dark-green" name="border-dashed" roughness={true} width={240} />
  </div>
);

export function OperationsHubClient({
  articles,
  board,
  staff,
  viewerRole = null,
  viewerId = null,
  viewerStaffType = null,
  viewer = null,
  authoredBulletinIds = [],
  initialArticleSlug = null,
  initialBulletinId = null,
  authorRequest = null,
  roleRequests = [],
}: OperationsHubClientProps) {
  const now = useNow();
  const [activeView, setActiveView] = useState<PortalView>(() =>
    initialArticleSlug && articles.some((article) => article.slug === initialArticleSlug)
      ? "knowledge"
      : "bulletins",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeDepartment, setActiveDepartment] = useState<Department>("All");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(
    () => articles.find((article) => article.slug === initialArticleSlug)?.id ?? null,
  );
  /**
   * The reading-pane selection, seeded from the URL (`?bulletin=<id>`) and kept
   * in step with it by `selectBulletin` below. Landing with no param selects
   * nothing — the pane shows the empty-bowl empty state.
   */
  const [selectedBulletinId, setSelectedBulletinId] = useState<string | null>(initialBulletinId);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * The query the header's unfolded search field handed over, if any. Cleared
   * whenever the palette closes, so reopening it always starts empty unless a
   * fresh hand-off seeded it.
   */
  const [paletteQuery, setPaletteQuery] = useState("");

  /** The header's search field and ⌘K both land here: open universal search. */
  const openUniversalSearch = useCallback((query?: string) => {
    setPaletteQuery(query ?? "");
    setPaletteOpen(true);
  }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [personRequest, setPersonRequest] = useState<{ memberId: string; nonce: number } | null>(null);
  const pendingAnchor = useRef<string | null>(null);

  /**
   * The board is server-rendered into `board` — the complete pinned section plus
   * the first page of the feed — then owned locally. The pinned section is kept
   * whole (few and self-expiring); the feed grows a page at a time via
   * `next_cursor`, and every write re-fetches whatever the current mode needs so
   * the rail reflects the database rather than an optimistic guess.
   */
  const [pinnedList, setPinnedList] = useState<readonly Bulletin[]>(board.pinned);
  const [feedList, setFeedList] = useState<readonly Bulletin[]>(board.items);
  const [feedCursor, setFeedCursor] = useState<string | null>(board.nextCursor);
  const [feedLoading, setFeedLoading] = useState(false);
  const [composer, setComposer] = useState<{ mode: "create" } | { mode: "edit"; bulletin: Bulletin } | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  /**
   * Bumped whenever a bulletin is written through the composer. The reader pane
   * is keyed by bulletin *id*, which does not change when the same notice is
   * saved — so without this, a file the poster removed would linger in the
   * reader's download list until a manual reload.
   */
  const [bulletinRevision, setBulletinRevision] = useState(0);
  // Server-supplied authored ids, plus anything posted this session (the props
  // are read at page load, so a notice posted now would not be in them yet).
  const [authoredIds, setAuthoredIds] = useState<readonly string[]>(authoredBulletinIds);

  /**
   * A settled search or a department other than "All" turns paging off and pulls
   * the whole (small) matched set, so client-side Fuse search runs over every
   * match rather than just the loaded page. Any query text counts as filtered —
   * the refetch fires on the transition, not on every keystroke.
   */
  const isFiltered = searchQuery.trim().length > 0 || activeDepartment !== "All";

  /**
   * Selection is mirrored into the URL (`?bulletin=<id>`) so a reading-pane
   * state is shareable and survives a refresh. `history.replaceState` is
   * deliberate: the portal is `force-dynamic`, so a `router.replace` would make
   * every notice click re-run the page's three database reads. This updates the
   * address bar — and therefore what a reload restores — with no navigation and
   * no refetch. Other query params are preserved.
   */
  const selectBulletin = useCallback((id: string | null) => {
    setSelectedBulletinId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("bulletin", id);
    else url.searchParams.delete("bulletin");
    window.history.replaceState(null, "", url.toString());
  }, []);

  /**
   * Re-fetch the board to match the current mode: the whole feed while a filter
   * is active, otherwise the first page. Used after every write.
   */
  const refreshBoard = useCallback(
    async (preferId?: string) => {
      try {
        const page = isFiltered ? await listBulletins({ limit: "all" }) : await listBulletins();
        setPinnedList(page.pinned);
        setFeedList(page.items);
        setFeedCursor(page.next_cursor);
        if (preferId) selectBulletin(preferId);
      } catch {
        // Keep the current list; the mutation itself already reported any error.
      }
    },
    [isFiltered, selectBulletin],
  );

  /**
   * Load the next page of the feed and append it. Guarded so a scroll burst or a
   * filter change cannot fire two overlapping requests. Appending adds below
   * what is already on screen, so nothing jumps.
   */
  const loadMoreFeed = useCallback(async () => {
    if (isFiltered || feedLoading || !feedCursor) return;
    setFeedLoading(true);
    try {
      const page = await listBulletins({ cursor: feedCursor });
      setFeedList((current) => [...current, ...page.items]);
      setFeedCursor(page.next_cursor);
    } catch {
      // Leave the cursor in place so the next scroll (or the button) retries.
    } finally {
      setFeedLoading(false);
    }
  }, [isFiltered, feedLoading, feedCursor]);

  /**
   * When the filter mode flips, refetch to match it — page one for browsing, the
   * whole set while a search or department filter is active. The first render is
   * skipped: the server already delivered page one.
   */
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    void refreshBoard();
  }, [isFiltered, refreshBoard]);

  const handlePosted = useCallback(
    async (created: Bulletin) => {
      setComposer(null);
      setAuthoredIds((current) => (current.includes(created.id) ? current : [...current, created.id]));
      selectBulletin(created.id);
      setBulletinRevision((current) => current + 1);
      await refreshBoard(created.id);
    },
    [refreshBoard, selectBulletin],
  );

  const handleSaved = useCallback(
    async (saved: Bulletin) => {
      setComposer(null);
      selectBulletin(saved.id);
      setBulletinRevision((current) => current + 1);
      await refreshBoard(saved.id);
    },
    [refreshBoard, selectBulletin],
  );

  /**
   * The reader menu's pin write — unpin, or change the expiry. It goes through
   * the same PATCH the composer uses, so authorship and validation stay the API's
   * (`requireEditableBulletin`), and the board is refetched afterwards so the
   * rail marker and the detail label both show the new state. A refusal is
   * re-thrown: the menu prints the API's own message.
   */
  const handlePinChange = useCallback(
    async (id: string, patch: { pinned?: boolean; expires_at?: string | null }) => {
      await patchBulletin(id, patch);
      setBulletinRevision((current) => current + 1);
      await refreshBoard(id);
    },
    [refreshBoard],
  );

  const handleDeleted = useCallback(
    async (bulletin: Bulletin) => {
      setBoardError(null);
      try {
        await deleteBulletin(bulletin.id);
      } catch (caught) {
        setBoardError(caught instanceof Error ? caught.message : "Could not delete the notice.");
        return;
      }
      setPinnedList((current) => current.filter((entry) => entry.id !== bulletin.id));
      setFeedList((current) => current.filter((entry) => entry.id !== bulletin.id));
      selectBulletin(null);
      await refreshBoard();
    },
    [refreshBoard, selectBulletin],
  );

  const isAuthor = viewerRole !== null && roleAtLeast(viewerRole, "author");
  /**
   * An author may edit any procedure, including a published one: a plain save of
   * a live procedure republishes it (the API snapshots a new immutable version),
   * and `updateArticle` already permits that at `author`+. Publishing a *draft*
   * still needs `clinical_lead`+, which the editor and the API both enforce.
   * There is no per-article condition left, so the edit affordance simply tracks
   * the role.
   */

  const handleViewChange = (view: PortalView) => {
    setActiveView(view);
    setSearchQuery("");
    setActiveDepartment("All");
  };

  const openArticle = (articleId: string) => {
    handleViewChange("knowledge");
    setSelectedArticleId(articleId);
  };

  const openBulletin = (bulletinId: string) => {
    handleViewChange("bulletins");
    selectBulletin(bulletinId);
  };

  const openPerson = (memberId: string) => {
    handleViewChange("directory");
    setPersonRequest({ memberId, nonce: Date.now() });
  };

  /** Follow an in-article `/procedures/<slug>#anchor` link without leaving the portal. */
  const openArticleBySlug = useCallback(
    (slug: string, anchor?: string): boolean => {
      const target = articles.find((article) => article.slug === slug);
      if (!target) return false; // unknown slug: let the browser handle the link
      pendingAnchor.current = anchor ?? null;
      setActiveView("knowledge");
      setSearchQuery("");
      setActiveDepartment("All");
      setSelectedArticleId(target.id);
      return true;
    },
    [articles],
  );

  // After an in-app link switches articles, bring the linked section into view.
  // Runs after the shell's own "new selection starts at the top" effect.
  useEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor) return;
    pendingAnchor.current = null;
    let node: HTMLElement | null = document.getElementById(anchor);
    node?.scrollIntoView({ block: "start" });
    while (node) {
      const details: HTMLElement | null = node.closest("details");
      if (!details) break;
      (details as HTMLDetailsElement).open = true;
      node = details.parentElement;
    }
  }, [selectedArticleId, activeView]);

  const handleOpenResult = (hit: SearchHit) => {
    if (hit.surface === "articles") openArticle(hit.id);
    else if (hit.surface === "bulletins") openBulletin(hit.id);
    else openPerson(hit.id);
  };

  /* Search: one index per dataset, shared by the palette and the per-view fields. */
  const knownBulletins = useMemo(() => [...pinnedList, ...feedList], [pinnedList, feedList]);
  const searchIndex = useMemo(
    () => buildSearchIndex(articles, knownBulletins, staff),
    [articles, knownBulletins, staff],
  );

  // Internal SOP link hover previews (prompt 7a, item 4): a lookup over the
  // articles the portal already holds — no new endpoint, no fetch on hover.
  const previewFor = useMemo(() => {
    const bySlug = new Map(articles.map((article) => [article.slug, article]));
    return (slug: string): ArticlePreview | null => {
      const found = bySlug.get(slug);
      if (!found) return null;
      return {
        title: found.title,
        excerpt: excerpt(found.body_markdown, 140),
        status: found.status,
        departments: found.departments,
      };
    };
  }, [articles]);
  const debouncedQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  // Clearing the field must restore the full list immediately, not 150 ms later.
  const effectiveQuery = searchQuery.trim().length === 0 ? "" : debouncedQuery;

  /* Bulletin board */
  const searchedBulletins = useMemo(
    () => rankBy(knownBulletins, searchSurface(searchIndex, "bulletins", effectiveQuery)),
    [knownBulletins, searchIndex, effectiveQuery],
  );
  const filteredBulletins = useMemo(
    () =>
      searchedBulletins.filter((bulletin) =>
        matchesDepartment(bulletin.departments, activeDepartment),
      ),
    [searchedBulletins, activeDepartment],
  );
  // Counts reflect what the rail has loaded (and, while a filter is active, the
  // whole matched set — the filter bypass fetches it all).
  const bulletinCounts = useMemo(() => buildCounts(searchedBulletins), [searchedBulletins]);
  /**
   * The rail is two groups, not one list with a marker on some rows: pinned
   * notices render in their own section at the top (the shell's `leadingGroup`),
   * everything else below it in recency order. The pinned group is always the
   * whole pinned set; the feed is whatever pages have been loaded. Both come out
   * of the same filtered board, so a search or a department filter drops out of
   * both.
   */
  const pinnedBulletins = useMemo(
    () => filteredBulletins.filter((bulletin) => bulletin.pinned),
    [filteredBulletins],
  );
  const feedBulletins = useMemo(
    () => filteredBulletins.filter((bulletin) => !bulletin.pinned),
    [filteredBulletins],
  );
  const selectedBulletin = useMemo(
    () => filteredBulletins.find((bulletin) => bulletin.id === selectedBulletinId) ?? null,
    [filteredBulletins, selectedBulletinId],
  );
  /** Another page exists only while browsing — a filter has already loaded them all. */
  const feedHasMore = !isFiltered && feedCursor !== null;
  /**
   * Whether the *board* holds any notice at all (the loaded pinned section plus
   * the feed). The empty bowl is the "nothing selected" state, not the "nothing
   * posted" state: with no notices at all the board's own empty state — the same
   * bowl above a plate and copy — stands in instead.
   */
  const boardHasBulletins = pinnedList.length > 0 || feedList.length > 0;

  /* Knowledge Home (prompt 7c) */
  /**
   * The Knowledge Home surface builds its own feed from the whole `articles`
   * prop — it owns the audience switcher, the corpus-derived department chips,
   * the Essential section, and both modes — so the shell no longer pre-filters
   * articles. What the shell still needs from the shared index is the count the
   * dead-search log records, and the result count the surface actually shows:
   * published procedures only, exactly as the feed does.
   */
  const knowledgeResultCount = useMemo(
    () => (effectiveQuery.trim().length > 0 ? searchFeedArticles(articles, searchIndex, effectiveQuery).length : 0),
    [articles, searchIndex, effectiveQuery],
  );
  const selectedArticle = useMemo(
    () => articles.find((article) => article.id === selectedArticleId) ?? null,
    [articles, selectedArticleId],
  );

  /* Staff directory */
  /**
   * The directory surface filters the roster itself (`lib/directory/roster.ts`)
   * — it owns its own query field, department dropdown and search semantics, the
   * same way the Knowledge Home does. The shell keeps only the ranked list the
   * dead-search telemetry counts, so `searchSurface(…, "staff", …)` and the
   * directory never disagree about how many people a query reaches.
   */
  const searchedStaff = useMemo(
    () => rankBy(staff, searchSurface(searchIndex, "staff", effectiveQuery)),
    [staff, searchIndex, effectiveQuery],
  );

  // Dead-search telemetry: one fire-and-forget log per settled query (>= 3 chars).
  const activeSurface: SearchSurface =
    activeView === "bulletins" ? "bulletins" : activeView === "knowledge" ? "articles" : "staff";
  const activeResultCount =
    activeView === "bulletins"
      ? searchedBulletins.length
      : activeView === "knowledge"
        ? knowledgeResultCount
        : searchedStaff.length;
  useSettledSearchLog(effectiveQuery, activeResultCount, activeSurface);

  const noMatchTitle = isFiltered ? "No matches" : "Nothing here yet";
  const noMatchMessage = isFiltered
    ? "Nothing matches the current search and department filter. Try fewer words, or an abbreviation."
    : "Items appear here once they are published.";

  return (
    <div className="flex h-dvh flex-col bg-[#F4F4F5] text-zinc-900 print:block print:h-auto">
      <PortalHeader
        activeView={activeView}
        onViewChange={handleViewChange}
        onOpenSearch={openUniversalSearch}
        rightSlot={
          viewerRole ? (
            <AuthorAccessMenu
              viewerRole={viewerRole}
              viewer={viewer}
              authorRequest={authorRequest}
              roleRequests={roleRequests}
            />
          ) : null
        }
      />

      <main className="flex min-h-0 flex-1 flex-col print:block">
        {activeView === "bulletins" ? (
          <MasterDetailShell
            items={feedBulletins}
            leadingGroup={
              pinnedBulletins.length > 0
                ? {
                    label: "Pinned",
                    items: pinnedBulletins,
                    renderItem: (bulletin, isSelected) => (
                      <BulletinRow bulletin={bulletin} isSelected={isSelected} now={now} variant="pinned" />
                    ),
                  }
                : undefined
            }
            getId={(bulletin) => bulletin.id}
            selectedId={selectedBulletin?.id ?? null}
            onSelect={selectBulletin}
            leadingGroupDivider={PINNED_FEED_DIVIDER}
            listTitle="Bulletin Board"
            listActions={
              isAuthor ? (
                <button
                  type="button"
                  onClick={() => setComposer({ mode: "create" })}
                  className="flex h-7 items-center gap-1 rounded-md border border-zinc-300/60 bg-white px-2 text-xs font-medium text-zinc-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-[#5F6E00]/40 hover:text-[#5F6E00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35"
                >
                  <Plus size={13} strokeWidth={2} aria-hidden="true" />
                  New bulletin
                </button>
              ) : null
            }
            renderListItem={(bulletin, isSelected) => (
              <BulletinRow bulletin={bulletin} isSelected={isSelected} now={now} />
            )}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search notices"
            searchLabel="Search bulletins"
            activeDepartment={activeDepartment}
            onDepartmentChange={setActiveDepartment}
            counts={bulletinCounts}
            listFooter={
              feedHasMore || feedLoading ? (
                <FeedLoader hasMore={feedHasMore} loading={feedLoading} onLoadMore={loadMoreFeed} />
              ) : undefined
            }
            detail={
              selectedBulletin ? (
                <BulletinDetail
                  key={`${selectedBulletin.id}:${bulletinRevision}`}
                  bulletin={selectedBulletin}
                  articles={articles}
                  viewerRole={viewerRole ?? "readonly"}
                  viewerId={viewerId ?? ""}
                  now={now}
                  isAuthor={authoredIds.includes(selectedBulletin.id)}
                  onPinChange={(patch) => handlePinChange(selectedBulletin.id, patch)}
                  onOpenArticle={openArticle}
                  onOpenArticleBySlug={openArticleBySlug}
                  onEdit={() => setComposer({ mode: "edit", bulletin: selectedBulletin })}
                  onDelete={() => void handleDeleted(selectedBulletin)}
                />
              ) : null
            }
            detailLabel="Bulletin reader"
            emptyListState={
              <EmptyState
                accent
                icon={<Megaphone size={14} strokeWidth={1.75} aria-hidden="true" />}
                title={noMatchTitle}
                message={noMatchMessage}
              />
            }
            emptyDetailState={
              boardHasBulletins ? (
                <BulletinReaderEmptyState />
              ) : (
                <EmptyState
                  accent
                  icon={<Megaphone size={14} strokeWidth={1.75} aria-hidden="true" />}
                  title={noMatchTitle}
                  message={noMatchMessage}
                />
              )
            }
          />
        ) : null}

        {activeView === "knowledge" ? (
          /*
           * The Knowledge Home surface (prompt 7c) is a full-width clinical
           * surface — no master/detail shell, no rail, matching the 7a reader
           * and the bulletin board. It owns its dark header band (brand lockup,
           * the Bulletins/Procedures navigation, and the "New SOP" entry point
           * this shell gates), its single search hero, the filter bar, the
           * Essential SOPs group, and both of its modes. The shell hands it the
           * datasets, the shared Fuse index, the section switch, the selection,
           * and the reader pane; the reader itself (prompt 7a) is unchanged.
           */
          <KnowledgeHome
            articles={articles}
            index={searchIndex}
            staffType={viewerStaffType}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            listActions={
              isAuthor ? (
                <Link
                  href="/articles/new"
                  className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-[#AFBE23]/50 bg-[#AFBE23]/15 px-2.5 text-xs font-medium text-[#E6EBA5] transition-colors hover:bg-[#AFBE23]/25 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#AFBE23]/50"
                >
                  <Plus size={13} strokeWidth={2} aria-hidden="true" />
                  New SOP
                </Link>
              ) : null
            }
            selectedId={selectedArticle?.id ?? null}
            onSelect={setSelectedArticleId}
            now={now}
            detail={
              selectedArticle ? (
                <ArticleDetail
                  article={selectedArticle}
                  canEdit={isAuthor}
                  onOpenHistory={() => setHistoryOpen(true)}
                  onOpenArticleBySlug={openArticleBySlug}
                  onOpenBulletin={openBulletin}
                  onOpenSearch={() => setPaletteOpen(true)}
                  previewFor={previewFor}
                />
              ) : null
            }
          />
        ) : null}

        {activeView === "directory" ? (
          /*
           * The Staff Directory surface: a full-width clinical surface in the
           * Knowledge Home's architecture — its own dark hero band with the
           * brand lockup and section navigation, the one search field on the
           * page, the department dropdown, the self check-in toggle, and the
           * HERE TODAY / ALL STAFF sections with inline row expansion. It owns
           * its own filtering from the whole roster; the shell supplies the
           * roster, the shared query (so the palette agrees), and the section
           * switch.
           */
          <StaffDirectory
            staff={staff}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            openRequest={personRequest}
            viewer={viewer}
          />
        ) : null}
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={(next) => {
          setPaletteOpen(next);
          if (!next) setPaletteQuery("");
        }}
        index={searchIndex}
        initialQuery={paletteQuery}
        onOpenResult={handleOpenResult}
      />

      {historyOpen && selectedArticle ? (
        <VersionHistoryDialog
          slug={selectedArticle.slug}
          articleTitle={selectedArticle.title}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {boardError ? (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-[13px] text-red-800 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.3)]"
        >
          {boardError}
        </div>
      ) : null}

      {composer ? (
        <BulletinComposer
          mode={composer.mode}
          role={viewerRole ?? "readonly"}
          articles={articles}
          initial={composer.mode === "edit" ? composer.bulletin : null}
          onClose={() => setComposer(null)}
          onPosted={handlePosted}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

export default OperationsHubClient;
