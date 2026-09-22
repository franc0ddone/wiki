"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/lib/utils";

/**
 * Dependency-free renderer for the clinical Markdown subset used by the portal.
 *
 * Supported: `#`/`##`/`###` headings, paragraphs, ordered and unordered lists,
 * pipe tables, fenced code, horizontal rules, blockquotes, clinical callouts
 * (`> [!note|tip|warning|critical] body`), and inline bold / italic / code /
 * links.
 *
 * Everything is emitted as React children rather than raw HTML, so stored
 * markdown can never become injected markup. Tiptap takes over *authoring* in a
 * later phase; this stays the read-only path for stored bodies.
 */

type CalloutVariant = "note" | "tip" | "warning" | "critical";

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; id: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "callout"; variant: CalloutVariant; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" };

export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const UNORDERED_RE = /^\s*[-*]\s+(.+)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const CALLOUT_RE = /^\s*>\s*\[!(\w+)\]\s*(.*)$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,})\s*$/;
const FENCE_RE = /^\s*```/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|?[\s:|-]+\|?\s*$/;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeVariant(raw: string): CalloutVariant {
  const value = raw.toLowerCase();
  if (value === "tip") return "tip";
  if (value === "warning" || value === "warn") return "warning";
  if (value === "critical" || value === "danger") return "critical";
  return "note";
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const usedIds = new Map<string, number>();
  let index = 0;

  const nextHeadingId = (text: string): string => {
    const base = slugify(text) || "section";
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  };

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    if (FENCE_RE.test(line)) {
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !FENCE_RE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // consume the closing fence (or run off the end safely)
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const text = heading[2].trim();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        id: nextHeadingId(text),
        text,
      });
      index += 1;
      continue;
    }

    // Tables: a pipe row immediately followed by a `| --- |` divider.
    if (TABLE_ROW_RE.test(line) && index + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[index + 1])) {
      const head = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && TABLE_ROW_RE.test(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const callout = CALLOUT_RE.exec(line);
    if (callout) {
      const variant = normalizeVariant(callout[1]);
      const body: string[] = [];
      if (callout[2].trim().length > 0) body.push(callout[2].trim());
      index += 1;
      while (index < lines.length) {
        const next = QUOTE_RE.exec(lines[index]);
        if (!next || CALLOUT_RE.test(lines[index])) break;
        body.push(next[1].trim());
        index += 1;
      }
      blocks.push({ kind: "callout", variant, text: body.join(" ") });
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const collected: string[] = [];
      while (index < lines.length) {
        const next = QUOTE_RE.exec(lines[index]);
        if (!next) break;
        collected.push(next[1].trim());
        index += 1;
      }
      blocks.push({ kind: "quote", text: collected.join(" ") });
      continue;
    }

    const unordered = UNORDERED_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered) && !unordered;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = isOrdered ? ORDERED_RE.exec(current) : UNORDERED_RE.exec(current);
        if (!match) break;
        items.push(match[1].trim());
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (
        current.trim().length === 0 ||
        HEADING_RE.test(current) ||
        UNORDERED_RE.test(current) ||
        ORDERED_RE.test(current) ||
        QUOTE_RE.test(current) ||
        FENCE_RE.test(current) ||
        RULE_RE.test(current) ||
        TABLE_ROW_RE.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

/** Extract the heading outline used by the article table of contents. */
export function extractToc(blocks: readonly Block[]): TocEntry[] {
  return blocks.flatMap((block) =>
    block.kind === "heading" && (block.level === 2 || block.level === 3)
      ? [{ id: block.id, text: block.text, level: block.level }]
      : [],
  );
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g;

/** Only allow schemes that are safe to render as a link target. */
function safeHref(href: string): string | undefined {
  const value = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return undefined;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`i${key++}`} className="font-semibold text-zinc-100">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`i${key++}`}
          className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[0.85em] text-[#5CBEB4]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = linkMatch?.[1] ?? token;
      const href = linkMatch ? safeHref(linkMatch[2]) : undefined;
      nodes.push(
        href ? (
          <a
            key={`i${key++}`}
            href={href}
            className="text-[#5CBEB4] underline decoration-[#5CBEB4]/30 underline-offset-2 transition-colors hover:decoration-[#5CBEB4]"
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else {
      nodes.push(
        <em key={`i${key++}`} className="italic text-zinc-200">
          {token.slice(1, -1)}
        </em>,
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

const CALLOUT_STYLES: Record<
  CalloutVariant,
  { wrap: string; label: string; icon: ReactNode }
> = {
  note: {
    wrap: "border-[#5CBEB4]/30 bg-[#005953]/12",
    label: "text-[#5CBEB4]",
    icon: <Info size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  tip: {
    wrap: "border-[#5CBEB4]/30 bg-[#005953]/12",
    label: "text-[#5CBEB4]",
    icon: <Lightbulb size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  warning: {
    wrap: "border-amber-900/70 bg-amber-950/25",
    label: "text-amber-400",
    icon: <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  critical: {
    wrap: "border-red-900/70 bg-red-950/25",
    label: "text-red-400",
    icon: <OctagonAlert size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
};

const CALLOUT_TITLES: Record<CalloutVariant, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  critical: "Critical",
};

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const anchor = { id: block.id, "data-heading-id": block.id };
      if (block.level === 1) {
        return (
          <h1
            key={key}
            {...anchor}
            className="scroll-mt-8 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[1.75rem]"
          >
            {renderInline(block.text)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2
            key={key}
            {...anchor}
            className="scroll-mt-8 border-t border-zinc-800 pt-7 text-lg font-semibold tracking-tight text-zinc-50 first:border-t-0 first:pt-0 sm:text-xl"
          >
            {renderInline(block.text)}
          </h2>
        );
      }
      return (
        <h3
          key={key}
          {...anchor}
          className="scroll-mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5CBEB4]/80"
        >
          {renderInline(block.text)}
        </h3>
      );
    }

    case "paragraph":
      return (
        <p key={key} className="text-[15px] leading-7 text-zinc-300">
          {renderInline(block.text)}
        </p>
      );

    case "list": {
      if (block.ordered) {
        return (
          <ol key={key} className="space-y-2.5 pl-6">
            {block.items.map((item, itemIndex) => (
              <li
                key={itemIndex}
                className="list-decimal pl-1 text-[15px] leading-7 text-zinc-300 marker:font-medium marker:text-[#5CBEB4]/70"
              >
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
      }
      return (
        <ul key={key} className="space-y-2.5 pl-6">
          {block.items.map((item, itemIndex) => (
            <li
              key={itemIndex}
              className="list-disc pl-1 text-[15px] leading-7 text-zinc-300 marker:text-[#5CBEB4]/60"
            >
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    }

    case "table":
      return (
        <div key={key} className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="bg-zinc-900/80">
                {block.head.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    scope="col"
                    className="border-b border-zinc-800 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-zinc-800/70 last:border-b-0 odd:bg-zinc-950 even:bg-zinc-900/30"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cx(
                        "px-4 py-2.5 align-top leading-6",
                        cellIndex === 0 ? "font-medium text-zinc-100" : "text-zinc-300",
                      )}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "callout": {
      const style = CALLOUT_STYLES[block.variant];
      return (
        <div key={key} className={cx("rounded-lg border px-4 py-3.5", style.wrap)}>
          <p
            className={cx(
              "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]",
              style.label,
            )}
          >
            {style.icon}
            {CALLOUT_TITLES[block.variant]}
          </p>
          <p className="mt-2 text-[15px] leading-7 text-zinc-200">{renderInline(block.text)}</p>
        </div>
      );
    }

    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l border-zinc-700 pl-4 text-[15px] italic leading-7 text-zinc-400"
        >
          {renderInline(block.text)}
        </blockquote>
      );

    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 font-mono text-xs leading-6 text-zinc-300"
        >
          <code>{block.text}</code>
        </pre>
      );

    case "rule":
      return <hr key={key} className="border-zinc-800" />;

    default:
      return null;
  }
}

export interface MarkdownReaderProps {
  source: string;
  className?: string;
  /** Render the sticky "On this page" rail beside the article (lg and up). */
  showTableOfContents?: boolean;
}

export function MarkdownReader({
  source,
  className,
  showTableOfContents = false,
}: MarkdownReaderProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const toc = useMemo(() => extractToc(blocks), [blocks]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const hasToc = showTableOfContents && toc.length > 0;

  // Scroll-spy: highlight the heading currently nearest the top of the reader.
  useEffect(() => {
    if (!hasToc) return;
    const root = rootRef.current;
    if (!root) return;

    const scrollRoot = root.closest("[data-scroll-root]");
    const target: HTMLElement | Window = scrollRoot instanceof HTMLElement ? scrollRoot : window;

    const update = () => {
      const headings = root.querySelectorAll<HTMLElement>("[data-heading-id]");
      if (headings.length === 0) return;
      const top = scrollRoot instanceof HTMLElement ? scrollRoot.getBoundingClientRect().top : 0;
      let current = headings[0].dataset.headingId ?? null;
      headings.forEach((heading) => {
        if (heading.getBoundingClientRect().top - top <= 96) {
          current = heading.dataset.headingId ?? current;
        }
      });
      setActiveId(current);
    };

    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [hasToc, source]);

  const jumpTo = useCallback((id: string) => {
    const node = document.getElementById(id);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  }, []);

  return (
    <div
      ref={rootRef}
      className={cx(
        hasToc && "lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-start lg:gap-12",
      )}
    >
      <div className={cx("space-y-5", className)}>
        {blocks.map((block, index) => renderBlock(block, index))}
      </div>

      {hasToc ? (
        <aside className="hidden lg:sticky lg:top-0 lg:block lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            On this page
          </p>
          <nav className="mt-3 border-l border-zinc-800" aria-label="Article sections">
            <ul className="space-y-1">
              {toc.map((entry) => {
                const isActive = entry.id === activeId;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(entry.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cx(
                        "-ml-px block w-full border-l py-1 pr-2 text-left text-xs leading-5 transition-colors",
                        entry.level === 3 ? "pl-6" : "pl-3",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5CBEB4]",
                        isActive
                          ? "border-[#5CBEB4] font-medium text-[#5CBEB4]"
                          : "border-transparent text-zinc-500 hover:border-zinc-600 hover:text-zinc-300",
                      )}
                    >
                      {entry.text}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>
      ) : null}
    </div>
  );
}

export default MarkdownReader;