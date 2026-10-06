"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Mail,
  Moon,
  Phone,
  Sun,
  Sunset,
  Users,
  X,
} from "lucide-react";
import {
  DEPARTMENT_LABELS,
  type ClinicalDepartment,
  type Department,
  type DepartmentCounts,
  type ShiftPreference,
  type StaffMember,
} from "@/types/portal";
import { cx, initials, writeToClipboard } from "@/lib/utils";
import { DepartmentChipTrack, SearchField } from "@/components/MasterDetailShell";

/**
 * Personnel directory in the contact-book list idiom: alphabetical sections of
 * white rows on the canvas. Selecting a row opens a slide-over sheet from the
 * right edge with the full record. Search and department filtering are owned by
 * the page, so all three surfaces filter alike.
 */

export interface DirectoryGridProps {
  staff: readonly StaffMember[];
  /** Total unfiltered headcount, for the "n of N" summary. */
  totalCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  activeDepartment: Department;
  onDepartmentChange: (department: Department) => void;
  counts: DepartmentCounts;
}

const DRAWER_EXIT_MS = 240;
const COPY_RESET_MS = 1800;

const HONORIFIC_RE = /^(dr|mr|ms|mrs|prof)\.?$/i;

/** Sort key and section letter come from the family name, as in Contacts. */
function familyName(fullName: string): string {
  const words = fullName.split(/\s+/).filter((word) => word && !HONORIFIC_RE.test(word));
  return words[words.length - 1] ?? fullName;
}

/* ---------------------------------------------------------------- avatars */

const AVATAR_SIZES = {
  sm: "h-10 w-10 text-[13px] rounded-full",
  lg: "h-[88px] w-[88px] text-[28px] rounded-full",
} as const;

function Avatar({ member, size = "sm" }: { member: StaffMember; size?: keyof typeof AVATAR_SIZES }) {
  if (member.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars become Supabase Storage URLs later; a plain img avoids remotePatterns config in this phase.
      <img
        src={member.avatar_url}
        alt=""
        width={size === "lg" ? 176 : 80}
        height={size === "lg" ? 176 : 80}
        className={cx(
          "shrink-0 object-cover ring-1 ring-teal-600/20",
          AVATAR_SIZES[size],
          size === "lg" && "shadow-[0_4px_14px_-4px_rgba(0,0,0,0.18)]",
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 select-none items-center justify-center font-semibold tracking-[0.02em] text-teal-800",
        "bg-[linear-gradient(145deg,#F0FDFA_0%,#CCFBF1_55%,#99F6E4_140%)] ring-1 ring-inset ring-teal-600/20",
        AVATAR_SIZES[size],
        size === "lg" && "shadow-[0_4px_14px_-4px_rgba(15,118,110,0.35)]",
      )}
    >
      {initials(member.full_name)}
    </span>
  );
}

/* ----------------------------------------------------------------- badges */

function DepartmentTags({
  departments,
  max,
}: {
  departments: readonly ClinicalDepartment[];
  max?: number;
}) {
  const shown = max ? departments.slice(0, max) : departments;
  const overflow = departments.length - shown.length;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((department) => (
        <span
          key={department}
          className="whitespace-nowrap rounded-full border border-teal-600/30 bg-teal-50/50 px-2 py-px text-xs font-medium text-teal-700"
        >
          {DEPARTMENT_LABELS[department]}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="text-xs font-medium text-zinc-400">+{overflow}</span>
      ) : null}
    </span>
  );
}

const SHIFT_ICONS: Record<ShiftPreference, typeof Sun> = {
  Day: Sun,
  Swing: Sunset,
  Overnight: Moon,
};

/* ----------------------------------------------------------- sheet pieces */

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
      {children}
    </p>
  );
}

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-zinc-300/60 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
      <div className="divide-y divide-zinc-200">{children}</div>
    </div>
  );
}

function GroupRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5">
      <span className="shrink-0 text-[13px] text-zinc-500">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium text-zinc-900">{children}</span>
    </div>
  );
}

type CopyStatus = "copied" | "failed";

function CopyButton({
  status,
  onCopy,
  label,
}: {
  status: CopyStatus | undefined;
  onCopy: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label}
      className={cx(
        "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
        status === "copied"
          ? "border-teal-200 bg-teal-50 text-teal-800"
          : status === "failed"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900",
      )}
    >
      {status === "copied" ? (
        <>
          <Check size={14} strokeWidth={2.25} aria-hidden="true" />
          Copied
        </>
      ) : status === "failed" ? (
        "Copy failed"
      ) : (
        <>
          <Copy size={14} strokeWidth={1.75} aria-hidden="true" />
          Copy
        </>
      )}
    </button>
  );
}

/* --------------------------------------------------------------- directory */

export function DirectoryGrid({
  staff,
  totalCount,
  searchQuery,
  onSearchChange,
  activeDepartment,
  onDepartmentChange,
  counts,
}: DirectoryGridProps) {
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [isEntered, setIsEntered] = useState(false);
  const [copyStatus, setCopyStatus] = useState<Record<string, CopyStatus>>({});

  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Alphabetical sections by family name. */
  const sections = useMemo(() => {
    const sorted = [...staff].sort((a, b) =>
      familyName(a.full_name).localeCompare(familyName(b.full_name), "en-US"),
    );
    const grouped = new Map<string, StaffMember[]>();
    for (const member of sorted) {
      const letter = familyName(member.full_name).charAt(0).toUpperCase() || "#";
      const bucket = grouped.get(letter);
      if (bucket) bucket.push(member);
      else grouped.set(letter, [member]);
    }
    return [...grouped.entries()];
  }, [staff]);

  // Slide-in: mount at translate-x-full, flip after paint so the transition runs.
  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => {
      setIsEntered(true);
      closeButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

  const openDrawer = useCallback((member: StaffMember, opener: HTMLElement) => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    openerRef.current = opener;
    setCopyStatus({});
    setSelected(member);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsEntered(false);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setSelected(null);
      setCopyStatus({});
      closeTimer.current = null;
      openerRef.current?.focus();
    }, DRAWER_EXIT_MS);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selected, closeDrawer]);

  // Keep Tab inside the sheet while it is open.
  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const handleCopy = useCallback(async (key: string, value: string) => {
    const ok = await writeToClipboard(value);
    setCopyStatus({ [key]: ok ? "copied" : "failed" });
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus({}), COPY_RESET_MS);
  }, []);

  const extKey = selected ? `${selected.id}:extension` : "";
  const phoneKey = selected ? `${selected.id}:direct_phone` : "";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[60rem] px-4 pb-16 pt-6 sm:px-8 sm:pt-8">
        {/* Title + controls */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[1.6rem] font-semibold leading-tight tracking-[-0.02em] text-zinc-900">
              Staff Directory
            </h2>
            <p className="mt-1 text-[13px] text-zinc-500">
              Extensions, contact details, and shift rotations for every team.
            </p>
          </div>
          <span className="shrink-0 pb-1 text-[12px] font-medium tabular-nums text-zinc-500">
            {staff.length} of {totalCount}
          </span>
        </div>

        <div className="mt-5 space-y-3">
          <SearchField
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search by name, role, extension, or pronouns"
            label="Search personnel"
          />
          <DepartmentChipTrack active={activeDepartment} onChange={onDepartmentChange} counts={counts} />
        </div>

        {/* List */}
        <div className="mt-6">
          {sections.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 py-12 text-center">
              <Users size={16} strokeWidth={1.75} aria-hidden="true" className="text-zinc-400" />
              <p className="text-[13px] font-medium text-zinc-700">No matching personnel</p>
              <p className="text-[12.5px] text-zinc-500">
                Adjust the search or choose a different department.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {sections.map(([letter, members]) => (
                <section key={letter} aria-label={`Surnames starting with ${letter}`}>
                  <h3 className="px-1 pb-1.5 text-[12px] font-semibold text-zinc-500">{letter}</h3>
                  <ul
                    role="list"
                    className="divide-y divide-zinc-200 overflow-hidden rounded-[10px] border border-zinc-300/60 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
                  >
                    {members.map((member) => {
                      const isOpen = selected?.id === member.id;
                      return (
                        <li key={member.id}>
                          <button
                            type="button"
                            onClick={(event) => openDrawer(member, event.currentTarget)}
                            aria-haspopup="dialog"
                            aria-expanded={isOpen}
                            className={cx(
                              "group flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors duration-150 sm:px-5",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/35",
                              isOpen ? "bg-teal-50/60" : "hover:bg-zinc-100/60",
                            )}
                          >
                            <Avatar member={member} />

                            <span className="min-w-0 flex-1">
                              <span className="flex items-baseline gap-2">
                                <span className="truncate text-[14px] font-semibold tracking-[-0.005em] text-zinc-900">
                                  {member.full_name}
                                </span>
                                <span className="hidden shrink-0 text-[12px] text-zinc-500 sm:inline">
                                  {member.pronouns}
                                </span>
                              </span>
                              <span className="mt-0.5 block truncate text-[12.5px] text-zinc-600">
                                {member.title}
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-zinc-500">
                                Goes by {member.preferred_name}
                                <span className="sm:hidden">
                                  <span className="mx-1.5 text-zinc-300">/</span>
                                  {member.pronouns}
                                </span>
                              </span>
                            </span>

                            <span className="hidden shrink-0 flex-col items-end gap-1.5 md:flex">
                              <DepartmentTags departments={member.departments} max={2} />
                              <span className="font-mono text-xs tabular-nums text-zinc-500">
                                ext {member.phone_extension}
                              </span>
                            </span>

                            <ChevronRight
                              size={14}
                              strokeWidth={1.75}
                              aria-hidden="true"
                              className="shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500"
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Slide-over sheet */}
      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close personnel details"
            onClick={closeDrawer}
            className={cx(
              "absolute inset-0 cursor-default bg-zinc-900/15 backdrop-blur-[3px] transition-opacity duration-200",
              isEntered ? "opacity-100" : "opacity-0",
            )}
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="directory-sheet-title"
            onKeyDown={handlePanelKeyDown}
            className={cx(
              "relative flex h-full w-full max-w-[420px] flex-col border-l border-zinc-300/70 bg-[#F7F7F8] shadow-[-24px_0_64px_-24px_rgba(24,24,27,0.28)]",
              "transition-transform duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
              isEntered ? "translate-x-0" : "translate-x-full",
            )}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200/80 bg-white/80 px-4 backdrop-blur-md">
              <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                Personnel
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-colors duration-150 hover:bg-zinc-200 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
              {/* Identity */}
              <div className="flex flex-col items-center pt-7 text-center">
                <Avatar member={selected} size="lg" />
                <h3
                  id="directory-sheet-title"
                  className="mt-4 text-[1.35rem] font-semibold leading-tight tracking-[-0.02em] text-zinc-900"
                >
                  {selected.full_name}
                </h3>
                <p className="mt-1 text-[13px] text-zinc-500">
                  Goes by {selected.preferred_name}
                  <span className="mx-1.5 text-zinc-300">/</span>
                  {selected.pronouns}
                </p>
                <p className="mt-1 text-[13.5px] font-medium text-zinc-700">{selected.title}</p>
              </div>

              {/* Quick actions */}
              <div className="mt-6 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopy(extKey, selected.phone_extension)}
                  aria-label={`Copy extension ${selected.phone_extension}`}
                  className="flex flex-col items-center gap-1 rounded-[10px] border border-zinc-300/60 bg-white px-2 py-2.5 text-[12px] font-medium text-[#0F766E] transition-colors duration-150 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                >
                  <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
                  Copy extension
                </button>
                <a
                  href={`mailto:${selected.email}`}
                  className="flex flex-col items-center gap-1 rounded-[10px] border border-zinc-300/60 bg-white px-2 py-2.5 text-[12px] font-medium text-[#0F766E] transition-colors duration-150 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                >
                  <Mail size={16} strokeWidth={1.75} aria-hidden="true" />
                  Email
                </a>
                <a
                  href={`tel:${selected.direct_phone.replace(/[^\d+]/g, "")}`}
                  className="flex flex-col items-center gap-1 rounded-[10px] border border-zinc-300/60 bg-white px-2 py-2.5 text-[12px] font-medium text-[#0F766E] transition-colors duration-150 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                >
                  <Phone size={16} strokeWidth={1.75} aria-hidden="true" />
                  Call
                </a>
              </div>

              {/* Contact */}
              <div className="mt-7">
                <GroupLabel>Contact</GroupLabel>
                <Group>
                  <GroupRow label="Extension">
                    <span className="flex items-center justify-end gap-2.5">
                      <span className="font-mono text-[13px] font-medium tabular-nums">
                        {selected.phone_extension}
                      </span>
                      <CopyButton
                        status={copyStatus[extKey]}
                        onCopy={() => void handleCopy(extKey, selected.phone_extension)}
                        label={`Copy extension ${selected.phone_extension}`}
                      />
                    </span>
                  </GroupRow>
                  <GroupRow label="Direct line">
                    <span className="flex items-center justify-end gap-2.5">
                      <a
                        href={`tel:${selected.direct_phone.replace(/[^\d+]/g, "")}`}
                        className="tabular-nums text-[#0F766E] hover:underline"
                      >
                        {selected.direct_phone}
                      </a>
                      <CopyButton
                        status={copyStatus[phoneKey]}
                        onCopy={() => void handleCopy(phoneKey, selected.direct_phone)}
                        label={`Copy direct line ${selected.direct_phone}`}
                      />
                    </span>
                  </GroupRow>
                  <GroupRow label="Email">
                    <a
                      href={`mailto:${selected.email}`}
                      className="block truncate text-[#0F766E] hover:underline"
                      title={selected.email}
                    >
                      {selected.email}
                    </a>
                  </GroupRow>
                </Group>
              </div>

              {/* Departments */}
              <div className="mt-6">
                <GroupLabel>Assigned departments</GroupLabel>
                <div className="rounded-[10px] border border-zinc-300/60 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
                  <DepartmentTags departments={selected.departments} />
                </div>
              </div>

              {/* Rotations */}
              <div className="mt-6">
                <GroupLabel>Shift rotations</GroupLabel>
                <Group>
                  {selected.shift_rotations.map((rotation) => {
                    const ShiftIcon = SHIFT_ICONS[rotation.label];
                    return (
                      <div
                        key={`${rotation.label}-${rotation.days}-${rotation.hours}`}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-teal-700"
                        >
                          <ShiftIcon size={14} strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-zinc-900">
                            {rotation.label}
                          </span>
                          <span className="block text-[12px] text-zinc-500">{rotation.days}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[12px] tabular-nums text-zinc-700">
                          {rotation.hours}
                        </span>
                      </div>
                    );
                  })}
                </Group>
              </div>

              {/* Record */}
              <div className="mt-6">
                <GroupLabel>Record</GroupLabel>
                <Group>
                  <GroupRow label="System ID">
                    <span className="font-mono text-[12.5px] tabular-nums">{selected.system_id}</span>
                  </GroupRow>
                  <GroupRow label="Preferred shift">{selected.shift_preference}</GroupRow>
                </Group>
              </div>

              <p className="mt-6 text-xs leading-5 text-zinc-500">
                Profile edits and photo uploads arrive with the Supabase auth phase. Contact the
                Practice Administrator to correct a record.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DirectoryGrid;
