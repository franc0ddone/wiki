"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { FileText, Search, X } from "lucide-react";
import { Highlighted } from "@/components/search/Highlighted";
import { useDebouncedValue } from "@/lib/hooks";
import { buildSearchIndex, search } from "@/lib/search";
import { fieldClass } from "@/components/editor/Modal";
import { cx } from "@/lib/utils";
import type { KnowledgeArticle } from "@/types/portal";

/**
 * Searchable procedure picker.
 *
 * One search engine, one feel: this drives `lib/search` — the same fuzzy,
 * typo-tolerant, synonym-aware index the command palette and the per-view
 * fields use — so picking a procedure to link to behaves exactly like
 * searching for one. Debounced; arrows + Enter move and choose; the mouse works
 * too. Used by `LinkDialog` and the bulletin composer's Linked SOP field.
 */

export interface ArticleSearchOption {
  slug: string;
  title: string;
  body_markdown: string;
}

const DEBOUNCE_MS = 120;
const LIMIT = 8;

export function ArticleSearch({
  articles,
  value,
  onChange,
  label,
  placeholder = "Search procedures…",
  emptyLabel = "No procedure matches.",
  autoFocus = false,
}: {
  articles: readonly ArticleSearchOption[];
  /** The selected slug, or `""`. */
  value: string;
  onChange: (slug: string, title: string) => void;
  label: string;
  placeholder?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState(() => articles.find((entry) => entry.slug === value)?.title ?? "");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const index = useMemo(
    () =>
      buildSearchIndex(
        articles.map<KnowledgeArticle>((entry) => ({
          id: entry.slug,
          title: entry.title,
          slug: entry.slug,
          departments: [],
          status: "published",
          body_markdown: entry.body_markdown,
          updated_at: "",
          author_name: "",
        })),
        [],
        [],
      ),
    [articles],
  );

  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const results = useMemo(() => {
    const trimmed = debounced.trim();
    if (trimmed.length === 0) {
      return articles.slice(0, LIMIT).map((entry) => ({ slug: entry.slug, title: entry.title, ranges: [] }));
    }
    return search(index, trimmed, { surfaces: ["articles"], limit: LIMIT }).bySurface.articles.map((hit) => ({
      slug: hit.id,
      title: hit.title,
      ranges: hit.titleRanges,
    }));
  }, [articles, index, debounced]);

  const activeIndex = results.length === 0 ? -1 : Math.min(active, results.length - 1);

  useEffect(() => {
    const doc = wrapperRef.current?.ownerDocument;
    if (!doc) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    doc.addEventListener("mousedown", onPointer);
    return () => doc.removeEventListener("mousedown", onPointer);
  }, []);

  const choose = (slug: string, title: string) => {
    onChange(slug, title);
    setQuery(title);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // Keep the picker's keys from reaching the surrounding modal — otherwise
    // Escape (close suggestions) would close the whole dialog.
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      setActive((current) => (results.length === 0 ? 0 : (Math.min(current, results.length - 1) + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      setActive((current) =>
        results.length === 0 ? 0 : (Math.min(current, results.length - 1) - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      const hit = activeIndex >= 0 ? results[activeIndex] : undefined;
      if (open && hit) {
        event.preventDefault();
        event.stopPropagation();
        choose(hit.slug, hit.title);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        size={14}
        strokeWidth={1.75}
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
      />
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={query}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cx(fieldClass, "pl-8 pr-8")}
      />
      {query.length > 0 ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            onChange("", "");
            setOpen(true);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-200/80 text-zinc-600 transition-colors hover:bg-zinc-300/80 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40"
        >
          <X size={11} strokeWidth={2.25} aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Procedures"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.22),0_2px_6px_rgba(24,24,27,0.06)]"
        >
          {results.length === 0 ? (
            <p className="px-2.5 py-2 text-[12.5px] text-zinc-500">{emptyLabel}</p>
          ) : (
            results.map((hit, index_) => (
              <button
                key={hit.slug}
                id={`${id}-opt-${index_}`}
                type="button"
                role="option"
                aria-selected={index_ === activeIndex}
                onMouseMove={() => setActive(index_)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(hit.slug, hit.title)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100",
                  index_ === activeIndex ? "bg-teal-50 ring-1 ring-inset ring-teal-600/25" : "hover:bg-zinc-50",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500"
                >
                  <FileText size={13} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-zinc-900">
                  <Highlighted text={hit.title} ranges={hit.ranges} />
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ArticleSearch;
