"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ClipboardList,
  Info,
  Lightbulb,
  ListTree,
  OctagonAlert,
  Syringe,
  TriangleAlert,
} from "lucide-react";
import { cx } from "@/lib/utils";

/**
 * Reading surface for SOPs and bulletins: a floating white paper canvas with an
 * auto-generated table of contents.
 *
 * Dependency-free renderer for the clinical Markdown subset used by the portal:
 * `#`/`##`/`###` headings, paragraphs, ordered and unordered lists, pipe tables,
 * fenced code, horizontal rules, blockquotes, inline bold / italic / code /
 * links, and clinical callouts:
 *
 *   > [!note]     general information           (teal)
 *   > [!tip]      practical advice              (teal)
 *   > [!dosing]   dosing / drug reference        (teal)
 *   > [!protocol] mandatory protocol step        (teal)
 *   > [!warning]  caution                       (amber)
 *   > [!critical] patient-safety critical        (red)
 *
 * Everything is emitted as React children rather than raw HTML, so stored
 * markdown can never become injected markup.
 *
 * Table of contents: H2/H3 headings get stable ids. At `xl` and up the outline
 * is a sticky right rail with scroll spy; below `xl` it collapses into jump
 * links at the top of the paper.
 */

type CalloutVariant = "note" | "tip" | "dosing" | "protocol" | "warning" | "critical";

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

/**
 * Heading/anchor slug. Exported so `lib/links.ts` can validate internal links
 * against the exact ids this reader emits — the two must never disagree.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Heading text without inline markdown markers, for the outline. */
function plainText(text: string): string {
  return text.replace(/\*\*|`|\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
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
  if (value === "dosing" || value === "dose" || value === "dosage") return "dosing";
  if (value === "protocol" || value === "procedure") return "protocol";
  if (value === "warning" || value === "warn" || value === "caution") return "warning";
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
    if (
      TABLE_ROW_RE.test(line) &&
      index + 1 < lines.length &&
      TABLE_DIVIDER_RE.test(lines[index + 1])
    ) {
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
        if (!next || CALLOUT_RE.test(lines[index])) break;
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
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    } else {
      // Defensive: never stall on a line no branch consumed.
      index += 1;
    }
  }

  return blocks;
}

/** Extract the H2/H3 outline used by the table of contents. */
export function extractToc(blocks: readonly Block[]): TocEntry[] {
  return blocks.flatMap((block) =>
    block.kind === "heading" && (block.level === 2 || block.level === 3)
      ? [{ id: block.id, text: plainText(block.text), level: block.level }]
      : [],
  );
}

/* ------------------------------------------------------------------ inline */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g;

/** Only allow schemes that are safe to render as a link target. */
function safeHref(href: string): string | undefined {
  const value = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  return undefined;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE_RE.source, "g");
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`i${key++}`} className="font-semibold text-zinc-900">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`i${key++}`}
          className="rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 py-px font-mono text-[0.84em] font-medium text-teal-800"
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
            className="font-medium text-[#0F766E] underline decoration-teal-600/30 underline-offset-[3px] transition-colors hover:decoration-teal-600"
          >
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else {
      nodes.push(
        <em key={`i${key++}`} className="italic text-zinc-800">
          {token.slice(1, -1)}
        </em>,
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/* ---------------------------------------------------------------- callouts */

const CALLOUT_STYLES: Record<
  CalloutVariant,
  { title: string; wrap: string; label: string; body: string; icon: ReactNode }
> = {
  note: {
    title: "Note",
    wrap: "border-teal-200 bg-teal-50/70",
    label: "text-teal-800",
    body: "text-teal-950/85",
    icon: <Info size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  tip: {
    title: "Tip",
    wrap: "border-teal-200 bg-teal-50/70",
    label: "text-teal-800",
    body: "text-teal-950/85",
    icon: <Lightbulb size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  dosing: {
    title: "Dosing",
    wrap: "border-teal-200 bg-teal-50/70",
    label: "text-teal-800",
    body: "text-teal-950/85",
    icon: <Syringe size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  protocol: {
    title: "Protocol",
    wrap: "border-teal-200 bg-teal-50/70",
    label: "text-teal-800",
    body: "text-teal-950/85",
    icon: <ClipboardList size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  warning: {
    title: "Warning",
    wrap: "border-amber-200 bg-amber-50/80",
    label: "text-amber-800",
    body: "text-amber-950/85",
    icon: <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
  critical: {
    title: "Critical",
    wrap: "border-red-200 bg-red-50/80",
    label: "text-red-700",
    body: "text-red-950/85",
    icon: <OctagonAlert size={14} strokeWidth={1.75} aria-hidden="true" />,
  },
};

/* ------------------------------------------------------------------ blocks */

const BODY_TEXT = "text-[15.5px] leading-relaxed text-zinc-800";

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const anchor = { id: block.id, "data-heading-id": block.id };
      if (block.level === 1) {
        return (
          <h1
            key={key}
            {...anchor}
            className="scroll-mt-6 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-zinc-900"
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
            className="scroll-mt-6 border-t border-zinc-100 pt-8 text-[1.3rem] font-semibold leading-snug tracking-[-0.015em] text-zinc-900 first:border-t-0 first:pt-0"
          >
            {renderInline(block.text)}
          </h2>
        );
      }
      return (
        <h3
          key={key}
          {...anchor}
          className="scroll-mt-6 pt-2 text-[1.05rem] font-semibold leading-snug tracking-[-0.01em] text-zinc-900"
        >
          {renderInline(block.text)}
        </h3>
      );
    }

    case "paragraph":
      return (
        <p key={key} className={BODY_TEXT}>
          {renderInline(block.text)}
        </p>
      );

    case "list": {
      if (block.ordered) {
        return (
          <ol key={key} className="space-y-2 pl-6">
            {block.items.map((item, itemIndex) => (
              <li
                key={itemIndex}
                className={cx(
                  "list-decimal pl-1.5 marker:text-[13px] marker:font-semibold marker:text-teal-700",
                  BODY_TEXT,
                )}
              >
                {renderInline(item)}
              </li>
            ))}
          </ol>
        );
      }
      return (
        <ul key={key} className="space-y-2 pl-6">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex} className={cx("list-disc pl-1.5 marker:text-teal-600/70", BODY_TEXT)}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    }

    case "table":
      return (
        <div
          key={key}
          className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
        >
          <table className="w-full border-collapse text-left text-[13.5px]">
            <thead>
              <tr className="bg-zinc-50">
                {block.head.map((cell, cellIndex) => (
                  <th
                    key={cellIndex}
                    scope="col"
                    className="whitespace-nowrap border-b border-zinc-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-zinc-500"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="transition-colors hover:bg-zinc-50/70">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cx(
                        "px-4 py-2.5 align-top leading-6",
                        cellIndex === 0 ? "font-medium text-zinc-900" : "text-zinc-700",
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
        <aside
          key={key}
          role="note"
          aria-label={style.title}
          className={cx("rounded-xl border px-4 py-3.5", style.wrap)}
        >
          <p
            className={cx(
              "flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.07em]",
              style.label,
            )}
          >
            {style.icon}
            {style.title}
          </p>
          <p className={cx("mt-1.5 text-[15px] leading-relaxed", style.body)}>
            {renderInline(block.text)}
          </p>
        </aside>
      );
    }

    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-zinc-200 pl-4 text-[15.5px] italic leading-relaxed text-zinc-600"
        >
          {renderInline(block.text)}
        </blockquote>
      );

    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 font-mono text-[12.5px] leading-6 text-zinc-800"
        >
          <code>{block.text}</code>
        </pre>
      );

    case "rule":
      return <hr key={key} className="border-zinc-100" />;

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ reader */

export interface MarkdownReaderProps {
  source: string;
  /** Title / metadata rendered inside the paper, above the body. */
  header?: ReactNode;
  /** Content rendered inside the paper, below the body. */
  footer?: ReactNode;
  /** Build the outline from H2/H3 headings. Shown only when there are 2+ entries. */
  showTableOfContents?: boolean;
  className?: string;
}

export function MarkdownReader({
  source,
  header,
  footer,
  showTableOfContents = true,
  className,
}: MarkdownReaderProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const toc = useMemo(() => extractToc(blocks), [blocks]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [spyId, setSpyId] = useState<string | null>(null);

  const hasToc = showTableOfContents && toc.length >= 2;
  const activeId = spyId && toc.some((entry) => entry.id === spyId) ? spyId : (toc[0]?.id ?? null);

  // Scroll spy, driven by the nearest `[data-scroll-root]` scroller rather than
  // the viewport (an IntersectionObserver would observe the wrong root).
  useEffect(() => {
    if (!hasToc) return;
    const root = rootRef.current;
    if (!root) return;

    const scrollRoot = root.closest("[data-scroll-root]");
    const target: HTMLElement | Window = scrollRoot instanceof HTMLElement ? scrollRoot : window;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const headings = root.querySelectorAll<HTMLElement>("article [data-heading-id]");
        if (headings.length === 0) return;
        const top = scrollRoot instanceof HTMLElement ? scrollRoot.getBoundingClientRect().top : 0;
        let current = headings[0]?.dataset.headingId ?? null;
        headings.forEach((heading) => {
          if (heading.getBoundingClientRect().top - top <= 120) {
            current = heading.dataset.headingId ?? current;
          }
        });
        // At the very bottom, the last heading wins even if it never reaches the line.
        if (scrollRoot instanceof HTMLElement) {
          const atBottom =
            scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 4;
          if (atBottom) current = headings[headings.length - 1]?.dataset.headingId ?? current;
        }
        setSpyId(current);
      });
    };

    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [hasToc, source]);

  const jumpTo = useCallback((id: string) => {
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-heading-id='${id}']`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
    setSpyId(id);
  }, []);

  return (
    <div
      ref={rootRef}
      className={cx(
        "w-full",
        hasToc && "xl:grid xl:grid-cols-[minmax(0,1fr)_13.5rem] xl:items-start xl:gap-10",
        className,
      )}
    >
      <article className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm md:p-12">
        {header ? <header className="mb-8 border-b border-zinc-100 pb-7">{header}</header> : null}

        {hasToc ? (
          <nav
            aria-label="Jump to section"
            className="mb-8 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3 xl:hidden"
          >
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-zinc-500">
              <ListTree size={14} strokeWidth={1.75} aria-hidden="true" />
              On this page
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-1 gap-y-1">
              {toc
                .filter((entry) => entry.level === 2)
                .map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(entry.id)}
                      className="rounded-md px-2 py-1 text-[12.5px] font-medium text-[#0F766E] transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                    >
                      {entry.text}
                    </button>
                  </li>
                ))}
            </ul>
          </nav>
        ) : null}

        <div className="max-w-[46rem] space-y-5">
          {blocks.map((block, index) => renderBlock(block, index))}
        </div>

        {footer ? <footer className="mt-10">{footer}</footer> : null}
      </article>

      {hasToc ? (
        <aside className="hidden xl:sticky xl:top-8 xl:block xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">
          <p className="flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-zinc-500">
            <ListTree size={14} strokeWidth={1.75} aria-hidden="true" />
            On this page
          </p>
          <nav className="mt-3" aria-label="Article sections">
            <ul className="space-y-px border-l border-zinc-200">
              {toc.map((entry) => {
                const isActive = entry.id === activeId;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => jumpTo(entry.id)}
                      aria-current={isActive ? "location" : undefined}
                      className={cx(
                        "-ml-px block w-full border-l-2 py-1.5 pr-2 text-left text-[12.5px] leading-5 transition-colors",
                        entry.level === 3 ? "pl-6" : "pl-3",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/35",
                        isActive
                          ? "border-[#0F766E] font-medium text-teal-800"
                          : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900",
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
