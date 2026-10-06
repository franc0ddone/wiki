"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, History, Lock, X } from "lucide-react";
import { MarkdownReader } from "@/components/MarkdownReader";
import { cx, formatDateTime } from "@/lib/utils";

/**
 * Version history for one article.
 *
 * Lists `GET /api/articles/[slug]/versions` (newest first) and renders a
 * selected version's `body_markdown` read-only through `MarkdownReader`.
 *
 * Versions are immutable (a database trigger refuses UPDATE and DELETE), so
 * nothing in this dialog offers to edit, restore, or delete one. A published
 * article changes by being edited and republished, which writes a *new*
 * version.
 */

interface ArticleVersion {
  id: string;
  version: number;
  title: string;
  body_markdown: string;
  change_summary: string;
  changed_by_name: string;
  created_at: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; versions: ArticleVersion[] };

export function VersionHistoryDialog({
  slug,
  articleTitle,
  onClose,
}: {
  slug: string;
  articleTitle: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/articles/${encodeURIComponent(slug)}/versions`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          const message =
            response.status === 401
              ? "Sign in to view version history."
              : (body?.error ?? `Version history could not be loaded (${response.status}).`);
          setState({ status: "error", message });
          return;
        }
        const versions = (await response.json()) as ArticleVersion[];
        setState({ status: "ready", versions });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "Version history could not be loaded. Check your connection." });
      }
    })();
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      openerRef.current?.focus?.();
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.nativeEvent.stopPropagation();
        if (selectedId) setSelectedId(null);
        else onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, [tabindex]:not([tabindex='-1'])"),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose, selectedId],
  );

  const versions = state.status === "ready" ? state.versions : [];
  const selected = versions.find((version) => version.id === selectedId) ?? null;
  const latest = versions[0]?.version;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-4 backdrop-blur-[2px] print:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        onKeyDown={handleKeyDown}
        className="flex h-[min(46rem,90dvh)] w-full max-w-[64rem] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_64px_-16px_rgba(24,24,27,0.35)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2 id="version-history-title" className="flex items-center gap-2 text-[15px] font-semibold text-zinc-900">
              <History size={16} strokeWidth={1.75} aria-hidden="true" className="text-[#0F766E]" />
              Version history
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-zinc-500">{articleTitle}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close version history"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Version list */}
          <div
            className={cx(
              "min-h-0 w-full shrink-0 overflow-y-auto border-zinc-200 bg-[#F7F7F8] md:block md:w-80 md:border-r",
              selected ? "hidden" : "block",
            )}
          >
            {state.status === "loading" ? (
              <p className="p-5 text-[13px] text-zinc-500" role="status">
                Loading versions…
              </p>
            ) : null}
            {state.status === "error" ? (
              <p className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800" role="alert">
                {state.message}
              </p>
            ) : null}
            {state.status === "ready" && versions.length === 0 ? (
              <div className="p-5">
                <p className="text-[13.5px] font-semibold text-zinc-800">No published versions yet</p>
                <p className="mt-1 text-[12.5px] leading-5 text-zinc-500">
                  A version is recorded each time this procedure is published or republished.
                </p>
              </div>
            ) : null}
            {versions.length > 0 ? (
              <ul className="space-y-1.5 p-2.5">
                {versions.map((version) => {
                  const isSelected = version.id === selectedId;
                  return (
                    <li key={version.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(version.id)}
                        aria-current={isSelected ? "true" : undefined}
                        className={cx(
                          "w-full rounded-[10px] border px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/35",
                          isSelected
                            ? "border-teal-600/40 bg-teal-50/70"
                            : "border-zinc-300/60 bg-white hover:border-zinc-400",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-[13px] font-semibold text-zinc-900">
                            Version {version.version}
                            {version.version === latest ? (
                              <span className="rounded-full border border-teal-200 bg-teal-50 px-1.5 py-px text-xs font-semibold text-teal-800">
                                Latest
                              </span>
                            ) : null}
                          </span>
                          <time dateTime={version.created_at} className="text-xs tabular-nums text-zinc-500">
                            {formatDateTime(version.created_at)}
                          </time>
                        </span>
                        <span className="mt-1 block truncate text-xs text-zinc-500">{version.changed_by_name}</span>
                        <span className="mt-1.5 line-clamp-2 block text-[12.5px] leading-[1.45] text-zinc-700">
                          {version.change_summary}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {/* Read-only preview */}
          <div className={cx("min-h-0 min-w-0 flex-1 flex-col bg-[#F4F4F5]", selected ? "flex" : "hidden md:flex")}>
            {selected ? (
              <>
                <div className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-amber-50/70 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[#0F766E] transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 md:hidden"
                  >
                    <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
                    Versions
                  </button>
                  <p className="flex items-center gap-2 text-[12.5px] leading-5 text-amber-900">
                    <Lock size={13} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                    <span>
                      <strong className="font-semibold">Version {selected.version} — read-only.</strong> Published
                      versions are permanent records and cannot be edited.
                    </span>
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
                  <MarkdownReader
                    source={selected.body_markdown}
                    showTableOfContents={false}
                    header={
                      <div>
                        <h3 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-zinc-900">
                          {selected.title}
                        </h3>
                        <p className="mt-2 text-[13px] text-zinc-500">
                          {selected.changed_by_name} · {formatDateTime(selected.created_at)}
                        </p>
                        <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] leading-5 text-zinc-700">
                          <span className="font-semibold text-zinc-900">Change summary: </span>
                          {selected.change_summary}
                        </p>
                      </div>
                    }
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <p className="max-w-xs text-[13px] leading-5 text-zinc-500">
                  Select a version to read exactly what was published.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
