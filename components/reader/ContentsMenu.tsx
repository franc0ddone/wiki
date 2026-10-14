"use client";

import { useId, useState } from "react";
import { ChevronDown, ListTree } from "lucide-react";
import type { TocEntry } from "@/lib/markdown/parser";
import { cx } from "@/lib/utils";

/**
 * Narrow-viewport table of contents (prompt 7a, item 6 — "taste call D").
 *
 * Below `xl` the sticky right rail is gone, so instead of spilling a wall of
 * jump links into the top of the paper the outline collapses behind a single
 * "Contents" disclosure. At `xl` and up the rail takes over and this hides.
 */
export function ContentsMenu({
  toc,
  activeId,
  onJump,
}: {
  toc: readonly TocEntry[];
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="mb-8 rounded-xl border border-zinc-200/80 bg-zinc-50/70 print:hidden xl:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-[12.5px] font-semibold text-zinc-700 transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5F6E00]/35"
      >
        <ListTree size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[#5F6E00]" />
        Contents
        <ChevronDown
          size={15}
          strokeWidth={2}
          aria-hidden="true"
          className={cx(
            "ml-auto shrink-0 text-zinc-400 transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <ul id={panelId} className="border-t border-zinc-200 px-2 py-2">
          {toc.map((entry) => {
            const isActive = entry.id === activeId;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    onJump(entry.id);
                    setOpen(false);
                  }}
                  aria-current={isActive ? "location" : undefined}
                  className={cx(
                    "block w-full rounded-md py-1.5 pr-2 text-left text-[12.5px] leading-5 transition-colors",
                    entry.level === 3 ? "pl-6" : "pl-2.5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5F6E00]/35",
                    isActive
                      ? "bg-[#E6EBA5]/40 font-semibold text-[#5F6E00]"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  )}
                >
                  {entry.text}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
