"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Editor } from "@tiptap/react";
import { CaseSensitive, ChevronDown, ChevronUp, Replace, ReplaceAll, Search, X } from "lucide-react";
import { findMatches, replaceAllInDoc, stepMatchIndex } from "@/lib/editor/find";
import { useIsApplePlatform } from "@/lib/platform";
import { cx } from "@/lib/utils";

/**
 * Find & replace, scoped to the current document. Opened by Ctrl+H (routed
 * through `useIsApplePlatform` for the hint), it lives in the host next to the
 * editor.
 *
 * - Search covers every text node — code blocks, callouts and collapsed details
 *   bodies included — because they are all ordinary text nodes. Image
 *   attributes are node attributes, not text, so they are never replaced.
 * - Matches are drawn by the `findHighlight` extension (decorations only).
 * - Replace-all is a single transaction, so it is one undo step. Replacement is
 *   a literal string, never parsed as Markdown.
 * - Esc closes and restores the selection that was live when the bar opened —
 *   unless a replace moved it, in which case the post-replace position is kept
 *   (and the bar says so).
 */

export interface FindReplaceBarProps {
  editor: Editor;
  onClose: () => void;
}

export function FindReplaceBar({ editor, onClose }: FindReplaceBarProps) {
  const isApple = useIsApplePlatform();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const [replaced, setReplaced] = useState(false);

  const findInputRef = useRef<HTMLInputElement | null>(null);
  // The selection to restore on Esc, captured once when the bar mounts.
  const restoreRef = useRef(editor.state.selection);

  useEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  // Recompute matches when the document or the selection changes.
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    editor.on("update", bump);
    editor.on("selectionUpdate", bump);
    return () => {
      editor.off("update", bump);
      editor.off("selectionUpdate", bump);
    };
  }, [editor]);

  const matches = useMemo(
    () => findMatches(editor.state.doc, query, matchCase),
    // `tick` is the document-change signal; the rest are the query inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, query, matchCase, tick],
  );

  const total = matches.length;
  const safeIndex = total === 0 ? 0 : Math.min(activeIndex, total - 1);
  const activeMatch = total > 0 ? matches[safeIndex] : null;

  // Push decorations, and clear them when the bar unmounts.
  useEffect(() => {
    editor.commands.setFindHighlight({ query, matchCase, activeIndex: safeIndex });
    return () => {
      editor.commands.clearFindHighlight();
    };
  }, [editor, query, matchCase, safeIndex]);

  const selectMatch = useCallback(
    (match: { from: number; to: number } | null) => {
      if (!match) return;
      // Set the selection without stealing focus from the find input.
      editor.commands.setTextSelection({ from: match.from, to: match.to });
      editor.commands.scrollIntoView();
    },
    [editor],
  );

  const goTo = useCallback(
    (delta: number) => {
      if (total === 0) return;
      const next = stepMatchIndex(safeIndex, delta, total);
      setActiveIndex(next);
      selectMatch(matches[next] ?? null);
    },
    [matches, safeIndex, total, selectMatch],
  );

  const replaceCurrent = useCallback(() => {
    if (!activeMatch) return;
    // A literal replacement, applied directly to the document (no Markdown parsing).
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        tr.replaceWith(activeMatch.from, activeMatch.to, editor.schema.text(replacement));
        if (dispatch) dispatch(tr);
        return true;
      })
      .run();
    setReplaced(true);
    editor.commands.focus();
  }, [activeMatch, editor, replacement]);

  const replaceAll = useCallback(() => {
    if (query.length === 0 || total === 0) return;
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        const { doc: next, count } = replaceAllInDoc(tr.doc, query, replacement, matchCase);
        if (count === 0) return false;
        // One transaction → one undo step.
        tr.replaceWith(0, tr.doc.content.size, next.content);
        if (dispatch) dispatch(tr);
        return true;
      })
      .run();
    setReplaced(true);
    setActiveIndex(0);
    editor.commands.focus();
  }, [editor, matchCase, query, replacement, total]);

  const close = useCallback(() => {
    if (!replaced) {
      // Nothing moved the selection: put it back exactly where it was.
      editor.commands.setTextSelection(restoreRef.current.from);
      editor.commands.focus();
    }
    onClose();
  }, [editor, onClose, replaced]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      goTo(1);
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      goTo(-1);
    }
  };

  const counter = total === 0 ? (query.length === 0 ? "" : "No matches") : `${safeIndex + 1} of ${total}`;

  return (
    <div
      role="search"
      aria-label="Find and replace"
      data-testid="find-bar"
      onKeyDown={onKeyDown}
      className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50/90 px-3 py-2"
    >
      <div className="relative flex items-center">
        <Search size={14} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-zinc-400" />
        <input
          ref={findInputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          placeholder="Find"
          aria-label="Find"
          data-testid="find-input"
          className="h-8 w-52 rounded-md border border-zinc-300/70 bg-white pl-8 pr-2 text-[13px] text-zinc-900 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
        />
      </div>

      <span className="min-w-[3.5rem] text-xs tabular-nums text-zinc-500" aria-live="polite">
        {counter}
      </span>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => goTo(-1)}
          disabled={total === 0}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-200/70 disabled:opacity-35"
        >
          <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => goTo(1)}
          disabled={total === 0}
          aria-label="Next match"
          title="Next match (Enter)"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-200/70 disabled:opacity-35"
        >
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        aria-pressed={matchCase}
        onClick={() => {
          setMatchCase((value) => !value);
          setActiveIndex(0);
        }}
        aria-label="Match case"
        title="Match case"
        className={cx(
          "flex h-8 w-8 items-center justify-center rounded-md",
          matchCase ? "bg-teal-50 text-[#0F766E] ring-1 ring-inset ring-teal-600/25" : "text-zinc-600 hover:bg-zinc-200/70",
        )}
      >
        <CaseSensitive size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>

      <span aria-hidden="true" className="mx-1 h-5 w-px bg-zinc-300" />

      <input
        value={replacement}
        onChange={(event) => setReplacement(event.target.value)}
        placeholder="Replace with"
        aria-label="Replace with"
        data-testid="replace-input"
        className="h-8 w-52 rounded-md border border-zinc-300/70 bg-white px-2 text-[13px] text-zinc-900 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
      />
      <button
        type="button"
        onClick={replaceCurrent}
        disabled={total === 0}
        className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-300/70 bg-white px-2.5 text-[13px] font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-40"
      >
        <Replace size={14} strokeWidth={1.75} aria-hidden="true" />
        Replace
      </button>
      <button
        type="button"
        onClick={replaceAll}
        disabled={total === 0}
        className="flex h-8 items-center gap-1.5 rounded-md border border-zinc-300/70 bg-white px-2.5 text-[13px] font-medium text-zinc-700 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-40"
      >
        <ReplaceAll size={14} strokeWidth={1.75} aria-hidden="true" />
        Replace all
      </button>

      {replaced ? (
        <span className="text-xs text-zinc-500" role="status">
          Selection kept at the last replacement.
        </span>
      ) : null}

      <span className="ml-auto hidden text-xs text-zinc-400 sm:inline">{isApple ? "⌘H" : "Ctrl+H"} closes</span>
      <button
        type="button"
        onClick={close}
        aria-label="Close find and replace"
        className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-200/70"
      >
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

export default FindReplaceBar;
