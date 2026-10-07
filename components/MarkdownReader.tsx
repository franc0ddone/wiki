"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  ChevronRight,
  ClipboardList,
  Info,
  Lightbulb,
  ListTree,
  OctagonAlert,
  Syringe,
  TriangleAlert,
} from "lucide-react";
import { ClinicalTable } from "@/components/reader/ClinicalTable";
import { InlineText, ReaderNavContext, safeImageSrc } from "@/components/reader/Inline";
import type { ReaderNav } from "@/components/reader/Inline";
import { Lightbox } from "@/components/reader/Lightbox";
import {
  collectFootnotes,
  collectImages,
  extractToc,
  parseMarkdown,
  slugify,
  type Block,
  type CalloutVariant,
  type ListBlock,
  type TocEntry,
} from "@/lib/markdown/parser";
import type { ImageAlign } from "@/lib/markdown/image-attributes";
import { footnoteDefinitionId, footnoteReferenceId } from "@/lib/markdown/footnotes";
import { cx } from "@/lib/utils";

/**
 * Reading surface for SOPs and bulletins: a floating white paper canvas with an
 * auto-generated table of contents.
 *
 * Renders the clinical Markdown subset parsed by `lib/markdown/parser.ts`:
 * `#`/`##`/`###` headings (with optional `{#custom-id}`), paragraphs, nested
 * ordered / unordered / task lists, pipe tables (sortable, filterable), fenced
 * code (```mermaid renders a flowchart), `:::details` collapsibles, figures,
 * horizontal rules, blockquotes, nested inline emphasis / code / links, and
 * clinical callouts:
 *
 *   > [!note]     general information           (teal)
 *   > [!tip]      practical advice              (teal)
 *   > [!dosing]   dosing / drug reference        (teal)
 *   > [!protocol] mandatory protocol step        (teal)
 *   > [!warning]  caution                       (amber)
 *   > [!critical] patient-safety critical        (red)
 *
 * XSS posture: everything is emitted as React children. There is no
 * `dangerouslySetInnerHTML` and no raw-HTML passthrough; `href` / `src` values
 * pass an allowlist (`safeHref` / `safeImageSrc`). Mermaid is loaded lazily and
 * its SVG is walked against an element allowlist before it touches the page.
 *
 * Table of contents: H2/H3 headings get stable ids. At `xl` and up the outline
 * is a sticky right rail with scroll spy; below `xl` it collapses into jump
 * links at the top of the paper.
 *
 * Print: chrome is hidden and every collapsed table / `<details>` is forced
 * open, so a printed SOP never hides content.
 */

// Heavy and rare: fetched only when a ```mermaid fence is actually rendered.
const MermaidDiagram = dynamic(() => import("@/components/reader/MermaidDiagram"), {
  ssr: false,
  loading: () => (
    <p className="text-[12.5px] text-zinc-500" role="status">
      Rendering diagram…
    </p>
  ),
});

// The parser lives in `lib/markdown/parser.ts` (pure, server-safe). These
// re-exports keep this module's historical public surface intact.
export { extractToc, parseMarkdown, slugify };
export type { TocEntry };

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

function TaskBox({ checked }: { checked: boolean }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-readonly="true"
      aria-label={checked ? "Done" : "Not done"}
      className={cx(
        "mt-[5px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
        checked ? "border-[#0F766E] bg-[#0F766E] text-white" : "border-zinc-400 bg-white",
      )}
    >
      {checked ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : null}
    </span>
  );
}

function renderList(list: ListBlock, key: string | number, depth = 0): ReactNode {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag key={key} className={cx("space-y-2.5", depth === 0 ? "pl-6" : "mt-2.5 pl-5")}>
      {list.items.map((item, itemIndex) => {
        const nested = item.children ? renderList(item.children, "nested", depth + 1) : null;

        if (item.checked !== null) {
          return (
            <li key={itemIndex} className={cx("list-none", BODY_TEXT)}>
              <div className="-ml-6 flex items-start gap-2.5">
                <TaskBox checked={item.checked} />
                <span className={cx(item.checked && "text-zinc-500 line-through decoration-zinc-300")}>
                  <InlineText text={item.text} />
                </span>
              </div>
              {nested}
            </li>
          );
        }

        return (
          <li
            key={itemIndex}
            className={cx(
              "pl-1.5",
              list.ordered
                ? "list-decimal marker:text-[13px] marker:font-semibold marker:text-teal-700"
                : "list-disc marker:text-teal-600/70",
              BODY_TEXT,
            )}
          >
            <InlineText text={item.text} />
            {nested}
          </li>
        );
      })}
    </Tag>
  );
}

function ArticleFigure({
  src,
  alt,
  title,
  width,
  align,
}: {
  src: string;
  alt: string;
  title: string | null;
  width: number | null;
  align: ImageAlign | null;
}) {
  const safe = safeImageSrc(src);
  const nav = useContext(ReaderNavContext);
  if (!safe) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[13px] text-amber-900">
        Image not shown (unsupported address): {alt}
      </p>
    );
  }
  // A caption (the Markdown title) wins; an image with none keeps the old
  // behaviour of showing its alt text under the figure.
  const caption = title && title.trim().length > 0 ? title : alt;
  const alignment = align === "left" ? "mr-auto" : align === "right" ? "ml-auto" : "mx-auto";
  const captionAlign = align === "left" ? "text-left" : align === "right" ? "text-right" : "text-center";
  return (
    <figure className="space-y-2 print:break-inside-avoid">
      <button
        type="button"
        onClick={() => nav.openImage?.(safe)}
        aria-label={`Enlarge image: ${alt}`}
        style={width !== null ? { width: `${width}px`, maxWidth: "100%" } : undefined}
        className={cx(
          "block cursor-zoom-in overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 print:cursor-auto",
          width === null && "w-full",
          alignment,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- origin is the hospital's object store */}
        <img
          src={safe}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="mx-auto max-h-[28rem] w-auto max-w-full object-contain"
        />
      </button>
      <figcaption className={cx("text-[13px] leading-5 text-zinc-500", captionAlign)}>{caption}</figcaption>
    </figure>
  );
}

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
            <InlineText text={block.text} />
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2
            key={key}
            {...anchor}
            className="scroll-mt-6 mt-10 mb-4 text-[1.3rem] font-semibold leading-snug tracking-[-0.015em] text-zinc-900"
          >
            <InlineText text={block.text} />
          </h2>
        );
      }
      return (
        <h3
          key={key}
          {...anchor}
          className="scroll-mt-6 mt-6 mb-2 text-[1.05rem] font-semibold leading-snug tracking-[-0.01em] text-zinc-900"
        >
          <InlineText text={block.text} />
        </h3>
      );
    }

    case "paragraph":
      return (
        <p key={key} className={BODY_TEXT}>
          <InlineText text={block.text} />
        </p>
      );

    case "image":
      return (
        <ArticleFigure
          key={key}
          src={block.src}
          alt={block.alt}
          title={block.title}
          width={block.width}
          align={block.align}
        />
      );

    case "footnoteDefinition":
      // Referenced definitions are pulled into the numbered section; a
      // definition nobody cites is shown as the plain line that was written.
      return (
        <p key={key} className={cx(BODY_TEXT, "text-zinc-500")}>
          <InlineText text={`[^${block.label}]: ${block.text}`} />
        </p>
      );

    case "list":
      return renderList(block, key);

    case "table":
      return <ClinicalTable key={key} head={block.head} rows={block.rows} />;

    case "callout": {
      const style = CALLOUT_STYLES[block.variant];
      return (
        <aside
          key={key}
          role="note"
          aria-label={style.title}
          className={cx("my-6 rounded-[10px] border px-4 py-3.5 print:break-inside-avoid", style.wrap)}
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
          <div className={cx("mt-1.5 space-y-2 text-[15px] leading-relaxed", style.body)}>
            {block.paragraphs.map((paragraph, index) => (
              <p key={index}>
                <InlineText text={paragraph} />
              </p>
            ))}
          </div>
        </aside>
      );
    }

    case "quote":
      return (
        <blockquote
          key={key}
          className="space-y-2 border-l-2 border-zinc-200 pl-4 text-[15.5px] italic leading-relaxed text-zinc-600"
        >
          {block.paragraphs.map((paragraph, index) => (
            <p key={index}>
              <InlineText text={paragraph} />
            </p>
          ))}
        </blockquote>
      );

    case "code":
      if (block.lang === "mermaid") return <MermaidDiagram key={key} source={block.text} />;
      return (
        <pre
          key={key}
          data-lang={block.lang || undefined}
          className="overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 font-mono text-[12.5px] leading-6 text-zinc-800 print:whitespace-pre-wrap"
        >
          <code>{block.text}</code>
        </pre>
      );

    case "details":
      return (
        <details
          key={key}
          className="group rounded-[10px] border border-zinc-300/60 bg-white print:border-zinc-400"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[10px] px-4 py-3 text-[14.5px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              className="shrink-0 text-zinc-400 transition-transform duration-150 group-open:rotate-90"
            />
            <InlineText text={block.summary} />
          </summary>
          <div className="space-y-4 border-t border-zinc-200 px-4 py-4">
            {block.blocks.map((inner, index) => renderBlock(inner, index))}
          </div>
        </details>
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
  /**
   * Open an internal `/procedures/<slug>[#anchor]` link inside the app. When
   * omitted, those links are ordinary site-relative anchors.
   */
  onOpenArticle?: (slug: string, anchor?: string) => boolean | void;
  className?: string;
}

/** Open every ancestor `<details>` of a node so it can be scrolled to. */
function revealInside(node: HTMLElement | null) {
  let el: HTMLElement | null = node;
  while (el) {
    const details: HTMLElement | null = el.closest("details");
    if (!details) break;
    (details as HTMLDetailsElement).open = true;
    el = details.parentElement;
  }
}

export function MarkdownReader({
  source,
  header,
  footer,
  showTableOfContents = true,
  onOpenArticle,
  className,
}: MarkdownReaderProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const toc = useMemo(() => extractToc(blocks), [blocks]);
  const images = useMemo(() => collectImages(blocks), [blocks]);
  const footnotes = useMemo(() => collectFootnotes(blocks), [blocks]);
  const footnoteTargets = useMemo(() => new Set(footnotes.order), [footnotes]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lightboxOpenerRef = useRef<HTMLElement | null>(null);
  const [spyId, setSpyId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const hasToc = showTableOfContents && toc.length >= 2;
  const activeId = spyId && toc.some((entry) => entry.id === spyId) ? spyId : (toc[0]?.id ?? null);

  const nav = useMemo<ReaderNav>(
    () => ({
      onOpenArticle,
      footnoteNumbers: footnotes.numbers,
      footnoteTargets,
      openImage: (src) => {
        const index = images.findIndex((image) => image.src === src);
        if (index >= 0) {
          lightboxOpenerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setLightboxIndex(index);
        }
      },
    }),
    [onOpenArticle, images, footnotes, footnoteTargets],
  );

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    lightboxOpenerRef.current?.focus();
  }, []);

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
          // Headings inside a closed <details> have no box; skip them.
          if (heading.getClientRects().length === 0) return;
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

  // Print must never hide content: open every <details> for the duration of a
  // print job and restore the reader's own state afterwards.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let reopened: HTMLDetailsElement[] = [];

    const beforePrint = () => {
      reopened = [];
      root.querySelectorAll<HTMLDetailsElement>("details").forEach((element) => {
        if (!element.open) {
          element.open = true;
          reopened.push(element);
        }
      });
    };
    const afterPrint = () => {
      reopened.forEach((element) => {
        element.open = false;
      });
      reopened = [];
    };

    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  const jumpTo = useCallback((id: string) => {
    const node = rootRef.current?.querySelector<HTMLElement>(
      `[data-heading-id='${CSS.escape(id)}']`,
    );
    if (node) {
      revealInside(node);
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setSpyId(id);
  }, []);

  return (
    <ReaderNavContext.Provider value={nav}>
      <div
        ref={rootRef}
        className={cx(
          "w-full",
          hasToc && "xl:grid xl:grid-cols-[minmax(0,1fr)_13.5rem] xl:items-start xl:gap-10 print:block",
          className,
        )}
      >
        <article className="min-w-0 rounded-xl border border-zinc-300/70 bg-white p-8 shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_32px_-16px_rgba(16,24,40,0.18)] ring-1 ring-black/[0.04] md:p-12 print:rounded-none print:border-0 print:p-0 print:shadow-none print:ring-0">
          {header ? <header className="mb-6 border-b border-zinc-200 pb-6">{header}</header> : null}

          {hasToc ? (
            <nav
              aria-label="Jump to section"
              className="mb-8 rounded-xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-3 xl:hidden print:hidden"
            >
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
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

          <div className="max-w-3xl space-y-4 print:max-w-none">
            {blocks.map((block, index) =>
              block.kind === "footnoteDefinition" && footnotes.numbers.has(block.label)
                ? null
                : renderBlock(block, index),
            )}

            {footnotes.order.length > 0 ? (
              <section aria-label="Footnotes" className="mt-8 border-t border-zinc-200 pt-5">
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                  Footnotes
                </h2>
                <ol className="space-y-2">
                  {footnotes.order.map((label) => (
                    <li
                      key={label}
                      id={footnoteDefinitionId(label)}
                      className="scroll-mt-6 text-[14px] leading-relaxed text-zinc-700"
                    >
                      <span className="mr-1.5 font-semibold tabular-nums text-zinc-500">
                        {footnotes.numbers.get(label)}.
                      </span>
                      <InlineText text={footnotes.definitions.get(label) ?? ""} />
                      <a
                        href={`#${footnoteReferenceId(label)}`}
                        aria-label="Back to reference"
                        className="ml-1 rounded text-[#0F766E] no-underline hover:underline"
                      >
                        ↩
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>

          {footer ? <footer className="mt-10">{footer}</footer> : null}
        </article>

        {hasToc ? (
          <aside className="hidden xl:sticky xl:top-8 xl:block xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto print:hidden">
            <p className="flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              <ListTree size={14} strokeWidth={1.75} aria-hidden="true" />
              On this page
            </p>
            <nav className="mt-3" aria-label="Article sections">
              <ul className="space-y-1 border-l border-zinc-200">
                {toc.map((entry) => {
                  const isActive = entry.id === activeId;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => jumpTo(entry.id)}
                        aria-current={isActive ? "location" : undefined}
                        className={cx(
                          "-ml-px block w-full border-l-2 py-1 pr-2 text-left text-[12.5px] leading-5 transition-colors duration-150",
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

        {lightboxIndex !== null ? (
          <Lightbox
            images={images}
            index={lightboxIndex}
            onIndexChange={setLightboxIndex}
            onClose={closeLightbox}
          />
        ) : null}
      </div>
    </ReaderNavContext.Provider>
  );
}

export default MarkdownReader;
