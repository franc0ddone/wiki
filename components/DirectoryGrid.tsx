"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Copy, Mail, Phone, X } from "lucide-react";
import {
  DEPARTMENT_LABELS,
  type ClinicalDepartment,
  type Department,
  type DepartmentCounts,
  type StaffMember,
} from "@/types/portal";
import { cx, initials, writeToClipboard } from "@/lib/utils";
import { ViewToolbar } from "@/components/ViewToolbar";

/**
 * Personnel directory: a vertical list of staff rows that open a right-hand
 * slide-over with the full record. Search and department filtering live above
 * the list and are driven by the page so all three surfaces filter alike.
 */

export interface DirectoryGridProps {
  staff: readonly StaffMember[];
  searchQuery: string;
  onSearchChange: (value: string) => void;
  activeDepartment: Department;
  onDepartmentChange: (department: Department) => void;
  counts: DepartmentCounts;
}

function Monogram({ member, size = "md" }: { member: StaffMember; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 text-base" : "h-11 w-11 text-[13px]";

  if (member.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars become Supabase Storage URLs later; plain img avoids remotePatterns config in this phase.
      <img
        src={member.avatar_url}
        alt=""
        className={cx("shrink-0 rounded-md object-cover", size === "lg" ? "h-14 w-14" : "h-11 w-11")}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center rounded-md border border-[#005953]/50 bg-gradient-to-br from-[#005953]/45 to-[#081f1e] font-semibold tracking-wide text-[#5CBEB4]",
        box,
      )}
    >
      {initials(member.full_name)}
    </span>
  );
}

function DepartmentBadges({
  departments,
  max,
}: {
  departments: readonly ClinicalDepartment[];
  max?: number;
}) {
  const shown = max ? departments.slice(0, max) : departments;
  const overflow = max ? departments.length - shown.length : 0;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {shown.map((department) => (
        <span
          key={department}
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium tracking-tight text-zinc-400"
        >
          {DEPARTMENT_LABELS[department]}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="text-[10px] text-zinc-600">+{overflow}</span>
      ) : null}
    </span>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-800/70 px-5 py-3 last:border-b-0">
      <span className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">{label}</span>
      <span className="min-w-0 text-right text-[13px] text-zinc-200">{children}</span>
    </div>
  );
}

export function DirectoryGrid({
  staff,
  searchQuery,
  onSearchChange,
  activeDepartment,
  onDepartmentChange,
  counts,
}: DirectoryGridProps) {
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [isEntered, setIsEntered] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Slide-in: mount at translate-x-full, then flip after paint so it animates.
  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => setIsEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    closeButtonRef.current?.focus();
  }, [selected]);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

  const closeDrawer = useCallback(() => {
    setIsEntered(false);
    setCopyState("idle");
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setSelected(null), 240);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selected, closeDrawer]);

  const handleCopy = useCallback(async (value: string) => {
    const ok = await writeToClipboard(value);
    setCopyState(ok ? "copied" : "failed");
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("idle"), 1800);
  }, []);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] px-5 pb-16 pt-6 sm:px-8">
        <ViewToolbar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          searchPlaceholder="Search by name, role, extension, or department…"
          searchLabel="Search personnel"
          activeDepartment={activeDepartment}
          onDepartmentChange={onDepartmentChange}
          counts={counts}
          className="mb-6"
        />

        <div className="mb-3 flex items-baseline justify-between gap-4 border-b border-zinc-800 pb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Personnel
          </h2>
          <span className="text-[11px] tabular-nums text-zinc-600">
            {staff.length} {staff.length === 1 ? "record" : "records"}
          </span>
        </div>

        {staff.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
            No personnel match the current search and department filter.
          </p>
        ) : (
          <ul role="list" className="overflow-hidden rounded-lg border border-zinc-800">
            {staff.map((member) => (
              <li key={member.id} className="border-b border-zinc-800 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSelected(member)}
                  className={cx(
                    "flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors sm:px-5",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5CBEB4]",
                    "hover:bg-zinc-900/70",
                    selected?.id === member.id && "bg-[#005953]/12",
                  )}
                >
                  <Monogram member={member} />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-zinc-100">
                      {member.full_name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-zinc-500">
                      Goes by {member.preferred_name}
                      <span className="mx-1.5 text-zinc-700">·</span>
                      {member.pronouns}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="truncate text-[12px] text-zinc-400">{member.title}</span>
                      <DepartmentBadges departments={member.departments} />
                    </span>
                  </span>

                  <span className="hidden shrink-0 flex-col items-end gap-1 md:flex">
                    <span className="font-mono text-[12px] tabular-nums text-zinc-400">
                      ext {member.phone_extension}
                    </span>
                    <span className="text-[11px] text-zinc-600">{member.shift_preference}</span>
                  </span>

                  <ChevronRight
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="shrink-0 text-zinc-600"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Slide-over */}
      {selected ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close personnel details"
            onClick={closeDrawer}
            className={cx(
              "absolute inset-0 cursor-default bg-black/70 transition-opacity duration-200",
              isEntered ? "opacity-100" : "opacity-0",
            )}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="directory-drawer-title"
            className={cx(
              "relative flex h-full w-full max-w-[26rem] flex-col border-l border-zinc-800 bg-zinc-950 transition-transform duration-200 ease-out",
              isEntered ? "translate-x-0" : "translate-x-full",
            )}
          >
            <div className="flex items-start gap-4 border-b border-zinc-800 px-5 py-5">
              <Monogram member={selected} size="lg" />
              <div className="min-w-0 flex-1">
                <h3
                  id="directory-drawer-title"
                  className="truncate text-[15px] font-semibold tracking-tight text-zinc-50"
                >
                  {selected.full_name}
                </h3>
                <p className="mt-0.5 text-[11.5px] text-zinc-500">
                  Goes by {selected.preferred_name}
                  <span className="mx-1.5 text-zinc-700">·</span>
                  {selected.pronouns}
                </p>
                <p className="mt-1 text-[12.5px] text-zinc-400">{selected.title}</p>
                <span className="mt-2.5 block">
                  <DepartmentBadges departments={selected.departments} />
                </span>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close"
                className="shrink-0 rounded-md border border-zinc-800 p-1.5 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5CBEB4]"
              >
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="px-5 pb-2 pt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Contact
              </p>
              <div className="border-y border-zinc-800">
                <DetailRow label="Extension">
                  <span className="flex items-center justify-end gap-2.5">
                    <span className="font-mono tabular-nums text-zinc-100">
                      {selected.phone_extension}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy(selected.phone_extension)}
                      aria-label={`Copy extension ${selected.phone_extension}`}
                      className={cx(
                        "flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5CBEB4]",
                        copyState === "copied"
                          ? "border-[#5CBEB4]/50 bg-[#005953]/25 text-[#5CBEB4]"
                          : copyState === "failed"
                            ? "border-red-900 bg-red-950/40 text-red-400"
                            : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
                      )}
                    >
                      {copyState === "copied" ? (
                        <>
                          <Check size={12} strokeWidth={2.25} aria-hidden="true" />
                          Copied
                        </>
                      ) : copyState === "failed" ? (
                        "Failed"
                      ) : (
                        <>
                          <Copy size={12} strokeWidth={1.75} aria-hidden="true" />
                          Copy
                        </>
                      )}
                    </button>
                  </span>
                </DetailRow>

                <DetailRow label="Direct line">
                  <a
                    href={`tel:${selected.direct_phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-2 tabular-nums text-zinc-200 transition-colors hover:text-[#5CBEB4]"
                  >
                    <Phone size={12} strokeWidth={1.75} aria-hidden="true" className="text-zinc-600" />
                    {selected.direct_phone}
                  </a>
                </DetailRow>

                <DetailRow label="Email">
                  <a
                    href={`mailto:${selected.email}`}
                    className="inline-flex items-center gap-2 break-all text-zinc-200 transition-colors hover:text-[#5CBEB4]"
                  >
                    <Mail size={12} strokeWidth={1.75} aria-hidden="true" className="text-zinc-600" />
                    {selected.email}
                  </a>
                </DetailRow>
              </div>

              <p className="px-5 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Shift rotations
              </p>
              <ul className="border-y border-zinc-800">
                {selected.shift_rotations.map((rotation) => (
                  <li
                    key={`${rotation.label}-${rotation.days}`}
                    className="flex items-center justify-between gap-4 border-b border-zinc-800/70 px-5 py-3 last:border-b-0"
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full bg-[#5CBEB4]/70"
                      />
                      <span className="text-[13px] text-zinc-200">{rotation.label}</span>
                    </span>
                    <span className="text-right text-[12px] tabular-nums text-zinc-400">
                      {rotation.days}
                      <span className="mx-1.5 text-zinc-700">·</span>
                      {rotation.hours}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="px-5 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Record
              </p>
              <div className="border-y border-zinc-800">
                <DetailRow label="System ID">
                  <span className="font-mono tabular-nums text-zinc-100">{selected.system_id}</span>
                </DetailRow>
                <DetailRow label="Preferred shift">
                  <span className="text-zinc-200">{selected.shift_preference}</span>
                </DetailRow>
                <DetailRow label="Departments">
                  <DepartmentBadges departments={selected.departments} />
                </DetailRow>
              </div>

              <p className="px-5 py-6 text-[11px] leading-5 text-zinc-600">
                Profile edits and avatar uploads land with the Supabase auth phase. Contact the
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