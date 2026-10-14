"use client";

import { Star } from "lucide-react";
import { lastPublishedAt, versionJumpLabel } from "@/lib/knowledge/feed";
import { relativeTime } from "@/lib/knowledge/relative-time";
import {
  AUDIENCE_LABELS,
  DEPARTMENT_LABELS,
  type ClinicalDepartment,
  type KnowledgeArticle,
} from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * **One row of the Knowledge Home feed** (prompt 7c, items 3 and 4) — named for
 * the spec's `<SopFeedList />` row component.
 *
 * One component serves both modes and both groups, so a Feed Mode row (recency
 * ranked) and a Results Mode row (relevance ranked) are byte-identical in shape,
 * as are the Essential SOPs rows above the feed. The shell owns the row's chrome
 * and its selection behaviour; this is only the content.
 *
 * What a row shows: the author of the **latest published version** (falling back
 * to the article's author), the relative publish time, the title, the department
 * badges, the version-jump badge, and — for anything not written for "All" — the
 * audience it belongs to.
 *
 * Rows open the procedure in the portal's reader rather than rendering a nested
 * `<a>`: the row *is* the shell's selection button (`MasterDetailShell`), and an
 * anchor inside a button is invalid HTML. `/procedures/<slug>` is the same
 * reader — that route redirects into this surface with the slug selected.
 */

export interface SopFeedListProps {
  article: KnowledgeArticle;
  isSelected: boolean;
  /** A ticking reference time, so relative labels agree with the rest of the portal. */
  now: number;
  /** `"essential"` adds the curated accent. */
  variant?: "standard" | "essential";
}

export function SopFeedList({ article, isSelected, now, variant = "standard" }: SopFeedListProps) {
  const publishedAt = lastPublishedAt(article);
  const when = relativeTime(publishedAt, now);
  const jump = versionJumpLabel(article);
  // The latest published version's author is who a reader should ask about the
  // current text; the article's author is the fallback for legacy rows.
  const byline = displayName(article.latest_published_by ?? article.author_name);

  return (
    <span className="block">
      <span className="flex items-center justify-between gap-3">
        <span className="truncate text-xs font-medium text-zinc-500">{byline}</span>
        <time dateTime={publishedAt} className="shrink-0 text-xs font-medium tabular-nums text-zinc-500">
          {when ?? publishedAt}
        </time>
      </span>
      <span
        className={cx(
          "mt-1 block text-[13.5px] font-semibold leading-snug tracking-[-0.005em]",
          isSelected ? "text-zinc-900" : "text-zinc-800",
        )}
      >
        {article.title}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1">
        {variant === "essential" ? <EssentialChip /> : null}
        <DepartmentTags departments={article.departments} />
        {jump ? <VersionJumpChip label={jump} /> : null}
        {article.audience !== "ALL" ? <AudienceChip audience={article.audience} /> : null}
      </span>
    </span>
  );
}

/** The curated accent — Dove Green, and the only filled chip in a feed row. */
function EssentialChip() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[#5F6E00]/30 bg-[#AFBE23]/20 px-2 py-px text-[11px] font-semibold text-[#3F4A00]">
      <Star size={11} strokeWidth={2} aria-hidden="true" fill="#AFBE23" />
      Essential
    </span>
  );
}

/** `v8 → v9` once a procedure has been published twice; `v1` on its first. */
function VersionJumpChip({ label }: { label: string }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-[#5F6E00]/25 bg-white px-2 py-px text-[11px] font-medium tabular-nums text-[#3F4A00]">
      {label}
    </span>
  );
}

/** Only rendered when the procedure is not written for everyone. */
function AudienceChip({ audience }: { audience: KnowledgeArticle["audience"] }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-zinc-300/70 bg-zinc-50 px-2 py-px text-[11px] font-medium text-zinc-600">
      {AUDIENCE_LABELS[audience]}
    </span>
  );
}

/** Department badges — the portal's outline-pill language, in Dark Green. */
function DepartmentTags({ departments }: { departments: readonly ClinicalDepartment[] }) {
  return (
    <>
      {departments.map((department) => (
        <span
          key={department}
          className="whitespace-nowrap rounded-full border border-[#5F6E00]/25 bg-[#AFBE23]/10 px-2 py-px text-[11px] font-medium text-[#3F4A00]"
        >
          {DEPARTMENT_LABELS[department]}
        </span>
      ))}
    </>
  );
}

/** `"Dr. Maya Okonkwo, Lead Emergency Clinician"` → `"Dr. Maya Okonkwo"`. */
function displayName(author: string): string {
  return author.split(",")[0]?.trim() ?? author;
}

export default SopFeedList;
