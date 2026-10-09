"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  History,
  Info,
  Megaphone,
  PenLine,
  Pencil,
  Pin,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { CommandPalette } from "@/components/CommandPalette";
import { BulletinDetail } from "@/components/bulletin/BulletinDetail";
import { DirectoryGrid } from "@/components/DirectoryGrid";
import { MarkdownReader } from "@/components/MarkdownReader";
import { MasterDetailShell } from "@/components/MasterDetailShell";
import { PortalHeader } from "@/components/PortalHeader";
import { ReferencedBy } from "@/components/ReferencedBy";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { AuthorAccessMenu } from "@/components/auth/AuthorAccessMenu";
import { ArticleAttachments } from "@/components/editor/ArticleAttachments";
import { deleteBulletin, listBulletins } from "@/lib/bulletin/api";
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
  type BulletinPriority,
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

export interface OperationsHubClientProps {
  articles: readonly KnowledgeArticle[];
  bulletins: readonly Bulletin[];
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

const PRIORITY_META: Record<
  BulletinPriority,
  { label: string; className: string; icon: ReactNode }
> = {
  urgent: {
    label: "Urgent",
    className: "border-red-200 bg-red-50 text-red-700",
    icon: <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />,
  },
  pinned: {
    label: "Pinned",
    className: "border-teal-200 bg-teal-50 text-teal-800",
    icon: <Pin size={12} strokeWidth={2} aria-hidden="true" />,
  },
  normal: {
    label: "Notice",
    className: "border-zinc-200 bg-zinc-50 text-zinc-600",
    icon: <Info size={12} strokeWidth={2} aria-hidden="true" />,
  },
};

function PriorityBadge({ priority }: { priority: BulletinPriority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-semibold",
        meta.className,
      )}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

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

function BulletinRow({ bulletin, isSelected }: { bulletin: Bulletin; isSelected: boolean }) {
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
      <span className="mt-2 flex flex-wrap items-center gap-1">
        {bulletin.priority !== "normal" ? <PriorityBadge priority={bulletin.priority} /> : null}
        <DepartmentTags departments={bulletin.departments} />
      </span>
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
}: {
  article: KnowledgeArticle;
  canEdit: boolean;
  onOpenHistory: () => void;
  onOpenArticleBySlug: (slug: string, anchor?: string) => void;
  onOpenBulletin: (id: string) => void;
}) {
  return (
    <DetailFrame>
      <MarkdownReader
        source={article.body_markdown}
        onOpenArticle={onOpenArticleBySlug}
        header={
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={article.status} />
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
  bulletins,
  staff,
  viewerRole = null,
  viewerId = null,
  viewer = null,
  authoredBulletinIds = [],
  initialArticleSlug = null,
  authorRequest = null,
  roleRequests = [],
}: OperationsHubClientProps) {
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
    bulletins[0]?.id ?? null,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [personRequest, setPersonRequest] = useState<{ memberId: string; nonce: number } | null>(null);
  const pendingAnchor = useRef<string | null>(null);

  /**
   * The board is server-rendered into `bulletins`, then owned locally: posting,
   * editing, and deleting mutate this list and re-fetch it from the API, so the
   * board reflects the database rather than an optimistic guess.
   */
  const [bulletinList, setBulletinList] = useState<readonly Bulletin[]>(bulletins);
  const [composer, setComposer] = useState<{ mode: "create" } | { mode: "edit"; bulletin: Bulletin } | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  // Server-supplied authored ids, plus anything posted this session (the props
  // are read at page load, so a notice posted now would not be in them yet).
  const [authoredIds, setAuthoredIds] = useState<readonly string[]>(authoredBulletinIds);

  const refreshBulletins = useCallback(async (preferId?: string) => {
    try {
      const fresh = await listBulletins();
      setBulletinList(fresh);
      if (preferId) setSelectedBulletinId(preferId);
    } catch {
      // Keep the current list; the mutation itself already reported any error.
    }
  }, []);

  const handlePosted = useCallback(
    async (created: Bulletin) => {
      setComposer(null);
      setAuthoredIds((current) => (current.includes(created.id) ? current : [...current, created.id]));
      setSelectedBulletinId(created.id);
      await refreshBulletins(created.id);
    },
    [refreshBulletins],
  );

  const handleSaved = useCallback(
    async (saved: Bulletin) => {
      setComposer(null);
      setSelectedBulletinId(saved.id);
      await refreshBulletins(saved.id);
    },
    [refreshBulletins],
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
      setBulletinList((current) => current.filter((entry) => entry.id !== bulletin.id));
      setSelectedBulletinId(null);
      await refreshBulletins();
    },
    [refreshBulletins],
  );

  const isAuthor = viewerRole !== null && roleAtLeast(viewerRole, "author");
  /** Edit/delete on a notice: its author, or any clinical lead. The API re-checks. */
  const canManageBulletin = useCallback(
    (bulletin: Bulletin) =>
      viewerRole !== null &&
      roleAtLeast(viewerRole, "author") &&
      (roleAtLeast(viewerRole, "clinical_lead") || authoredIds.includes(bulletin.id)),
    [viewerRole, authoredIds],
  );
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
  const searchIndex = useMemo(
    () => buildSearchIndex(articles, bulletinList, staff),
    [articles, bulletinList, staff],
  );
  const debouncedQuery = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);
  // Clearing the field must restore the full list immediately, not 150 ms later.
  const effectiveQuery = searchQuery.trim().length === 0 ? "" : debouncedQuery;

  /* Bulletin board */
  const searchedBulletins = useMemo(
    () => rankBy(bulletinList, searchSurface(searchIndex, "bulletins", effectiveQuery)),
    [bulletinList, searchIndex, effectiveQuery],
  );
  const filteredBulletins = useMemo(
    () =>
      searchedBulletins.filter((bulletin) =>
        matchesDepartment(bulletin.departments, activeDepartment),
      ),
    [searchedBulletins, activeDepartment],
  );
  const bulletinCounts = useMemo(() => buildCounts(searchedBulletins), [searchedBulletins]);
  const selectedBulletin = useMemo(
    () => filteredBulletins.find((bulletin) => bulletin.id === selectedBulletinId) ?? null,
    [filteredBulletins, selectedBulletinId],
  );

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

  const isFiltered = searchQuery.trim().length > 0 || activeDepartment !== "All";
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
            items={filteredBulletins}
            getId={(bulletin) => bulletin.id}
            selectedId={selectedBulletin?.id ?? null}
            onSelect={setSelectedBulletinId}
            listTitle="Bulletin Board"
            listSubtitle={`${filteredBulletins.length} of ${bulletinList.length}`}
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
              <BulletinRow bulletin={bulletin} isSelected={isSelected} />
            )}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search notices"
            searchLabel="Search bulletins"
            activeDepartment={activeDepartment}
            onDepartmentChange={setActiveDepartment}
            counts={bulletinCounts}
            detail={
              selectedBulletin ? (
                <BulletinDetail
                  key={selectedBulletin.id}
                  bulletin={selectedBulletin}
                  articles={articles}
                  viewerRole={viewerRole ?? "readonly"}
                  viewerId={viewerId ?? ""}
                  canEdit={canManageBulletin(selectedBulletin)}
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
