"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  FileText,
  Info,
  Megaphone,
  PenLine,
  Pin,
  TriangleAlert,
} from "lucide-react";
import { DirectoryGrid } from "@/components/DirectoryGrid";
import { MarkdownReader } from "@/components/MarkdownReader";
import { MasterDetailShell } from "@/components/MasterDetailShell";
import { PortalHeader } from "@/components/PortalHeader";
import { matchesDepartment, matchesQuery } from "@/lib/data/filters";
import { FACILITY_TIME_ZONE, cx, formatDate, formatDateTime } from "@/lib/utils";
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

/**
 * Interactive shell for the portal.
 *
 * The three data sets are fetched on the server (`app/page.tsx` via
 * `lib/data/*`) and handed in as props; everything interactive — view
 * switching, search, department filtering, list/detail selection, the
 * personnel drawer — lives here so the page itself can stay a server
 * component. Client-side filtering keeps the phase-1 matching behaviour
 * exactly (`matchesQuery` / `matchesDepartment`); the search upgrade is a
 * later pass.
 */

export interface OperationsHubClientProps {
  articles: readonly KnowledgeArticle[];
  bulletins: readonly Bulletin[];
  staff: readonly StaffMember[];
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
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}...` : plain;
}

/** Display name without the role suffix, e.g. `"Dr. Maya Okonkwo"`. */
function authorName(author: string): string {
  return author.split(",")[0]?.trim() ?? author;
}

/** Resolve the SOP a bulletin points at from the already-fetched article set. */
function findLinkedArticle(
  bulletin: Bulletin,
  articles: readonly KnowledgeArticle[],
): KnowledgeArticle | null {
  if (!bulletin.linked_sop_id) return null;
  return articles.find((article) => article.id === bulletin.linked_sop_id) ?? null;
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
  const isDraft = status === "draft";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-xs font-semibold",
        isDraft
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-zinc-200 bg-zinc-50 text-zinc-600",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("h-1.5 w-1.5 rounded-full", isDraft ? "bg-amber-500" : "bg-[#0F766E]")}
      />
      {isDraft ? "Draft" : "Published"}
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
        {article.status === "draft" ? <StatusBadge status="draft" /> : null}
        <DepartmentTags departments={article.departments} />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------- detail panes */

function DetailFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[72rem] px-4 py-6 sm:px-6 md:px-8 md:py-10">{children}</div>;
}

function ArticleDetail({ article }: { article: KnowledgeArticle }) {
  return (
    <DetailFrame>
      <MarkdownReader
        source={article.body_markdown}
        header={
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={article.status} />
              <DepartmentTags departments={article.departments} />
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
          article.status === "draft" ? (
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
              This procedure is a draft and is not in force. Do not follow it for patient care until
              the clinical leads publish it.
            </aside>
          ) : (
            <p className="border-t border-zinc-200 pt-6 font-mono text-xs text-zinc-400">
              {article.slug}
            </p>
          )
        }
      />
    </DetailFrame>
  );
}

function BulletinDetail({
  bulletin,
  articles,
  onOpenArticle,
}: {
  bulletin: Bulletin;
  articles: readonly KnowledgeArticle[];
  onOpenArticle: (articleId: string) => void;
}) {
  const linkedArticle = findLinkedArticle(bulletin, articles);

  return (
    <DetailFrame>
      <MarkdownReader
        source={bulletin.body_markdown}
        header={
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <PriorityBadge priority={bulletin.priority} />
              <DepartmentTags departments={bulletin.departments} />
            </div>
            <h1 className="mt-4 text-[1.85rem] font-semibold leading-[1.15] tracking-tight text-zinc-900 md:text-[2.2rem]">
              {bulletin.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <MetaItem icon={<PenLine size={14} strokeWidth={1.75} aria-hidden="true" />} label="Posted by">
                {bulletin.author_name}
              </MetaItem>
              <MetaItem
                icon={<CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />}
                label="Posted"
              >
                {formatDateTime(bulletin.created_at)}
              </MetaItem>
            </div>
          </>
        }
        footer={
          <div className="border-t border-zinc-200 pt-6">
            <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Referenced procedure
            </p>
            {linkedArticle ? (
              <button
                type="button"
                onClick={() => onOpenArticle(linkedArticle.id)}
                className="group flex w-full items-center gap-3 rounded-[10px] border border-zinc-300/60 bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors duration-150 hover:border-teal-600/40 hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-[#0F766E]">
                  <FileText size={14} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-zinc-900">
                    {linkedArticle.title}
                  </span>
                  <span className="block text-xs text-zinc-500">Open in Knowledge Base</span>
                </span>
                <ArrowUpRight
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="shrink-0 text-zinc-400 transition-colors group-hover:text-[#0F766E]"
                />
              </button>
            ) : (
              <p className="text-[13px] text-zinc-500">No linked procedure for this notice.</p>
            )}
          </div>
        }
      />
    </DetailFrame>
  );
}

/* --------------------------------------------------------------------- page */

export function OperationsHubClient({ articles, bulletins, staff }: OperationsHubClientProps) {
  const [activeView, setActiveView] = useState<PortalView>("bulletins");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeDepartment, setActiveDepartment] = useState<Department>("All");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [selectedBulletinId, setSelectedBulletinId] = useState<string | null>(
    bulletins[0]?.id ?? null,
  );

  const handleViewChange = (view: PortalView) => {
    setActiveView(view);
    setSearchQuery("");
    setActiveDepartment("All");
  };

  const openArticle = (articleId: string) => {
    handleViewChange("knowledge");
    setSelectedArticleId(articleId);
  };

  /* Bulletin board */
  const searchedBulletins = useMemo(
    () =>
      bulletins.filter((bulletin) =>
        matchesQuery(searchQuery, [
          bulletin.title,
          bulletin.body_markdown,
          bulletin.author_name,
          bulletin.priority,
        ]),
      ),
    [bulletins, searchQuery],
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
    () =>
      articles.filter((article) =>
        matchesQuery(searchQuery, [
          article.title,
          article.slug,
          article.body_markdown,
          article.author_name,
        ]),
      ),
    [articles, searchQuery],
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
    () =>
      staff.filter((member) =>
        matchesQuery(searchQuery, [
          member.full_name,
          member.preferred_name,
          member.pronouns,
          member.title,
          member.email,
          member.phone_extension,
          member.system_id,
        ]),
      ),
    [staff, searchQuery],
  );
  const filteredStaff = useMemo(
    () => searchedStaff.filter((member) => matchesDepartment(member.departments, activeDepartment)),
    [searchedStaff, activeDepartment],
  );
  const staffCounts = useMemo(() => buildCounts(searchedStaff), [searchedStaff]);

  const isFiltered = searchQuery.trim().length > 0 || activeDepartment !== "All";
  const noMatchTitle = isFiltered ? "No matches" : "Nothing here yet";
  const noMatchMessage = isFiltered
    ? "Nothing matches the current search and department filter."
    : "Items appear here once they are published.";

  return (
    <div className="flex h-dvh flex-col bg-[#F4F4F5] text-zinc-900">
      <PortalHeader activeView={activeView} onViewChange={handleViewChange} />

      <main className="flex min-h-0 flex-1 flex-col">
        {activeView === "bulletins" ? (
          <MasterDetailShell
            items={filteredBulletins}
            getId={(bulletin) => bulletin.id}
            selectedId={selectedBulletin?.id ?? null}
            onSelect={setSelectedBulletinId}
            listTitle="Bulletin Board"
            listSubtitle={`${filteredBulletins.length} of ${bulletins.length}`}
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
                  bulletin={selectedBulletin}
                  articles={articles}
                  onOpenArticle={openArticle}
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
            detail={selectedArticle ? <ArticleDetail article={selectedArticle} /> : null}
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
          />
        ) : null}
      </main>
    </div>
  );
}

export default OperationsHubClient;