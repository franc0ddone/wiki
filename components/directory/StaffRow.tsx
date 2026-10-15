"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import {
  DEPARTMENT_LABELS,
  type ClinicalDepartment,
  type StaffMember,
} from "@/types/portal";
import { cx, initials, writeToClipboard } from "@/lib/utils";

/**
 * One person in the staff directory: the dense phonebook row, and — when it is
 * the expanded row — the detail panel that opens *inside* it.
 *
 * Dense is the whole point. A row is a single 52 px line at `py-2.5 px-4`: a
 * 36 px headshot, the name with a live presence dot, role and department in
 * muted secondary text, and — visible without clicking anything — the extension
 * in tabular figures and a chevron saying there is more. Someone hunting an
 * extension at 2 AM reads it off the row and never opens the panel.
 *
 * The panel is an accordion, not a modal and not a side pane: it renders in
 * place, inside the same card, so the directory never leaves the screen. Only
 * one row is expanded at a time — the surface owns that state.
 */

const COPY_RESET_MS = 1800;

const AVATAR_SIZES = {
  sm: "h-9 w-9 text-[12px]",
  lg: "h-[88px] w-[88px] text-[26px]",
} as const;

/**
 * Headshot, or the dove-tinted monogram that stands in for one.
 *
 * `avatarUrl` is empty for every record in the database today (no headshot
 * assets ship in `public/`), so the fallback is the default state rather than an
 * edge case: a Dove Green field at 20% with Dove Black initials, sized by the
 * slot it fills.
 */
export function StaffAvatar({
  member,
  size = "sm",
  shape = "circle",
}: {
  member: StaffMember;
  size?: keyof typeof AVATAR_SIZES;
  shape?: "circle" | "square";
}) {
  const radius = shape === "circle" ? "rounded-full" : "rounded-xl";

  if (member.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- headshots become storage URLs in a later phase; a plain img avoids remotePatterns config today.
      <img
        src={member.avatar_url}
        alt=""
        width={size === "lg" ? 88 : 36}
        height={size === "lg" ? 88 : 36}
        className={cx(
          "shrink-0 object-cover ring-1 ring-black/5",
          radius,
          AVATAR_SIZES[size],
          size === "lg" && "border border-neutral-200",
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 select-none items-center justify-center font-semibold tracking-[0.02em] text-[#20241E]",
        "bg-[#AFBE23]/20 ring-1 ring-inset ring-[#5F6E00]/20",
        radius,
        AVATAR_SIZES[size],
      )}
    >
      {initials(member.full_name)}
    </span>
  );
}

/** The live presence dot: Dove Green on a Dove Green halo. Never an emoji. */
function PresenceDot({ className }: { className?: string }) {
  return (
    <span
      title="Here today"
      className={cx(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[#5F6E00] ring-2 ring-[#AFBE23]/45",
        className,
      )}
    >
      <span className="sr-only">Here today</span>
    </span>
  );
}

/** The quiet "Here" badge the HERE TODAY section adds to a present row. */
function HereBadge() {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full border border-[#5F6E00]/40 bg-[#AFBE23]/15 px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#3F4A00]">
      Here
    </span>
  );
}

/** A department, as a quiet outlined pill in the locked palette. */
function DepartmentPill({ department }: { department: ClinicalDepartment }) {
  return (
    <span className="whitespace-nowrap rounded-full border border-[#5F6E00]/40 bg-white px-2 py-px text-[11.5px] font-medium text-[#3F4A00]">
      {DEPARTMENT_LABELS[department]}
    </span>
  );
}

function CopyButton({
  status,
  onCopy,
  label,
}: {
  status: "copied" | "failed" | undefined;
  onCopy: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label}
      className={cx(
        "flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11.5px] font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45",
        status === "copied"
          ? "border-[#5F6E00]/40 bg-[#AFBE23]/20 text-[#3F4A00]"
          : status === "failed"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-neutral-200 bg-white text-zinc-500 hover:border-neutral-300 hover:text-zinc-900",
      )}
    >
      {status === "copied" ? (
        <>
          <Check size={12} strokeWidth={2.25} aria-hidden="true" />
          Copied
        </>
      ) : status === "failed" ? (
        "Copy failed"
      ) : (
        <>
          <Copy size={12} strokeWidth={1.75} aria-hidden="true" />
          Copy
        </>
      )}
    </button>
  );
}

export interface StaffRowProps {
  member: StaffMember;
  /** Marked present today. */
  present: boolean;
  /** Render the "Here" badge as well as the dot (the HERE TODAY section). */
  withHereBadge?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Stable id for the expanded panel, so the row can point `aria-controls` at it. */
  panelId: string;
}

export function StaffRow({
  member,
  present,
  withHereBadge = false,
  expanded,
  onToggle,
  panelId,
}: StaffRowProps) {
  const [copyStatus, setCopyStatus] = useState<Record<string, "copied" | "failed">>({});

  const contact = useMemo(
    () => [
      {
        key: "extension",
        label: "Extension",
        value: member.phone_extension,
        display: `Ext. ${member.phone_extension}`,
        href: null as string | null,
      },
      {
        key: "direct",
        label: "Direct line",
        value: member.direct_phone,
        display: member.direct_phone,
        href: `tel:${member.direct_phone.replace(/[^\d+]/g, "")}`,
      },
      {
        key: "email",
        label: "Email",
        value: member.email,
        display: member.email,
        href: `mailto:${member.email}`,
      },
    ],
    [member],
  );

  const handleCopy = async (key: string, value: string) => {
    const ok = await writeToClipboard(value);
    setCopyStatus((current) => ({ ...current, [key]: ok ? "copied" : "failed" }));
    setTimeout(() => {
      setCopyStatus((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }, COPY_RESET_MS);
  };

  const departmentLine = member.departments.map((department) => DEPARTMENT_LABELS[department]);

  /**
   * The record's secondary facts, on one quiet line: preferred name, pronouns,
   * preferred shift, the internal id, and every rotation the record carries. One
   * wrapped line rather than a stack of labelled groups — this is a 2 AM lookup,
   * and the panel's job is to answer without growing into a profile page.
   */
  const meta = [
    `Goes by ${member.preferred_name}`,
    member.pronouns,
    `Preferred shift ${member.shift_preference}`,
    member.system_id,
    ...member.shift_rotations.map(
      (rotation) => `${rotation.label}: ${rotation.days} ${rotation.hours}`,
    ),
  ];

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cx(
          "group relative flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5F6E00]/45",
          expanded ? "bg-[#F7F7F5]/80" : "hover:bg-[#F7F7F5]/80",
        )}
      >
        {/*
         * The open row's accent rule — the board's selection language (a 3px rail
         * on the active row), in the locked dove green rather than the legacy
         * retired accent, so the directory marks "this one is open" the way the product
         * marks "this one is selected".
         */}
        <span
          aria-hidden="true"
          className={cx(
            "absolute inset-y-0 left-0 w-[3px] bg-[#5F6E00] transition-opacity duration-150",
            expanded ? "opacity-100" : "opacity-0",
          )}
        />
        <span className="flex min-w-0 items-center gap-3">
          <StaffAvatar member={member} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold leading-5 tracking-[-0.005em] text-[#20241E]">
                {member.full_name}
              </span>
              {present ? <PresenceDot /> : null}
              {present && withHereBadge ? <HereBadge /> : null}
            </span>
            <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-zinc-500">
              {[member.title, ...departmentLine].join(" · ")}
            </span>
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2.5">
          {/*
           * A fixed, right-aligned slot: the extension is the one thing anyone
           * reads straight off the row, so it sits in a column of its own rather
           * than wherever the name happens to end. Tabular figures keep the
           * digits themselves aligned.
           */}
          <span className="w-[4.75rem] whitespace-nowrap text-right text-[12.5px] font-medium tabular-nums text-zinc-500 transition-colors duration-150 group-hover:text-zinc-700">
            Ext. {member.phone_extension}
          </span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className={cx(
              "shrink-0 text-zinc-300 transition-transform duration-200 group-hover:text-zinc-500",
              expanded && "rotate-180 text-zinc-500",
            )}
          />
        </span>
      </button>

      {expanded ? (
        <div id={panelId} className="border-t border-neutral-200/60 bg-[#FBFBF9] px-4 py-3.5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <StaffAvatar member={member} size="lg" shape="square" />

            <div className="min-w-0 flex-1">
              <h3 className="dw-display text-[18px] font-bold leading-tight tracking-[-0.01em] text-[#20241E]">
                {member.full_name}
              </h3>
              <p className="mt-0.5 text-[13px] leading-[18px] text-zinc-600">{member.title}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {member.departments.map((department) => (
                  <DepartmentPill key={department} department={department} />
                ))}
                {present ? (
                  <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#5F6E00]/40 bg-[#AFBE23]/15 px-2 py-px text-[11.5px] font-medium text-[#3F4A00]">
                    <PresenceDot />
                    Here today
                  </span>
                ) : (
                  <span className="whitespace-nowrap rounded-full border border-neutral-200 bg-white px-2 py-px text-[11.5px] font-medium text-zinc-500">
                    Not checked in today
                  </span>
                )}
              </div>

              {/*
                * Three columns, the email wider than the two numbers: an address
                * is twice the length of an extension, and a truncated one is
                * exactly what nobody wants to read at 2 AM.
                */}
              <dl className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-[1fr_1fr_1.6fr]">
                {contact.map((entry) => (
                  <div key={entry.key} className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
                      {entry.label}
                    </dt>
                    <dd className="flex min-w-0 items-center gap-1.5">
                      {entry.href ? (
                        <a
                          href={entry.href}
                          className="truncate text-[13px] font-medium tabular-nums text-[#3F4A00] underline-offset-2 hover:underline"
                          title={entry.value}
                        >
                          {entry.display}
                        </a>
                      ) : (
                        <span className="truncate text-[13px] font-medium tabular-nums text-[#20241E]">
                          {entry.display}
                        </span>
                      )}
                      <CopyButton
                        status={copyStatus[entry.key]}
                        onCopy={() => void handleCopy(entry.key, entry.value)}
                        label={`Copy ${entry.label.toLowerCase()} for ${member.full_name}`}
                      />
                    </dd>
                  </div>
                ))}
              </dl>

              <p className="mt-2.5 text-xs leading-[17px] text-zinc-500 [font-variant-numeric:tabular-nums]">
                {meta.join(" \u00b7 ")}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default StaffRow;
