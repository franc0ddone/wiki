"use client";

import { createContext, useContext, useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import { parseInline } from "@/lib/markdown/inline";
import type { Inline } from "@/lib/markdown/inline";

/**
 * Inline markdown → React elements.
 *
 * Every node is a React element or a text string. There is no HTML string path
 * anywhere in the reader, so stored markdown can never become injected markup.
 * URLs pass an allowlist before they reach an `href` / `src`.
 */

export interface ReaderNav {
  /** Called for `/procedures/<slug>[#anchor]` links so the portal can open the article in place. */
  onOpenArticle?: (slug: string, anchor?: string) => boolean | void;
  /** Open the lightbox on the image with this `src`. */
  openImage?: (src: string) => void;
}

export const ReaderNavContext = createContext<ReaderNav>({});

/** Only schemes that are safe to render as a link target. */
export function safeHref(href: string): string | undefined {
  const value = href.trim();
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("#")) return value;
  // Site-relative only: `//host/path` is a protocol-relative external URL.
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return undefined;
}

/** Images may come from an https/http origin (object storage) or the site itself. */
export function safeImageSrc(src: string): string | undefined {
  const value = src.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return undefined;
}

const PROCEDURE_PREFIX = "/procedures/";

function renderNodes(nodes: readonly Inline[], nav: ReaderNav, keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.t) {
      case "text":
        return node.v;
      case "code":
        return (
          <code
            key={key}
            className="rounded-[5px] border border-zinc-200 bg-zinc-50 px-1.5 py-px font-mono text-[0.84em] font-medium text-teal-800"
          >
            {node.v}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="font-semibold text-zinc-900">
            {renderNodes(node.c, nav, `${key}.`)}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="italic text-zinc-800">
            {renderNodes(node.c, nav, `${key}.`)}
          </em>
        );
      case "image": {
        const src = safeImageSrc(node.src);
        // eslint-disable-next-line @next/next/no-img-element -- origin is the hospital's object store, not a known next/image domain
        return src ? <img key={key} src={src} alt={node.alt} loading="lazy" className="inline-block max-h-64 rounded-md" /> : node.alt;
      }
      case "link": {
        const href = safeHref(node.href);
        const label = renderNodes(node.c, nav, `${key}.`);
        if (!href) return <span key={key}>{label}</span>;

        const isExternal = /^https?:/i.test(href);
        const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
          if (event.defaultPrevented || event.button !== 0) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

          if (href.startsWith(PROCEDURE_PREFIX) && nav.onOpenArticle) {
            const [slug, anchor] = href.slice(PROCEDURE_PREFIX.length).split("#", 2);
            if (slug) {
              // `false` means "not found here": leave the link to the browser.
              if (nav.onOpenArticle(slug, anchor || undefined) !== false) event.preventDefault();
            }
            return;
          }

          if (href.startsWith("#") && href.length > 1) {
            // A target inside a collapsed block would not scroll into view.
            let el: HTMLElement | null = document.getElementById(decodeURIComponent(href.slice(1)));
            while (el) {
              const details = el.closest("details");
              if (!details) break;
              details.open = true;
              el = details.parentElement;
            }
          }
        };

        return (
          <a
            key={key}
            href={href}
            onClick={handleClick}
            {...(isExternal ? { rel: "noopener noreferrer" } : {})}
            className="font-medium text-[#0F766E] underline decoration-teal-600/30 underline-offset-[3px] transition-colors hover:decoration-teal-600"
          >
            {label}
          </a>
        );
      }
      default:
        return null;
    }
  });
}

export function InlineText({ text }: { text: string }) {
  const nav = useContext(ReaderNavContext);
  const nodes = useMemo(() => parseInline(text), [text]);
  return <>{renderNodes(nodes, nav, "i")}</>;
}
