"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { ArticlePreview } from "@/lib/reader/preview";
import { cx } from "@/lib/utils";

/**
 * An internal SOP link with a hover/focus preview card (prompt 7a, item 4).
 *
 * The preview is a compact summary — title, status, a plain excerpt, and the
 * department tags — positioned under the link. It is phrasing-content only
 * (`<span>`s) because it lives inside a paragraph, and it never appears in print.
 *
 * The card is announced to assistive tech via `aria-describedby` while open, and
 * shows on keyboard focus as well as pointer hover.
 */

const STATUS_STYLE: Record<ArticlePreview["status"], { label: string; className: string }> = {
  published: { label: "Published", className: "border-zinc-200 bg-zinc-50 text-zinc-600" },
  draft: { label: "Draft", className: "border-amber-200 bg-amber-50 text-amber-800" },
};

export function InternalSopLink({
  href,
  preview,
  onClick,
  rel,
  className,
  children,
}: {
  href: string;
  preview: ArticlePreview | null;
  onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  rel?: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardId = useId();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const scheduleOpen = () => {
    cancel();
    timer.current = setTimeout(() => setOpen(true), 160);
  };
  const close = () => {
    cancel();
    setOpen(false);
  };

  const show = open && preview !== null;

  return (
    <span className="relative inline">
      <a
        href={href}
        onClick={onClick}
        rel={rel}
        className={className}
        aria-describedby={show ? cardId : undefined}
        onMouseEnter={preview ? scheduleOpen : undefined}
        onMouseLeave={preview ? close : undefined}
        onFocus={preview ? () => setOpen(true) : undefined}
        onBlur={preview ? close : undefined}
      >
        {children}
      </a>

      {show ? (
        <span
          id={cardId}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1.5 block w-72 max-w-[min(20rem,80vw)] rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-[0_12px_40px_-12px_rgba(24,24,27,0.28),0_2px_6px_rgba(24,24,27,0.06)] print:hidden"
        >
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-zinc-900">
              {preview.title}
            </span>
            <span
              className={cx(
                "shrink-0 whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] font-semibold",
                STATUS_STYLE[preview.status].className,
              )}
            >
              {STATUS_STYLE[preview.status].label}
            </span>
          </span>
          {preview.departments.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {preview.departments.map((department) => (
                <span
                  key={department}
                  className="whitespace-nowrap rounded-full border border-[#5F6E00]/30 bg-[#E6EBA5]/40 px-1.5 py-px text-[11px] font-medium text-[#5F6E00]"
                >
                  {department}
                </span>
              ))}
            </span>
          ) : null}
          {preview.excerpt.length > 0 ? (
            <span className="mt-2 block text-[12.5px] leading-5 text-zinc-500">
              {preview.excerpt}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
