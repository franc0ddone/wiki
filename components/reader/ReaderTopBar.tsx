"use client";

import { useEffect, useRef, useState } from "react";
import {
  ALargeSmall,
  Check,
  Copy,
  Printer,
  Search,
} from "lucide-react";
import { ReadingProgressBar } from "@/components/reader/ReadingProgressBar";
import { READER_FONT_LABEL, type ReaderFontSize } from "@/lib/reader/font-scale";
import { useSearchShortcutLabel } from "@/lib/platform";
import { cx, writeToClipboard } from "@/lib/utils";

/**
 * The reader's top bar (prompt 7a, item 6 — a HARD RULE).
 *
 * One non-wrapping flex row, at every width down to 360px:
 *
 *   breadcrumbs (flex-1, min-width: 0, truncating with an ellipsis)
 *   + search pill (nowrap; drops its text label below 900px)
 *   + three fixed-size icon actions that never shrink.
 *
 * The three actions are the font-size toggle (item 5), Copy as Markdown, and
 * Print. Copy writes the article's canonical Markdown to the clipboard; Print
 * invokes `window.print()` and is itself no-print (the whole bar is).
 *
 * A thin reading-progress bar (item 3) rides immediately above the row.
 */
export function ReaderTopBar({
  breadcrumbs,
  onSearch,
  searchLabel = "Search SOPs",
  markdown,
  fontSize,
  onToggleFontSize,
}: {
  /** Trail, e.g. `["Knowledge base", "Emergency", "Sepsis Recognition"]`. */
  breadcrumbs: readonly string[];
  /** Opens the command palette. Omitted → no search pill. */
  onSearch?: () => void;
  searchLabel?: string;
  /** The article's canonical Markdown, for Copy as Markdown. */
  markdown: string;
  fontSize: ReaderFontSize;
  onToggleFontSize: () => void;
}) {
  const shortcut = useSearchShortcutLabel();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    const ok = await writeToClipboard(markdown);
    if (!ok) return;
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1600);
  };

  const iconButton =
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-300/60 bg-white text-zinc-600 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35";

  return (
    <div className="sticky top-0 z-20 shrink-0 print:hidden">
      <ReadingProgressBar />

      <div className="flex flex-nowrap items-center gap-3 border-b border-zinc-200/80 bg-white/85 px-4 py-2.5 backdrop-blur-md supports-[backdrop-filter]:bg-white/75 sm:px-6 md:px-8">
        {/* Breadcrumbs — one truncated line, never a stacked mess.
            A <span>, not a <p>: the global `p { text-wrap: pretty }` rule in
            globals.css is unlayered and would otherwise beat `.truncate`'s
            layered `white-space: nowrap`, wrapping the crumbs. */}
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1 overflow-hidden">
          <span className="block truncate whitespace-nowrap text-[13px] leading-5 text-zinc-500">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb}-${index}`}>
                {index > 0 ? (
                  <span aria-hidden="true" className="px-1.5 text-zinc-300">
                    ·
                  </span>
                ) : null}
                {index === breadcrumbs.length - 1 ? (
                  <b className="font-semibold text-zinc-700">{crumb}</b>
                ) : (
                  <span>{crumb}</span>
                )}
              </span>
            ))}
          </span>
        </nav>

        {/* Search pill — nowrap; label drops below 900px, icon + kbd stay */}
        {onSearch ? (
          <button
            type="button"
            onClick={onSearch}
            aria-label={`${searchLabel} (${shortcut})`}
            aria-keyshortcuts="Control+K Meta+K"
            className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-zinc-300/60 bg-white px-3 text-[12.5px] text-zinc-500 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-zinc-400 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/40"
          >
            <Search size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-zinc-400" />
            <span className="hidden min-[900px]:inline">{searchLabel}</span>
            <kbd
              aria-hidden="true"
              className="flex h-[18px] shrink-0 items-center rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[10.5px] font-medium tracking-wide text-zinc-500"
            >
              {shortcut}
            </kbd>
          </button>
        ) : null}

        {/* Icon actions — fixed size, never shrink */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleFontSize}
            aria-label={
              fontSize === "large" ? "Use comfortable text size" : "Use large text size"
            }
            title={`Text size: ${READER_FONT_LABEL[fontSize]}`}
            className={cx(
              iconButton,
              fontSize === "large" && "border-[#5F6E00]/40 bg-[#E6EBA5]/40 text-[#5F6E00]",
            )}
          >
            <ALargeSmall size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy as Markdown"}
            title="Copy as Markdown"
            className={cx(iconButton, copied && "border-[#5F6E00]/40 text-[#5F6E00]")}
          >
            {copied ? (
              <Check size={15} strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <Copy size={15} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            aria-label="Print"
            title="Print"
            className={iconButton}
          >
            <Printer size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
