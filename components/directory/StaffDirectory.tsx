"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Users } from "lucide-react";
import { DepartmentSelect } from "@/components/knowledge/DepartmentSelect";
import { DoveLewisIcon } from "@/components/brand/DoveLewisIcon";
import { CheckInToggle } from "@/components/directory/CheckInToggle";
import { StaffRow } from "@/components/directory/StaffRow";
import { StaffSearchHero } from "@/components/directory/StaffSearchHero";
import { useStaffPresence } from "@/components/directory/useStaffPresence";
import {
  departmentCountsFor,
  departmentOptionsFor,
  filterRoster,
  presentCount,
} from "@/lib/directory/roster";
import type { Department, StaffMember } from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * **The Staff Directory surface** — the third core product surface, in the same
 * clinical language as the Knowledge Home and the Bulletin Board.
 *
 * Architecture, top to bottom:
 *
 *  1. a full-bleed dark hero band (`#20241E`, the bulletin hero's ground) with
 *     the surface title treatment and **the one search input on the page** —
 *     search is the north star, so it is the most prominent control on the
 *     surface and it filters as you type. No brand lockup and no section
 *     navigation: the wordmark lives in the global header and the surfaces are
 *     switched from that header's dropdown, so neither repeats here;
 *  2. a controls row on the Clinical Light canvas: the Knowledge Home's single
 *     compact department dropdown on the left (no chip track), the self check-in
 *     toggle on the right;
 *  3. `HERE TODAY` — who is on the floor right now, in the exact row geometry of
 *     the full directory, marked with a live presence dot and a quiet "Here"
 *     badge;
 *  4. `ALL STAFF` — everybody matching the current query and department filter,
 *     present or not;
 *  5. one expandable row at a time: the detail panel opens *inside* the row's own
 *     card (no modal, no side pane, no photo grid).
 *
 * Search and the department filter are applied to both sections at once, so a
 * query answers "who is that, and are they here right now?" in one glance.
 *
 * **Presence** is per-browser (localStorage, keyed by the facility-local day) and
 * pre-seeded with a deterministic on-shift subset so the surface is
 * demonstrable. It is not shared between workstations: production wants a
 * `StaffMember.isPresentToday`-style column with a check-in endpoint. The
 * self check-in marks the signed-in person's own record (matched by the email
 * on their session); the viewer is deliberately not part of the pre-seeded
 * subset, so the first click always means "I am here". A sign-in with no
 * directory record renders the control disabled and an inline bar that says why.
 */

/** The workstation container the band's content and the directory both use. */
const CONTAINER = "mx-auto w-full max-w-4xl px-4 sm:px-6";

/**
 * Which of the two lists a row belongs to. The same person can be in both, so it
 * is part of a row's identity: it keys the expanded state and it disambiguates
 * the panel element's id.
 */
type SectionKey = "here" | "all";

/** The expanded row's panel id — unique per section, so ids never collide. */
function panelIdFor(section: SectionKey, memberId: string): string {
  return `staff-detail-${section}-${memberId}`;
}

/**
 * The grouped-container recipe, used by both sections: one clean white card with
 * a hairline edge and the same soft elevation every other card in the product
 * carries (`shadow-[0_1px_2px_…]`), rows divided by a 1px rule — deliberately not
 * a stack of separate cards, and not a heavy box either.
 */
const GROUP_CLASS =
  "divide-y divide-neutral-200/60 overflow-hidden rounded-xl border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

export interface StaffDirectoryProps {
  /** The whole roster (unfiltered) — the surface owns its own filtering. */
  staff: readonly StaffMember[];
  /**
   * The search query. Owned by the portal shell so the command palette and this
   * field can never disagree about what is being searched.
   */
  query: string;
  onQueryChange: (value: string) => void;
  /**
   * Ask the directory to expand one person's row (the command palette does
   * this). `nonce` makes a repeat request for the same person re-fire.
   */
  openRequest?: { memberId: string; nonce: number } | null;
  /** The signed-in viewer, so the check-in toggle knows whose record to mark. */
  viewer?: { name: string; email: string } | null;
}

export function StaffDirectory({
  staff,
  query,
  onQueryChange,
  openRequest,
  viewer,
}: StaffDirectoryProps) {
  const [department, setDepartment] = useState<Department>("All");
  /**
   * The expanded row, scoped to its section: the same person can be listed in
   * both HERE TODAY and ALL STAFF, and expanding one of those rows must not
   * expand the other (nor emit a second element with the same panel id).
   */
  const [expanded, setExpanded] = useState<{ section: SectionKey; id: string } | null>(null);
  const handledNonce = useRef<number | null>(null);

  const rosterIds = useMemo(() => staff.map((member) => member.id), [staff]);

  /** The viewer's own record, matched on the session email — never guessed. */
  const self = useMemo(() => {
    const email = viewer?.email?.trim().toLowerCase() ?? "";
    if (email.length === 0) return null;
    return staff.find((member) => member.email.toLowerCase() === email) ?? null;
  }, [staff, viewer]);

  const { presentIds, toggle } = useStaffPresence(rosterIds, self?.id ?? null);
  const present = useMemo(() => new Set(presentIds), [presentIds]);
  const toggleRow = useCallback((section: SectionKey, id: string) => {
    setExpanded((current) => (current && current.section === section && current.id === id ? null : { section, id }));
  }, []);

  const searching = query.trim().length > 0;
  const filtersTouched = department !== "All" || searching;

  const departmentOptions = useMemo(() => departmentOptionsFor(staff), [staff]);
  const departmentCounts = useMemo(() => departmentCountsFor(staff), [staff]);

  /**
   * Both sections come out of the same filter pass, so a query and a department
   * filter can never disagree about who matches: HERE TODAY is the present
   * subset of it, ALL STAFF is all of it.
   */
  const matched = useMemo(
    () => filterRoster(staff, { department, query }),
    [staff, department, query],
  );
  const hereToday = useMemo(
    () => matched.filter((member) => present.has(member.id)),
    [matched, present],
  );

  const presentTotal = useMemo(
    () => presentCount(rosterIds, presentIds),
    [rosterIds, presentIds],
  );

  const resetFilters = useCallback(() => {
    setDepartment("All");
    onQueryChange("");
  }, [onQueryChange]);

  /**
   * The palette's "open this person" request expands their row, in place. The
   * shell clears its own query when it switches to this surface, so the row is
   * always in the list it is about to scroll into view.
   */
  useEffect(() => {
    if (!openRequest || openRequest.nonce === handledNonce.current) return;
    handledNonce.current = openRequest.nonce;
    setExpanded({ section: "all", id: openRequest.memberId });
  }, [openRequest]);

  /**
   * `Esc` collapses the open row — the same terminal rule the other surfaces
   * bind, and the reason a row is an accordion rather than a modal: closing it
   * never needs a mouse.
   */
  useEffect(() => {
    if (expanded === null) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector("[aria-modal='true']")) return;
      setExpanded(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded]);

  const toggleSelf = useCallback(() => {
    if (self) toggle(self.id);
  }, [self, toggle]);

  const countLabel = searching || department !== "All"
    ? `${matched.length} of ${staff.length} staff members · ${hereToday.length} here today`
    : `${staff.length} staff members · ${presentTotal} here today`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden font-[family-name:var(--font-reader)] print:block print:overflow-visible">
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto print:overflow-visible">
        <header className="border-b border-[rgba(175,190,35,0.30)] bg-[#20241E] text-white print:hidden">
          <div className={cx(CONTAINER, "py-6 sm:py-8")}>
            <h1 className="dw-display text-[22px] font-bold leading-tight tracking-[-0.01em] text-white sm:text-[26px]">
              Staff Directory
            </h1>
            <p className="mt-1 text-[12.5px] text-white/60">
              Extensions, contact details, and who is on the floor right now.
            </p>

            <div className="mt-4">
              <StaffSearchHero
                value={query}
                onChange={onQueryChange}
                label="Search the staff directory"
                placeholder="Search staff by name, role, department, or extension..."
              />
            </div>

            <p className="mt-2.5 text-[11.5px] font-medium tabular-nums text-white/55">{countLabel}</p>
          </div>
        </header>

        <div className={cx(CONTAINER, "pb-14 pt-4 sm:pt-5")}>
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <DepartmentSelect
                  options={departmentOptions}
                  active={department}
                  onChange={setDepartment}
                  counts={departmentCounts}
                  label="Filter staff by department"
                />
                {filtersTouched ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="flex h-7 shrink-0 items-center rounded-md border border-[#5F6E00]/30 bg-white px-2.5 text-[12px] font-medium text-[#3F4A00] transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45"
                  >
                    Reset filters
                  </button>
                ) : null}
              </div>
              <CheckInToggle
                present={self ? present.has(self.id) : false}
                linked={self !== null}
                onToggle={toggleSelf}
                name={viewer?.name ?? "you"}
              />
            </div>

            {/*
             * A sign-in with no staff record cannot be checked in, and a control
             * that silently does nothing would read as a bug. The bar says why,
             * and what fixes it — the same compact inline shape as the
             * zero-checked-in state below.
             */}
            {self === null ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-white px-4 py-3 text-sm text-neutral-600">
                <span>
                  {viewer?.email
                    ? `${viewer.email} is not linked to a staff record yet, so it cannot check in.`
                    : "This sign-in is not linked to a staff record yet, so it cannot check in."}
                </span>
                <span className="text-[12px] text-zinc-400">An administrator can link the account.</span>
              </div>
            ) : null}

            <section aria-label="Here today">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Here today ({hereToday.length})
              </h2>
              {hereToday.length > 0 ? (
                <ul role="list" className={GROUP_CLASS}>
                  {hereToday.map((member) => (
                    <StaffRow
                      key={`here-${member.id}`}
                      member={member}
                      present
                      withHereBadge
                      expanded={expanded?.section === "here" && expanded.id === member.id}
                      onToggle={() => toggleRow("here", member.id)}
                      panelId={panelIdFor("here", member.id)}
                    />
                  ))}
                </ul>
              ) : presentTotal === 0 ? (
                /*
                 * Nobody at all is checked in today. The brief's rule: a compact
                 * inline bar, never the empty-bowl illustration — a bowl here
                 * would push the directory below the fold, and the directory is
                 * the reason anyone opened this page.
                 */
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-white px-4 py-3 text-sm text-neutral-600">
                  <span>No staff checked in yet today</span>
                  <button
                    type="button"
                    onClick={toggleSelf}
                    disabled={self === null}
                    className={cx(
                      "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45",
                      self === null
                        ? "cursor-not-allowed border-neutral-200 bg-white text-zinc-400"
                        : "border-[#5F6E00]/40 bg-white text-[#3F4A00] hover:bg-[#AFBE23]/15",
                    )}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#5F6E00]" />
                    Check yourself in
                  </button>
                </div>
              ) : (
                /*
                 * People are checked in — just none of them match what is being
                 * looked for. Saying "nobody is here today" would be a lie, so
                 * the bar says exactly what is empty and offers the way out.
                 */
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-white px-4 py-3 text-sm text-neutral-600">
                  <span>No one matching this filter is checked in right now</span>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="flex h-7 shrink-0 items-center rounded-md border border-[#5F6E00]/40 bg-white px-2.5 text-[12px] font-medium text-[#3F4A00] transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </section>

            <section aria-label="All staff">
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                All staff ({matched.length})
              </h2>
              {matched.length > 0 ? (
                <ul role="list" className={GROUP_CLASS}>
                  {matched.map((member) => (
                    <StaffRow
                      key={member.id}
                      member={member}
                      present={present.has(member.id)}
                      expanded={expanded?.section === "all" && expanded.id === member.id}
                      onToggle={() => toggleRow("all", member.id)}
                      panelId={panelIdFor("all", member.id)}
                    />
                  ))}
                </ul>
              ) : (
                <div className="rounded-xl border border-neutral-200/80 bg-white px-6 py-14">
                  <div className="flex justify-center">
                    <div className="flex max-w-xs flex-col items-center gap-2 text-center">
                      <DoveLewisIcon
                        className="mx-auto mb-3 opacity-55"
                        color="dark-green"
                        name="empty-bowl"
                        roughness={true}
                        size={44}
                      />
                      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-neutral-300/60 bg-white text-zinc-400 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
                        <Users size={14} strokeWidth={1.75} aria-hidden="true" />
                      </span>
                      <p className="mt-1 text-[13.5px] font-semibold text-zinc-800">
                        Nobody matches this search.
                      </p>
                      <p className="text-[12.5px] leading-5 text-zinc-500">
                        Try fewer words, another department, or an extension number.
                      </p>
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-1 flex h-7 items-center rounded-md border border-[#5F6E00]/30 bg-white px-2.5 text-[12px] font-medium text-[#3F4A00] transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45"
                      >
                        Clear filters
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StaffDirectory;
