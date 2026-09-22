"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { BookText, Check, ChevronDown, Megaphone, Users } from "lucide-react";
import type { PortalView } from "@/types/portal";
import { cx } from "@/lib/utils";

/**
 * Minimal institutional header: identity on the left, a single view switcher on
 * the right. No tab bar — the active surface is chosen from the dropdown, and
 * the current view is echoed beside the trigger so it is legible at a glance.
 */

export interface PortalHeaderProps {
  activeView: PortalView;
  onViewChange: (view: PortalView) => void;
  /** Institutional name shown as the primary title. */
  title?: string;
  /** Facility subtext under the title. */
  facilityName?: string;
}

interface ViewOption {
  id: PortalView;
  label: string;
  description: string;
  icon: typeof BookText;
}

const VIEW_OPTIONS: readonly ViewOption[] = [
  {
    id: "bulletins",
    label: "Bulletin Board",
    description: "Shift notices and service changes",
    icon: Megaphone,
  },
  {
    id: "knowledge",
    label: "Knowledge Base",
    description: "Standard operating procedures",
    icon: BookText,
  },
  {
    id: "directory",
    label: "Staff Directory",
    description: "Personnel and contact details",
    icon: Users,
  },
];

export function PortalHeader({
  activeView,
  onViewChange,
  title = "Operations Hub",
  facilityName = "Eastside Emergency Animal Hospital",
}: PortalHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const activeOption = VIEW_OPTIONS.find((option) => option.id === activeView) ?? VIEW_OPTIONS[0];
  const ActiveIcon = activeOption.icon;

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Dismiss on outside click and on Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, close]);

  return (
    <header className="relative z-30 shrink-0 border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-6 px-5 py-4 sm:px-8">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border border-[#5CBEB4]/50">
              <span className="h-1 w-1 rounded-full bg-[#5CBEB4]" />
            </span>
          </span>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-zinc-50">
              {title}
            </h1>
            <p className="truncate text-xs text-zinc-500">{facilityName}</p>
          </div>
        </div>

        {/* View switcher */}
        <div className="relative shrink-0" ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-controls={isOpen ? menuId : undefined}
            className={cx(
              "flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5CBEB4]",
              isOpen
                ? "border-[#5CBEB4]/40 bg-zinc-900"
                : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-900",
            )}
          >
            <ActiveIcon size={14} strokeWidth={1.75} aria-hidden="true" className="text-[#5CBEB4]" />
            <span className="hidden text-[13px] font-medium text-zinc-100 sm:inline">
              {activeOption.label}
            </span>
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className={cx(
                "text-zinc-500 transition-transform duration-200",
                isOpen && "rotate-180",
              )}
            />
          </button>

          {isOpen ? (
            <div
              id={menuId}
              role="menu"
              aria-label="Switch view"
              className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.9)]"
            >
              {VIEW_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = option.id === activeView;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => {
                      onViewChange(option.id);
                      close(true);
                    }}
                    className={cx(
                      "flex w-full items-start gap-3 border-b border-zinc-800/70 px-3.5 py-3 text-left transition-colors last:border-b-0",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5CBEB4]",
                      isActive ? "bg-[#005953]/20" : "hover:bg-zinc-800/60",
                    )}
                  >
                    <Icon
                      size={14}
                      strokeWidth={1.75}
                      aria-hidden="true"
                      className={cx("mt-0.5 shrink-0", isActive ? "text-[#5CBEB4]" : "text-zinc-500")}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cx(
                          "block text-[13px] font-medium",
                          isActive ? "text-[#5CBEB4]" : "text-zinc-200",
                        )}
                      >
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-zinc-500">
                        {option.description}
                      </span>
                    </span>
                    {isActive ? (
                      <Check
                        size={14}
                        strokeWidth={2}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-[#5CBEB4]"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default PortalHeader;