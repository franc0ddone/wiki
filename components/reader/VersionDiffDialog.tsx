"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitCompareArrows, X } from "lucide-react";
import { collapseDiff, diffLines, summarizeDiff } from "@/lib/markdown/diff";
import { cx, formatDateTime } from "@/lib/utils";

/**
 * Version-to-version diff (prompt 7a, item 1).
 *
 * Reads the article's immutable publish history (`GET /api/articles/[slug]/versions`)
 * and renders a clean unified diff between any two versions — defaulting to the
 * reader's `last_seen_version` against the current latest. Versions are
 * permanent records, so nothing here edits or restores them.
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

export function VersionDiffDialog({
  slug,
  articleTitle,
  fromVersion,
  toVersion,
  onClose,
}: {
  slug: string;
  articleTitle: string;
  fromVersion: number;
  toVersion: number;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [from, setFrom] = useState(fromVersion);
  const [to, setTo] = useState(toVersion);
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
          setState({
            status: "error",
            message:
              response.status === 401
                ? "Sign in to view version changes."
                : (body?.error ?? `Changes could not be loaded (${response.status}).`),
          });
          return;
        }
        setState({ status: "ready", versions: (await response.json()) as ArticleVersion[] });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setState({ status: "error", message: "Changes could not be loaded. Check your connection." });
      }
    })();
    return () => controller.abort();
  }, [slug]);

  // Move focus in on open, restore it on close (same contract as the history dialog).
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
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex='-1'])",
        ),
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
    [onClose],
  );

  const versions = useMemo(
    () => (state.status === "ready" ? state.versions : []),
    [state],
  );
  // Newest first, which is how the API returns them.
  const ordered = useMemo(
    () => [...versions].sort((a, b) => b.version - a.version),
    [versions],
  );

  const result = useMemo(() => {
    if (state.status !== "ready") return null;
    const before = versions.find((version) => version.version === from);
    const after = versions.find((version) => version.version === to);
    if (!before || !after) return null;
    const lines = collapseDiff(diffLines(before.body_markdown, after.body_markdown));
    return { lines, summary: summarizeDiff(lines.filter((line) => !line.elided)) };
  }, [state.status, versions, from, to]);

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
        aria-labelledby="version-diff-title"
        onKeyDown={handleKeyDown}
        className="flex h-[min(46rem,90dvh)] w-full max-w-[64rem] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_24px_64px_-16px_rgba(24,24,27,0.35)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id="version-diff-title"
              className="flex items-center gap-2 text-[15px] font-semibold text-zinc-900"
            >
              <GitCompareArrows size={16} strokeWidth={1.75} aria-hidden="true" className="text-[#5F6E00]" />
              Changes {from !== to ? `· v${from} → v${to}` : ""}
            </h2>
            <span className="mt-0.5 block truncate text-[12.5px] text-zinc-500">{articleTitle}</span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close changes"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35"
          >
            <X size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

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

        {state.status === "ready" ? (
          versions.length < 2 ? (
            <div className="p-5">
              <p className="text-[13.5px] font-semibold text-zinc-800">Nothing to compare yet</p>
              <p className="mt-1 text-[12.5px] leading-5 text-zinc-500">
                A version is recorded each time this procedure is published. There is only one
                version so far.
              </p>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-[#F7F7F8] px-5 py-3">
                <label className="flex items-center gap-2 text-[12.5px] text-zinc-600">
                  From
                  <select
                    value={from}
                    onChange={(event) => setFrom(Number(event.target.value))}
                    className="h-7 rounded-md border border-zinc-300/70 bg-white px-2 text-[12.5px] text-zinc-900 focus:border-[#5F6E00]/40 focus:outline-none focus:ring-2 focus:ring-[#5F6E00]/15"
                  >
                    {ordered.map((version) => (
                      <option key={version.id} value={version.version}>
                        v{version.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-zinc-600">
                  To
                  <select
                    value={to}
                    onChange={(event) => setTo(Number(event.target.value))}
                    className="h-7 rounded-md border border-zinc-300/70 bg-white px-2 text-[12.5px] text-zinc-900 focus:border-[#5F6E00]/40 focus:outline-none focus:ring-2 focus:ring-[#5F6E00]/15"
                  >
                    {ordered.map((version) => (
                      <option key={version.id} value={version.version}>
                        v{version.version}
                      </option>
                    ))}
                  </select>
                </label>
                {result ? (
                  <p className="ml-auto flex items-center gap-3 text-[12px] tabular-nums text-zinc-500">
                    <span className="font-medium text-[#5F6E00]">+{result.summary.added} added</span>
                    <span className="font-medium text-red-600">−{result.summary.removed} removed</span>
                  </p>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {result ? (
                  <ul className="py-1 font-mono text-[12.5px]">
                    {result.lines.map((line, index) =>
                      line.elided ? (
                        <li
                          key={index}
                          className="flex items-center gap-3 bg-zinc-50 px-4 py-1 text-[11.5px] text-zinc-400"
                        >
                          <span aria-hidden="true" className="select-none">
                            ⋯
                          </span>
                          {line.elided} unchanged {line.elided === 1 ? "line" : "lines"}
                        </li>
                      ) : (
                        <li
                          key={index}
                          className={cx(
                            "flex gap-3 px-4 py-0.5",
                            line.op === "add" && "bg-[#E6EBA5]/40",
                            line.op === "remove" && "bg-red-50/70",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cx(
                              "w-3 shrink-0 select-none text-center font-semibold",
                              line.op === "add"
                                ? "text-[#5F6E00]"
                                : line.op === "remove"
                                  ? "text-red-500"
                                  : "text-transparent",
                            )}
                          >
                            {line.op === "add" ? "+" : line.op === "remove" ? "−" : "·"}
                          </span>
                          <code className="min-w-0 whitespace-pre-wrap break-words leading-5 text-zinc-800">
                            {line.op === "add" ? <span className="sr-only">Added: </span> : null}
                            {line.op === "remove" ? <span className="sr-only">Removed: </span> : null}
                            {line.text.length > 0 ? line.text : " "}
                          </code>
                        </li>
                      ),
                    )}
                  </ul>
                ) : (
                  <p className="p-5 text-[13px] text-zinc-500">Pick two versions to compare.</p>
                )}
              </div>

              {result && versions.length > 0 ? (
                <p className="shrink-0 border-t border-zinc-200 px-5 py-2 text-[11.5px] text-zinc-400">
                  v{from} published {formatDateTime(versions.find((v) => v.version === from)?.created_at ?? "")} ·
                  v{to} published {formatDateTime(versions.find((v) => v.version === to)?.created_at ?? "")}
                </p>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </div>
  );
}
