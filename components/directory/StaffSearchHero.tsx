"use client";

import { useId } from "react";
import { Search, X } from "lucide-react";
import { cx } from "@/lib/utils";

/**
 * The Staff Directory's one search field — search is the product north star
 * here, so it is the most prominent control on the surface: a high-contrast
 * white clinical field against the `#20241E` hero band, Dove Black ink, a muted
 * placeholder, and a Dove Green focus ring.
 *
 * The shape and the tokens are the Knowledge Home hero's, at the directory's
 * measure; only the wording and the shortcut badge differ — this surface binds
 * no global shortcut, so it advertises none. Escape clears a non-empty query and
 * blurs an empty one, the same terminal rule the other surfaces' fields follow.
 *
 * Filtering is immediate: the surface reads the raw value, not a debounced copy.
 * The roster is small enough that a keystroke is a filter, and a directory at
 * 2 AM should not wait on a timer to answer.
 */

export interface StaffSearchHeroProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  className?: string;
}

export function StaffSearchHero({
  value,
  onChange,
  label,
  placeholder,
  className,
}: StaffSearchHeroProps) {
  const inputId = useId();
  const hasValue = value.length > 0;

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
        aria-label={label}
        className={cx(
          "h-11 w-full rounded-xl border border-[rgba(175,190,35,0.35)] bg-white pl-10 text-[14px] text-[#20241E]",
          "shadow-[0_1px_2px_rgba(16,24,40,0.05)] placeholder:text-zinc-400",
          "transition-colors duration-150",
          "focus:border-[#AFBE23] focus:outline-none focus:ring-2 focus:ring-[#AFBE23]/45",
          hasValue ? "pr-11" : "pr-3.5",
        )}
      />
      {hasValue ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-200/80 text-zinc-600 transition-colors hover:bg-zinc-300/80 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45"
        >
          <X size={13} strokeWidth={2.25} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default StaffSearchHero;
