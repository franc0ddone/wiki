"use client";

import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Small modal shell shared by the editor's dialogs: `role="dialog"` +
 * `aria-modal`, focus moved in on open and restored on close, Tab trapped,
 * `Esc` closes (and does not leak to anything underneath).
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  widthClass = "max-w-lg",
  dismissible = true,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
  /** False while an upload / save is in flight. */
  dismissible?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button:not([data-modal-close])");
    first?.focus();
    return () => {
      openerRef.current?.focus?.();
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.nativeEvent.stopPropagation();
      if (dismissible) onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ),
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={handleKeyDown}
        className={`w-full ${widthClass} animate-palette-in rounded-xl border border-zinc-200 bg-white shadow-[0_24px_64px_-16px_rgba(24,24,27,0.35)]`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold text-zinc-900">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-[12.5px] leading-5 text-zinc-500">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close dialog"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 disabled:opacity-40"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export const primaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#0F766E] px-4 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors hover:bg-[#0c635c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300/70 bg-white px-4 text-[13.5px] font-medium text-zinc-800 shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 disabled:cursor-not-allowed disabled:opacity-50";

export const fieldClass =
  "h-9 w-full rounded-lg border border-zinc-300/70 bg-white px-3 text-[13.5px] text-zinc-900 shadow-[0_1px_2px_rgba(16,24,40,0.04)] placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15";
