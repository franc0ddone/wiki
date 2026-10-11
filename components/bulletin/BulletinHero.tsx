/**
 * The bulletin calling card — the universal dark header for **every** bulletin
 * (prompt 6c follow-up). `pinned` / `urgent` no longer change it; they only
 * affect board ordering (pinned first) and chips (the red urgent chip).
 *
 * A fixed-width card: capped at `max-w-3xl` (48rem) and centred, so it renders
 * the identical size whether or not `MarkdownReader`'s "On this page" sidebar
 * is present (the sidebar would otherwise narrow the article column and change
 * the card's shape). Below the cap it shrinks with the column.
 *
 * A dark card above the body: Dove Black ground (`#20241E`) inside a hairline
 * frame (the `#AFBE23` highlight at 30%), the title centred in `#AFBE23`, the
 * optional deck as a muted `#c9c9bd` subtitle directly under the headline, and
 * a restrained centred meta line — a 40px initials disc with the author, then
 * `departments · date` in muted `#c9c9bd`.
 *
 * Presentational and pure so `scripts/verify-frontend.ts` can render it.
 */
import { formatDate, initials } from "@/lib/utils";
import { DEPARTMENT_LABELS, type ClinicalDepartment } from "@/types/portal";

export function BulletinHero({
  title,
  deck,
  authorName,
  departments,
  publishedAt,
}: {
  title: string;
  /** The optional subtitle line. Absent/empty renders no line and no gap. */
  deck?: string | null;
  authorName: string;
  departments: readonly ClinicalDepartment[];
  /** ISO 8601 publish timestamp. */
  publishedAt: string;
}) {
  const departmentText = departments.map((department) => DEPARTMENT_LABELS[department]).join(" · ");

  return (
    <div className="mt-4 mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-[rgba(175,190,35,0.30)] bg-[#20241E] px-6 py-8 text-center md:px-8 md:py-10">
      <h1 className="dw-display mx-auto max-w-3xl text-[48px] font-bold leading-tight text-[#AFBE23]">{title}</h1>

      {deck ? (
        <p className="mx-auto mt-3 max-w-2xl text-[24px] leading-relaxed text-[#c9c9bd]">{deck}</p>
      ) : null}

      <div className="mt-5 flex flex-col items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E6EBA5] text-[13px] font-semibold text-[#5F6E00]"
        >
          {initials(authorName)}
        </span>
        <span className="text-[13px] font-medium text-[#c9c9bd]">{authorName}</span>
        <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[12.5px] text-[#c9c9bd]/80">
          {departmentText ? <span>{departmentText}</span> : null}
          {departmentText ? <span aria-hidden="true">·</span> : null}
          <time dateTime={publishedAt}>{formatDate(publishedAt)}</time>
        </span>
      </div>
    </div>
  );
}

export default BulletinHero;
