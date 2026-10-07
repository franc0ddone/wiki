"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { BookOpen, Check, ChevronDown, Megaphone, Search, Users } from "lucide-react";
import type { PortalView } from "@/types/portal";
import { useSearchShortcutLabel } from "@/lib/platform";
import { cx } from "@/lib/utils";

/**
 * Single frosted navigation bar.
 *
 * Left: institutional identity with a live presence indicator.
 * Right: a discreet contextual menu that names the current section and opens a
 * floating popover to switch between the three surfaces. There is no tab bar.
 */

export interface PortalHeaderProps {
  activeView: PortalView;
  onViewChange: (view: PortalView) => void;
  /** Opens the command palette (which also owns the global Ctrl/Cmd+K shortcut). */
  onOpenSearch?: () => void;
  /** Product wordmark shown as the primary title. Rendered uppercase. */
  title?: string;
  /** Subtle facility / product subtext under the wordmark. */
  facilityName?: string;
  /** Rendered at the far right of the bar, after the section menu (e.g. the account menu). */
  rightSlot?: ReactNode;
}

interface ViewOption {
  id: PortalView;
  label: string;
  description: string;
  icon: typeof BookOpen;
}

export const VIEW_OPTIONS: readonly ViewOption[] = [
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
    icon: BookOpen,
  },
  {
    id: "directory",
    label: "Staff Directory",
    description: "Personnel, extensions, and rotations",
    icon: Users,
  },
];

export function PortalHeader({
  activeView,
  onViewChange,
  onOpenSearch,
  title = "Dove Wiki",
  facilityName = "Clinical operations · Dove Lewis Emergency Animal Hospital",
  rightSlot,
}: PortalHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shortcutLabel = useSearchShortcutLabel();

  const activeIndex = Math.max(
    0,
    VIEW_OPTIONS.findIndex((option) => option.id === activeView),
  );
  const activeOption = VIEW_OPTIONS[activeIndex] ?? VIEW_OPTIONS[0];
  const ActiveIcon = activeOption.icon;

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // On open, move focus to the checked item so arrow keys start from there.
  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => itemRefs.current[activeIndex]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, activeIndex]);

  // Dismiss on outside pointer and on Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, close]);

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);

    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Tab") {
      setIsOpen(false);
      return;
    }

    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <header className="sticky top-0 z-30 shrink-0 print:hidden border-b border-zinc-200/80 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70">
      <div className="flex h-14 w-full items-center justify-between gap-6 px-4 sm:px-6">
        {/* Identity */}
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-presence absolute inset-0 rounded-full bg-[#0F766E]" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-[#0F766E] ring-2 ring-teal-100" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[13px] font-bold uppercase leading-4 tracking-[0.06em] text-zinc-900">
              {title}
            </h1>
            <p className="truncate text-xs text-zinc-400">{facilityName}</p>
          </div>
        </div>

        {/* Global search */}
        {onOpenSearch ? (
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label={`Search everything (${shortcutLabel})`}
            aria-keyshortcuts="Control+K Meta+K"
            className={cx(
              "ml-auto flex h-8 min-w-0 items-center gap-2 rounded-lg border border-zinc-300/60 bg-white px-2.5 text-[13px] text-zinc-500 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors",
              "hover:border-zinc-400 hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40 focus-visible:ring-offset-1",
              "sm:w-64 md:w-72",
            )}
          >
            <Search size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-zinc-400" />
            <span className="hidden min-w-0 flex-1 truncate text-left sm:inline">Search everything</span>
            <kbd
              aria-hidden="true"
              className="hidden h-[18px] shrink-0 items-center rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[11px] font-medium tracking-wide text-zinc-500 sm:flex"
            >
              {shortcutLabel}
            </kbd>
          </button>
        ) : null}

        {/* Section menu */}
        <div className="relative shrink-0" ref={containerRef}>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            onKeyDown={handleTriggerKeyDown}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-controls={isOpen ? menuId : undefined}
            aria-label={`Current section: ${activeOption.label}. Switch section`}
            className={cx(
              "flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-zinc-800 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40 focus-visible:ring-offset-1",
              isOpen
                ? "bg-zinc-900/[0.06]"
                : "hover:bg-zinc-900/[0.04] active:bg-zinc-900/[0.07]",
            )}
          >
            <ActiveIcon size={14} strokeWidth={1.75} aria-hidden="true" className="text-[#0F766E]" />
            <span className="hidden sm:inline">{activeOption.label}</span>
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className={cx(
                "text-zinc-400 transition-transform duration-200",
                isOpen && "rotate-180",
              )}
            />
          </button>

          {isOpen ? (
            <div
              id={menuId}
              role="menu"
              aria-label="Switch section"
              onKeyDown={handleMenuKeyDown}
              className="animate-popover-in absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl border border-zinc-200/80 bg-white/95 p-1.5 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.22),0_2px_6px_rgba(24,24,27,0.06)] backdrop-blur-xl"
            >
              <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Sections
              </p>
              {VIEW_OPTIONS.map((option, index) => {
                const Icon = option.icon;
                const isActive = option.id === activeView;
                return (
                  <button
                    key={option.id}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    tabIndex={-1}
                    onClick={() => {
                      onViewChange(option.id);
                      close(true);
                    }}
                    className={cx(
                      "group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors",
                      "hover:bg-zinc-100 focus-visible:bg-zinc-100",
                      isActive && "bg-teal-50/70 hover:bg-teal-50 focus-visible:bg-teal-50",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                        isActive
                          ? "border-teal-200 bg-white text-[#0F766E]"
                          : "border-zinc-200/80 bg-white text-zinc-500",
                      )}
                    >
                      <Icon size={14} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cx(
                          "block text-[13px] font-medium leading-5",
                          isActive ? "text-teal-900" : "text-zinc-900",
                        )}
                      >
                        {option.label}
                      </span>
                      <span className="block text-xs leading-4 text-zinc-500">
                        {option.description}
                      </span>
                    </span>
                    <Check
                      size={14}
                      strokeWidth={2}
                      aria-hidden="true"
                      className={cx(
                        "mt-1 shrink-0 text-[#0F766E]",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {rightSlot}
      </div>
    </header>
  );
}

export default PortalHeader;
