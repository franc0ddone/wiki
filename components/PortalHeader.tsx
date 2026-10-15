"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import Image from "next/image";
import { BookOpen, Check, ChevronDown, Megaphone, Search, Users } from "lucide-react";
import type { PortalView } from "@/types/portal";
import { useSearchShortcutLabel } from "@/lib/platform";
import { cx } from "@/lib/utils";

/**
 * Single frosted navigation bar.
 *
 * Left: institutional identity — the official dove symbol beside the wordmark.
 * Right: the universal-search control, a discreet contextual menu that names the
 * current section and opens a floating popover to switch between the three
 * surfaces, and the viewer's account menu. There is no tab bar.
 *
 * **Universal search is icon-only until it is wanted.** The bar used to carry a
 * full-width `Search everything ⌘K` field, which spent its width on a control
 * nobody typed into directly: the search itself happens in the command palette.
 * The control is now a single magnifier button that unfolds into a field on
 * click (or `Ctrl/⌘ K`), hands the typed query to that same palette, and folds
 * back to the icon on Escape — or on blur, while it is empty. Nothing about the
 * search behind it changed: same index, same groups, same keyboard model, same
 * logging.
 */

export interface PortalHeaderProps {
  activeView: PortalView;
  onViewChange: (view: PortalView) => void;
  /**
   * Opens the command palette. Receives the query the unfolded field handed
   * over, or `undefined` when the field was empty (the palette then opens on its
   * own input, exactly as it always has).
   */
  onOpenSearch?: (query?: string) => void;
  /**
   * Product wordmark shown as the primary title, in the display face (Domine),
   * title case.
   */
  title?: string;
  /**
   * Subtle facility / product subtext under the wordmark. Defaults to the same
   * "Institutional knowledge" line the sign-in page carries.
   */
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
  title = "Dove Hub",
  facilityName = "Institutional knowledge",
  rightSlot,
}: PortalHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Set while a typed query is being handed to the palette, so the blur that
   * follows (the palette takes focus) does not fold the field away underneath
   * it — the field has to stay mounted for focus to come back to it on close.
   */
  const handedOff = useRef(false);
  const menuId = useId();
  const searchInputId = `${menuId}-search`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shortcutLabel = useSearchShortcutLabel();

  const expandSearch = useCallback(() => {
    setSearchExpanded(true);
    // Focus after paint, so the field exists and the width transition starts.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const collapseSearch = useCallback(() => {
    handedOff.current = false;
    setSearchValue("");
    setSearchExpanded(false);
  }, []);

  /**
   * `Ctrl/⌘ K` unfolds and focuses the field. The command palette owns the same
   * keystroke *while it is open* (it closes itself); this listener stands down
   * when any modal is up, so the two can never fight over one press.
   */
  useEffect(() => {
    if (!onOpenSearch) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      if (document.querySelector("[aria-modal='true']")) return;
      event.preventDefault();
      if (searchExpanded) collapseSearch();
      else expandSearch();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onOpenSearch, searchExpanded, expandSearch, collapseSearch]);

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
          {/*
           * The official dove symbol — the standalone mark only, never the
           * DoveLewis lockup whose brand text the wordmark beside it would
           * duplicate. Used exactly as supplied (no recolour, no crop), sized to
           * the ~34px header slot the graphic design package specifies, over the
           * intrinsic dimensions so the aspect ratio is never stretched.
           * Decorative: the <h1> below already names the product.
           */}
          <Image
            src="/brand/dove-symbol.png"
            alt=""
            aria-hidden="true"
            width={580}
            height={553}
            priority
            className="h-[34px] w-auto shrink-0"
          />
          <div className="min-w-0">
            {/*
             * The wordmark: "Dove Hub" in Domine, the product's serif display
             * face (`--font-display`, the same face the brand lockup and the
             * sign-in wordmark use) — title case, never the all-caps treatment
             * this bar used to carry. The all-caps letter-spacing went with the
             * caps: it is replaced by the brand wordmark's own tracking, the
             * value `BrandLockup` sets.
             */}
            <h1 className="dw-display truncate text-[13px] font-bold leading-4 tracking-[-0.01em] text-zinc-900">
              {title}
            </h1>
            <p className="truncate text-xs text-zinc-400">{facilityName}</p>
          </div>
        </div>

        {/* Universal search — a magnifier until it is wanted */}
        {onOpenSearch ? (
          <div
            className={cx(
              "relative ml-auto flex h-8 items-center overflow-hidden rounded-lg border transition-[width,border-color,background-color,box-shadow] duration-200 ease-out",
              searchExpanded
                ? "w-full border-zinc-300/60 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:w-64 md:w-72"
                : "w-8 border-transparent",
            )}
          >
            <button
              ref={searchButtonRef}
              type="button"
              onClick={() => (searchExpanded ? searchInputRef.current?.focus() : expandSearch())}
              aria-label={`Search everything (${shortcutLabel})`}
              aria-keyshortcuts="Control+K Meta+K"
              aria-expanded={searchExpanded}
              aria-controls={searchInputId}
              className={cx(
                "absolute inset-y-0 left-0 z-10 flex w-8 items-center justify-center rounded-lg transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/60",
                searchExpanded
                  ? "text-[#5F6E00]/70 hover:text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-900/[0.04] hover:text-zinc-900",
              )}
            >
              <Search size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <input
              ref={searchInputRef}
              id={searchInputId}
              type="search"
              value={searchValue}
              onChange={(event) => {
                const value = event.target.value;
                setSearchValue(value);
                // A typed query is the universal search: hand it to the palette
                // (the same one ⌘K opens) and leave the field empty behind it.
                if (value.trim().length > 0) {
                  handedOff.current = true;
                  onOpenSearch(value);
                  setSearchValue("");
                }
              }}
              onFocus={() => {
                handedOff.current = false;
              }}
              onBlur={() => {
                if (searchValue.length > 0 || handedOff.current) return;
                if (document.querySelector("[aria-modal='true']")) return;
                collapseSearch();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  collapseSearch();
                }
              }}
              placeholder="Search everything"
              autoComplete="off"
              spellCheck={false}
              aria-label="Search everything"
              tabIndex={searchExpanded ? 0 : -1}
              className={cx(
                "h-full w-full bg-transparent pl-8 pr-2 text-[13px] text-zinc-800 placeholder:text-zinc-400",
                "focus:outline-none",
                searchExpanded ? "opacity-100" : "pointer-events-none opacity-0",
                "transition-opacity duration-150",
              )}
            />
            {searchExpanded && searchValue.length === 0 ? (
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute right-1.5 top-1/2 hidden h-[18px] -translate-y-1/2 items-center rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[11px] font-medium tracking-wide text-zinc-500 sm:flex"
              >
                {shortcutLabel}
              </kbd>
            ) : null}
          </div>
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
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/40 focus-visible:ring-offset-1",
              isOpen
                ? "bg-zinc-900/[0.06]"
                : "hover:bg-zinc-900/[0.04] active:bg-zinc-900/[0.07]",
            )}
          >
            <ActiveIcon size={14} strokeWidth={1.75} aria-hidden="true" className="text-[#5F6E00]" />
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
                      isActive && "bg-[#AFBE23]/12 hover:bg-[#AFBE23]/15 focus-visible:bg-[#AFBE23]/15",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                        isActive
                          ? "border-[#5F6E00]/20 bg-white text-[#5F6E00]"
                          : "border-zinc-200/80 bg-white text-zinc-500",
                      )}
                    >
                      <Icon size={14} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cx(
                          "block text-[13px] font-medium leading-5",
                          isActive ? "text-[#3F4A00]" : "text-zinc-900",
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
                        "mt-1 shrink-0 text-[#5F6E00]",
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
