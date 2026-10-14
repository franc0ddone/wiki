"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  History,
  Megaphone,
  PenLine,
  Pencil,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { BulletinDetail } from "@/components/bulletin/BulletinDetail";
import { BulletinRowBadges } from "@/components/bulletin/BulletinRowBadges";
import { FeedLoader } from "@/components/bulletin/FeedLoader";
import { DirectoryGrid } from "@/components/DirectoryGrid";
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
  /** Signed-in identity, for the account menu. */
  viewer?: { name: string; email: string } | null;
  /** Ids of bulletins this viewer authored (so edit/delete show only where they may act). */
  authoredBulletinIds?: readonly string[];
  /** Open this procedure on load (`/procedures/<slug>` redirects here). */
  initialArticleSlug?: string | null;
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
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#0F766E]" />
        Published
      </span>
    );
  }
  const isDraft = status === "draft";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-xs font-semibold",
        isDraft ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-800",
      )}
    >
      <span aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", isDraft ? "bg-amber-500" : "bg-sky-500")} />
      {isDraft ? "Draft" : "In review"}
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
          className="whitespace-nowrap rounded-full border border-teal-600/30 bg-teal-50/50 px-2 py-px text-xs font-medium text-teal-700"
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

function EmptyState({ icon, title, message }: { icon: ReactNode; title: string; message: string }) {
  return (
    <div className="flex max-w-xs flex-col items-center gap-2 text-center">
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

function ArticleRow({ article, isSelected }: { article: KnowledgeArticle; isSelected: boolean }) {
  return (
    <span className="block">
      <span className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-medium text-zinc-500">
          {authorName(article.author_name)}
        </span>
        <RowTimestamp iso={article.updated_at} withTime={false} />
      </span>
      <span
        className={cx(
          "mt-1 block text-[13.5px] font-semibold leading-snug tracking-[-0.005em]",
          isSelected ? "text-zinc-900" : "text-zinc-800",
        )}
      >
        {article.title}
      </span>
      <span className="mt-1 line-clamp-2 block text-[12.5px] leading-[1.45] text-zinc-500">
        {excerpt(article.body_markdown)}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1">
        {article.status !== "published" ? <StatusBadge status={article.status} /> : null}
        <DepartmentTags departments={article.departments} />
      </span>
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
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300/60 bg-white px-2.5 text-[13px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                >
                  <History size={14} strokeWidth={1.75} aria-hidden="true" />
                  History
                </button>
                {canEdit ? (
                  <Link
                    href={`/articles/${encodeURIComponent(article.slug)}/edit`}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-[#0F766E] px-3 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors hover:bg-[#0c635c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 focus-visible:ring-offset-1"
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
                  ? "This procedure is a draft and is not in force. Do not follow it for patient care until the clinical leads publish it."
                  : "This procedure is awaiting clinical review and is not in force. Do not follow it for patient care until a clinical lead publishes it."}
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

export function OperationsHubClient({
  articles,
  board,
  staff,
  viewerRole = null,
  viewerId = null,
  viewer = null,
  authoredBulletinIds = [],
  initialArticleSlug = null,
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
  const [selectedBulletinId, setSelectedBulletinId] = useState<string | null>(
    board.pinned[0]?.id ?? board.items[0]?.id ?? null,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
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
        if (preferId) setSelectedBulletinId(preferId);
      } catch {
        // Keep the current list; the mutation itself already reported any error.
      }
    },
    [isFiltered],
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
      setSelectedBulletinId(created.id);
      setBulletinRevision((current) => current + 1);
      await refreshBoard(created.id);
    },
    [refreshBoard],
  );

  const handleSaved = useCallback(
    async (saved: Bulletin) => {
      setComposer(null);
      setSelectedBulletinId(saved.id);
      setBulletinRevision((current) => current + 1);
      await refreshBoard(saved.id);
    },
    [refreshBoard],
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
      setSelectedBulletinId(null);
      await refreshBoard();
    },
    [refreshBoard],
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
    setSelectedBulletinId(bulletinId);
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

  /* Knowledge base */
  const searchedArticles = useMemo(
    () => rankBy(articles, searchSurface(searchIndex, "articles", effectiveQuery)),
    [articles, searchIndex, effectiveQuery],
  );
  const filteredArticles = useMemo(
    () => searchedArticles.filter((article) => matchesDepartment(article.departments, activeDepartment)),
    [searchedArticles, activeDepartment],
  );
  const articleCounts = useMemo(() => buildCounts(searchedArticles), [searchedArticles]);
  const selectedArticle = useMemo(
    () => filteredArticles.find((article) => article.id === selectedArticleId) ?? null,
    [filteredArticles, selectedArticleId],
  );

  /* Staff directory */
  const searchedStaff = useMemo(
    () => rankBy(staff, searchSurface(searchIndex, "staff", effectiveQuery)),
    [staff, searchIndex, effectiveQuery],
  );
  const filteredStaff = useMemo(
    () => searchedStaff.filter((member) => matchesDepartment(member.departments, activeDepartment)),
    [searchedStaff, activeDepartment],
  );
  const staffCounts = useMemo(() => buildCounts(searchedStaff), [searchedStaff]);

  // Dead-search telemetry: one fire-and-forget log per settled query (>= 3 chars).
  const activeSurface: SearchSurface =
    activeView === "bulletins" ? "bulletins" : activeView === "knowledge" ? "articles" : "staff";
  const activeResultCount =
    activeView === "bulletins"
      ? searchedBulletins.length
      : activeView === "knowledge"
        ? searchedArticles.length
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
        onOpenSearch={() => setPaletteOpen(true)}
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
            onSelect={setSelectedBulletinId}
            listTitle="Bulletin Board"
            listActions={
              isAuthor ? (
                <button
                  type="button"
                  onClick={() => setComposer({ mode: "create" })}
                  className="flex h-7 items-center gap-1 rounded-md border border-zinc-300/60 bg-white px-2 text-xs font-medium text-zinc-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
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
                icon={<Megaphone size={14} strokeWidth={1.75} aria-hidden="true" />}
                title={noMatchTitle}
                message={noMatchMessage}
              />
            }
            emptyDetailState={
              <EmptyState
                icon={<Megaphone size={14} strokeWidth={1.75} aria-hidden="true" />}
                title="No notice selected"
                message="Choose a notice from the list to read it here."
              />
            }
          />
        ) : null}

        {activeView === "knowledge" ? (
          <MasterDetailShell
            items={filteredArticles}
            getId={(article) => article.id}
            selectedId={selectedArticle?.id ?? null}
            onSelect={setSelectedArticleId}
            listTitle="Knowledge Base"
            listSubtitle={`${filteredArticles.length} of ${articles.length}`}
            listActions={
              isAuthor ? (
                <Link
                  href="/articles/new"
                  className="flex h-7 items-center gap-1 rounded-md border border-zinc-300/60 bg-white px-2 text-xs font-medium text-zinc-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                >
                  <Plus size={13} strokeWidth={2} aria-hidden="true" />
                  New procedure
                </Link>
              ) : null
            }
            renderListItem={(article, isSelected) => (
              <ArticleRow article={article} isSelected={isSelected} />
            )}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search procedures"
            searchLabel="Search standard operating procedures"
            activeDepartment={activeDepartment}
            onDepartmentChange={setActiveDepartment}
            counts={articleCounts}
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
            detailLabel="Procedure reader"
            emptyListState={
              <EmptyState
                icon={<BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />}
                title={noMatchTitle}
                message={noMatchMessage}
              />
            }
            emptyDetailState={
              <EmptyState
                icon={<BookOpen size={14} strokeWidth={1.75} aria-hidden="true" />}
                title="No procedure selected"
                message="Choose a procedure from the list to read it here."
              />
            }
          />
        ) : null}

        {activeView === "directory" ? (
          <DirectoryGrid
            staff={filteredStaff}
            totalCount={staff.length}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            activeDepartment={activeDepartment}
            onDepartmentChange={setActiveDepartment}
            counts={staffCounts}
            openRequest={personRequest}
          />
        ) : null}
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        index={searchIndex}
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
