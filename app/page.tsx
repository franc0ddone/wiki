"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, BookText, Info, Pin, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { DirectoryGrid } from "@/components/DirectoryGrid";
import { MarkdownReader } from "@/components/MarkdownReader";
import { MasterDetailShell } from "@/components/MasterDetailShell";
import { PortalHeader } from "@/components/PortalHeader";
import { ViewToolbar } from "@/components/ViewToolbar";
import {
  BULLETINS,
  KNOWLEDGE_ARTICLES,
  STAFF_DIRECTORY,
  findLinkedArticle,
  matchesDepartment,
  matchesQuery,
} from "@/lib/mock-data";
import { cx, formatDate, formatDateTime } from "@/lib/utils";
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
} from "@/types/portal";

/* ------------------------------------------------------------------ helpers */

/** Counts per department for the filter bar. `All` is the unfiltered total. */
function buildCounts<T extends { departments: ClinicalDepartment[] }>(
  items: readonly T[],
): DepartmentCounts {
  const counts: DepartmentCounts = { All: items.length };
  for (const department of CLINICAL_DEPARTMENTS) {
    counts[department] = items.filter((item) => item.departments.includes(department)).length;
  }
  return counts;
}

const PRIORITY_META: Record<
  BulletinPriority,
  { label: string; className: string; icon: ReactNode }
> = {
  urgent: {
    label: "Urgent",
    className: "border-red-900/80 bg-red-950/40 text-red-400",
    icon: <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />,
  },
  pinned: {
    label: "Pinned",
    className: "border-[#5CBEB4]/40 bg-[#005953]/25 text-[#5CBEB4]",
    icon: <Pin size={12} strokeWidth={1.75} aria-hidden="true" />,
  },
  normal: {
    label: "Notice",
    className: "border-zinc-800 bg-zinc-900 text-zinc-400",
    icon: <Info size={12} strokeWidth={1.75} aria-hidden="true" />,
  },
};

function PriorityBadge({ priority }: { priority: BulletinPriority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
        meta.className,
      )}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

function DepartmentTags({ departments }: { departments: readonly ClinicalDepartment[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {departments.map((department) => (
        <span
          key={department}
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tracking-tight text-zinc-400"
        >
          {DEPARTMENT_LABELS[department]}
        </span>
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: KnowledgeArticle["status"] }) {
  const isDraft = status === "draft";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
        isDraft
          ? "border-amber-900/80 bg-amber-950/30 text-amber-400"
          : "border-zinc-800 bg-zinc-900 text-zinc-400",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("h-1.5 w-1.5 rounded-full", isDraft ? "bg-amber-400" : "bg-[#5CBEB4]")}
      />
      {isDraft ? "Draft" : "Published"}
    </span>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600">
        {label}
      </span>
      <span className="text-[12px] text-zinc-300">{children}</span>
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-5 py-4 text-center text-[12.5px] text-zinc-500">
      {message}
    </p>
  );
}

/* ---------------------------------------------------------------- list rows */

function ArticleRow({ article, isSelected }: { article: KnowledgeArticle; isSelected: boolean }) {
  return (
    <span className="block">
      <span className="flex items-start justify-between gap-3">
        <span
          className={cx(
            "text-[13.5px] font-medium leading-snug",
            isSelected ? "text-[#5CBEB4]" : "text-zinc-100",
          )}
        >
          {article.title}
        </span>
        {article.status === "draft" ? (
          <span className="mt-0.5 shrink-0 rounded border border-amber-900/80 bg-amber-950/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-400">
            Draft
          </span>
        ) : null}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <DepartmentTags departments={article.departments} />
      </span>
      <span className="mt-2 block truncate text-[11px] text-zinc-600">
        {formatDate(article.updated_at)}
        <span className="mx-1.5 text-zinc-700">·</span>
        {article.author_name}
      </span>
    </span>
  );
}

function BulletinRow({ bulletin, isSelected }: { bulletin: Bulletin; isSelected: boolean }) {
  return (
    <span className="block">
      <span className="flex items-center gap-1.5">
        <PriorityBadge priority={bulletin.priority} />
        <DepartmentTags departments={bulletin.departments} />
      </span>
      <span
        className={cx(
          "mt-2 block text-[13.5px] font-medium leading-snug",
          isSelected ? "text-[#5CBEB4]" : "text-zinc-100",
        )}
      >
        {bulletin.title}
      </span>
      <span className="mt-2 block truncate text-[11px] text-zinc-600">
        {formatDateTime(bulletin.created_at)}
        <span className="mx-1.5 text-zinc-700">·</span>
        {bulletin.author_name}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------- detail panes */

function ArticleDetail({ article }: { article: KnowledgeArticle }) {
  return (
    <article className="mx-auto w-full max-w-[68rem] px-6 py-8 sm:px-10 sm:py-10">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={article.status} />
        <DepartmentTags departments={article.departments} />
      </div>

      <h1 className="mt-5 max-w-3xl text-2xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-[2rem]">
        {article.title}
      </h1>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 pb-5">
        <MetaItem label="Author">{article.author_name}</MetaItem>
        <MetaItem label="Updated">{formatDate(article.updated_at)}</MetaItem>
        <MetaItem label="Slug">
          <span className="font-mono text-[11px] text-zinc-400">{article.slug}</span>
        </MetaItem>
      </div>

      <div className="mt-8">
        <MarkdownReader source={article.body_markdown} showTableOfContents />
      </div>

      {article.status === "draft" ? (
        <p className="mt-10 rounded-lg border border-amber-900/60 bg-amber-950/20 px-4 py-3.5 text-[12.5px] leading-6 text-amber-300">
          This procedure is still a draft and is not in force. Do not follow it for patient care
          until the clinical leads publish it.
        </p>
      ) : null}
    </article>
  );
}

function BulletinDetail({ bulletin }: { bulletin: Bulletin }) {
  const linkedArticle = findLinkedArticle(bulletin);

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10 sm:py-10">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={bulletin.priority} />
        <DepartmentTags departments={bulletin.departments} />
      </div>

      <h1 className="mt-5 text-2xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-[2rem]">
        {bulletin.title}
      </h1>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 pb-5">
        <MetaItem label="Posted">{formatDateTime(bulletin.created_at)}</MetaItem>
        <MetaItem label="By">{bulletin.author_name}</MetaItem>
      </div>

      <div className="mt-8">
        <MarkdownReader source={bulletin.body_markdown} />
      </div>

      <div className="mt-10 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Referenced procedure
        </p>
        {linkedArticle ? (
          <p className="mt-2.5 flex items-start gap-2.5 text-[13px] text-zinc-200">
            <BookText
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-[#5CBEB4]"
            />
            <span className="min-w-0">
              {linkedArticle.title}
              <span className="mt-1 block font-mono text-[11px] text-zinc-500">
                {linkedArticle.slug}
              </span>
            </span>
            <ArrowUpRight
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-zinc-600"
            />
          </p>
        ) : (
          <p className="mt-2.5 text-[13px] text-zinc-500">No linked procedure for this notice.</p>
        )}
      </div>
    </article>
  );
}

/* --------------------------------------------------------------------- page */

export default function OperationsHubPage() {
  const [activeView, setActiveView] = useState<PortalView>("bulletins");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeDepartment, setActiveDepartment] = useState<Department>("All");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [selectedBulletinId, setSelectedBulletinId] = useState<string | null>(
    BULLETINS[0]?.id ?? null,
  );

  const handleViewChange = (view: PortalView) => {
    setActiveView(view);
    setSearchQuery("");
    setActiveDepartment("All");
  };

  /* Bulletin board */
  const searchedBulletins = useMemo(
    () =>
      BULLETINS.filter((bulletin) =>
        matchesQuery(searchQuery, [
          bulletin.title,
          bulletin.body_markdown,
          bulletin.author_name,
          bulletin.priority,
        ]),
      ),
    [searchQuery],
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
      KNOWLEDGE_ARTICLES.filter((article) =>
        matchesQuery(searchQuery, [
          article.title,
          article.slug,
          article.body_markdown,
          article.author_name,
        ]),
      ),
    [searchQuery],
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
      STAFF_DIRECTORY.filter((member) =>
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
    [searchQuery],
  );
  const filteredStaff = useMemo(
    () => searchedStaff.filter((member) => matchesDepartment(member.departments, activeDepartment)),
    [searchedStaff, activeDepartment],
  );
  const staffCounts = useMemo(() => buildCounts(searchedStaff), [searchedStaff]);

  const isFiltered = searchQuery.trim().length > 0 || activeDepartment !== "All";
  const noMatchHint = isFiltered
    ? "Nothing matches the current search and department filter."
    : "Nothing has been published here yet.";

  return (
    <div className="flex h-dvh flex-col bg-zinc-950">
      <PortalHeader activeView={activeView} onViewChange={handleViewChange} />

      <main className="flex min-h-0 flex-1 flex-col">
        {activeView === "bulletins" ? (
          <MasterDetailShell
            items={filteredBulletins}
            getId={(bulletin) => bulletin.id}
            selectedId={selectedBulletin?.id ?? null}
            onSelect={setSelectedBulletinId}
            listTitle="Notices"
            listSubtitle={`${filteredBulletins.length} of ${BULLETINS.length}`}
            renderListItem={(bulletin, isSelected) => (
              <BulletinRow bulletin={bulletin} isSelected={isSelected} />
            )}
            toolbar={
              <ViewToolbar
                layout="list"
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="Search notices…"
                searchLabel="Search bulletins"
                activeDepartment={activeDepartment}
                onDepartmentChange={setActiveDepartment}
                counts={bulletinCounts}
              />
            }
            detail={selectedBulletin ? <BulletinDetail bulletin={selectedBulletin} /> : null}
            detailLabel="Bulletin reader"
            emptyListState={<EmptyState message={noMatchHint} />}
            emptyDetailState={<EmptyState message="Select a notice to read it here." />}
          />
        ) : null}

        {activeView === "knowledge" ? (
          <MasterDetailShell
            items={filteredArticles}
            getId={(article) => article.id}
            selectedId={selectedArticle?.id ?? null}
            onSelect={setSelectedArticleId}
            listTitle="Procedures"
            listSubtitle={`${filteredArticles.length} of ${KNOWLEDGE_ARTICLES.length}`}
            renderListItem={(article, isSelected) => (
              <ArticleRow article={article} isSelected={isSelected} />
            )}
            toolbar={
              <ViewToolbar
                layout="list"
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="Search procedures…"
                searchLabel="Search standard operating procedures"
                activeDepartment={activeDepartment}
                onDepartmentChange={setActiveDepartment}
                counts={articleCounts}
              />
            }
            detail={selectedArticle ? <ArticleDetail article={selectedArticle} /> : null}
            detailLabel="Procedure reader"
            emptyListState={<EmptyState message={noMatchHint} />}
            emptyDetailState={<EmptyState message="Select a procedure to read it here." />}
          />
        ) : null}

        {activeView === "directory" ? (
          <DirectoryGrid
            staff={filteredStaff}
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