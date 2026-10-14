"use client";

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
 * **One row of the Knowledge Home feed** — one component for both modes and both
 * groups, so a Feed Mode row (recency ranked) and a Results Mode row (relevance
 * ranked) are byte-identical in shape, as are the Essential SOPs rows above the
 * feed. The surface owns the row's chrome, its card and its selection
 * behaviour; this is only the content.
 *
 * What a row shows: who published the **latest published version** (falling back
 * to the article's author), the title, and the evergreen SOP metadata — the
 * version indicator (a version jump once the procedure has been published
 * twice) and the relative publish time in the secondary slot beside the byline.
 *
 * The treatment is the bulletin board's rail card, at the feed's measure:
 *
 *  - the title is Domine serif at the rail's title scale, in Dove Black
 *    `#20241E`, moving to Dark Green `#5F6E00` under the cursor;
 *  - everything else is Palanquin in quiet clinical greys (`text-zinc-500` for
 *    the byline, the version indicator and the timestamp; `text-zinc-400` for
 *    the department line);
 *  - **departments are silent**: they stay indexed in Fuse.js and filterable
 *    through the chip track, so a row states them as ultra-quiet plain text and
 *    never as a coloured pill — exactly how a bulletin rail card behaves.
 *
 * The Essential group's caption is what says a row is curated. A row inside that
 * group therefore draws no "Essential" pill; the curated accent survives as an
 * accessible marker only, so the row's name still says why it sits in the top
 * group while the visual language stays the board's.
 *
 * Rows open the procedure in the portal's reader rather than rendering a nested
 * `<a>`: the row *is* the surface's selection button, and an anchor inside a
 * button is invalid HTML. `/procedures/<slug>` is the same reader — that route
 * redirects into this surface with the slug selected.
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
    <span className="block min-w-0">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate text-xs font-medium text-zinc-500">{byline}</span>
        <span className="flex shrink-0 items-center gap-2.5">
          {variant === "essential" ? <span className="sr-only">Essential procedure</span> : null}
          {jump ? <VersionIndicator label={jump} /> : null}
          <time
            dateTime={publishedAt}
            className="whitespace-nowrap text-xs font-medium tabular-nums text-zinc-500"
          >
            {when ?? publishedAt}
          </time>
        </span>
      </span>
      <span
        className={cx(
          "dw-display mt-1 block min-w-0 break-words text-[13.5px] font-semibold leading-snug tracking-[-0.005em] transition-colors duration-150",
          isSelected ? "text-[#5F6E00]" : "text-[#20241E] group-hover:text-[#5F6E00]",
        )}
      >
        {article.title}
      </span>
      <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-zinc-400">
        <DepartmentLine departments={article.departments} />
        {article.audience !== "ALL" ? (
          <span className="whitespace-nowrap">{AUDIENCE_LABELS[article.audience]}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The version indicator: `v8 → v9` once a procedure has been published twice,
 * plain `v1` on its first. Palanquin, tabular figures, quiet — the same place a
 * bulletin row states when it comes down, and never a loud badge.
 */
function VersionIndicator({ label }: { label: string }) {
  return (
    <span
      title="Latest published version"
      className="whitespace-nowrap text-[11px] font-medium tabular-nums text-zinc-500"
    >
      {label}
    </span>
  );
}

/**
 * Department associations, stated once as plain muted text. They remain indexed
 * for search and filterable from the chip track; the row itself never repeats
 * them as a coloured pill (the bulletin rail's rule).
 */
function DepartmentLine({ departments }: { departments: readonly ClinicalDepartment[] }) {
  if (departments.length === 0) return null;
  return (
    <span className="min-w-0 break-words">
      {departments.map((department) => DEPARTMENT_LABELS[department]).join(" \u00b7 ")}
    </span>
  );
}

/** `"Dr. Maya Okonkwo, Lead Emergency Clinician"` → `"Dr. Maya Okonkwo"`. */
function displayName(author: string): string {
  return author.split(",")[0]?.trim() ?? author;
}

export default SopFeedList;
