"use client";

import { useId, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { useIsApplePlatform } from "@/lib/platform";
import { cx } from "@/lib/utils";

/**
 * The Knowledge Home search hero — **the one search input on the surface**,
 * sitting inside the dark header band.
 *
 * Search is the product north star, so the field itself is a high-contrast
 * light clinical surface against the `#20241E` band: white ground, Dove Black
 * ink, a muted placeholder, and a Dove Green focus ring so it commands focus the
 * moment the band is on screen. Nothing else on the page is a search field —
 * removing the master/detail shell removed the second, redundant one.
 *
 * Ctrl+Space focuses this field — the *surface* owns that listener
 * (`KnowledgeHome`), because the shortcut must work from anywhere on the
 * surface, not only while the input is on screen; the field itself only offers
 * the visible hint. **The command palette's Ctrl+K is untouched**: this hero
 * never opens a modal and never binds Ctrl+K, so there is no duplicate search
 * surface and no second listener on the same keystroke.
 *
 * Escape clears a non-empty query and blurs an empty one — the terminal rule the
 * surface expects of its single field.
 */

export interface SopSearchHeroProps {
  value: string;
  onChange: (value: string) => void;
  /** The surface's ref, so its Ctrl+Space listener can focus this input. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Accessible name for the input. */
  label: string;
  placeholder: string;
  className?: string;
}

export function SopSearchHero({
  value,
  onChange,
  inputRef,
  label,
  placeholder,
  className,
}: SopSearchHeroProps) {
  const inputId = useId();
  const isApple = useIsApplePlatform();
  const hasValue = value.length > 0;
  // Printed to match the portal's existing shortcut badge ("Ctrl K" / "⌘K").
  const printed = isApple ? "\u2318 Space" : "Ctrl Space";

  return (
    <div className={cx("relative", className)}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search
        size={16}
        strokeWidth={1.75}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5F6E00]/70"
      />
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (hasValue) onChange("");
            else event.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-keyshortcuts="Control+Space Meta+Space"
        aria-label={label}
        title={`Search all published SOPs (${printed})`}
        className={cx(
          "h-11 w-full rounded-xl border border-[rgba(175,190,35,0.35)] bg-white pl-10 text-[14px] text-[#20241E]",
          "shadow-[0_1px_2px_rgba(16,24,40,0.05)] placeholder:text-zinc-400",
          "transition-colors duration-150",
          "focus:border-[#AFBE23] focus:outline-none focus:ring-2 focus:ring-[#AFBE23]/45",
          hasValue ? "pr-11" : "pr-[6.25rem]",
        )}
      />
      {hasValue ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-200/80 text-zinc-600 transition-colors hover:bg-zinc-300/80 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45"
        >
          <X size={13} strokeWidth={2.25} aria-hidden="true" />
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 flex h-[21px] -translate-y-1/2 items-center rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 font-sans text-[10.5px] font-medium tracking-wide text-zinc-500"
        >
          {printed}
        </kbd>
      )}
    </div>
  );
}

export default SopSearchHero;
