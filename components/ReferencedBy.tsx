"use client";

import { useEffect, useState } from "react";
import { FileText, Link2, Megaphone } from "lucide-react";

/**
 * "Referenced by" — impact analysis before editing or retiring a procedure.
 * Lists the articles and bulletins whose markdown links here, from
 * `GET /api/articles/[slug]/backlinks`.
 */

interface Backlink {
  kind: "article" | "bulletin";
  id: string;
  title: string;
  slug: string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; links: Backlink[] };

export function ReferencedBy({
  slug,
  onOpenArticleBySlug,
  onOpenBulletin,
}: {
  slug: string;
  onOpenArticleBySlug: (slug: string) => void;
  onOpenBulletin: (id: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/articles/${encodeURIComponent(slug)}/backlinks`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setState({
            status: "error",
            message:
              response.status === 401
                ? "Sign in to see what references this procedure."
                : (body?.error ?? `References could not be loaded (${response.status}).`),
          });
          return;
        }
        setState({ status: "ready", links: (await response.json()) as Backlink[] });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "References could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [slug]);

  return (
    <section aria-labelledby={`referenced-by-${slug}`} className="print:hidden">
      <h2
        id={`referenced-by-${slug}`}
        className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500"
      >
        <Link2 size={13} strokeWidth={1.75} aria-hidden="true" />
        Referenced by
      </h2>

      {state.status === "loading" ? (
        <p className="text-[13px] text-zinc-500" role="status">
          Checking references…
        </p>
      ) : null}
      {state.status === "error" ? <p className="text-[13px] text-zinc-500">{state.message}</p> : null}
      {state.status === "ready" && state.links.length === 0 ? (
        <p className="text-[13px] text-zinc-500">
          Nothing links to this procedure, so changing or retiring it affects no other page.
        </p>
      ) : null}
      {state.status === "ready" && state.links.length > 0 ? (
        <>
          <p className="mb-2 text-[12.5px] text-zinc-500">
            {state.links.length} {state.links.length === 1 ? "page links" : "pages link"} here. Check them before
            renaming or retiring this procedure.
          </p>
          <ul className="space-y-1.5">
            {state.links.map((link) => (
              <li key={`${link.kind}-${link.id}`}>
                <button
                  type="button"
                  onClick={() => (link.kind === "article" && link.slug ? onOpenArticleBySlug(link.slug) : onOpenBulletin(link.id))}
                  className="group flex w-full items-center gap-3 rounded-[10px] border border-zinc-300/60 bg-white px-3.5 py-2.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-teal-600/40 hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 group-hover:border-teal-200 group-hover:text-[#0F766E]">
                    {link.kind === "article" ? (
                      <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <Megaphone size={13} strokeWidth={1.75} aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-zinc-900">{link.title}</span>
                  <span className="shrink-0 text-xs font-medium text-zinc-500">
                    {link.kind === "article" ? "Procedure" : "Bulletin"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
