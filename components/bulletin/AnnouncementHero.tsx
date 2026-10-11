/**
 * The announcement calling-card hero — the distinct rendering for
 * `format: "announcement"` (a celebratory post: no ack button, reactions only).
 *
 * A dark calling card above the body: Dove Black ground (`#20241E`) inside a
 * hairline frame (the `#AFBE23` highlight at 30%), the title centred in
 * `#AFBE23`, and a restrained centred meta line — a 40px initials disc with the
 * author, then `departments · date` in muted `#c9c9bd`.
 * No kicker and no eyebrow text: the format labels were removed as redundant.
 *
 * Presentational and pure so `scripts/verify-frontend.ts` can render it.
 */
import { formatDate, initials } from "@/lib/utils";
import { DEPARTMENT_LABELS, type ClinicalDepartment } from "@/types/portal";

export function AnnouncementHero({
  title,
  authorName,
  departments,
  publishedAt,
}: {
  title: string;
  authorName: string;
  departments: readonly ClinicalDepartment[];
  /** ISO 8601 publish timestamp. */
  publishedAt: string;
}) {
  const departmentText = departments.map((department) => DEPARTMENT_LABELS[department]).join(" · ");

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[rgba(175,190,35,0.30)] bg-[#20241E] px-6 py-8 text-center md:px-8 md:py-10">
      <h1 className="mx-auto max-w-3xl text-2xl font-semibold leading-tight text-[#AFBE23]">{title}</h1>

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

export default AnnouncementHero;
