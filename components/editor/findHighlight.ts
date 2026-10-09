"use client";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { findMatches } from "@/lib/editor/find";

/**
 * Find-match decorations.
 *
 * Matches are drawn with ProseMirror decorations only — never written into the
 * document — so they can never reach the Markdown serializer, and the active
 * match gets its own class, distinct from the `highlight` mark's `<mark>`.
 *
 * The bar drives it through two commands; the plugin state is a metadata-only
 * transaction, so it does not disturb the document or the undo history.
 */

export interface FindHighlightState {
  query: string;
  matchCase: boolean;
  activeIndex: number;
}

const EMPTY: FindHighlightState = { query: "", matchCase: false, activeIndex: 0 };

const findPluginKey = new PluginKey<FindHighlightState>("findHighlight");

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findHighlight: {
      /** Highlight every match of `query`; `activeIndex` gets the active class. */
      setFindHighlight: (state: FindHighlightState) => ReturnType;
      /** Remove all find decorations. */
      clearFindHighlight: () => ReturnType;
    };
  }
}

export const FindHighlight = Extension.create({
  name: "findHighlight",

  addCommands() {
    return {
      setFindHighlight:
        (next) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findPluginKey, next);
          return true;
        },
      clearFindHighlight:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findPluginKey, EMPTY);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindHighlightState>({
        key: findPluginKey,
        state: {
          init: () => EMPTY,
          apply: (tr, value) => (tr.getMeta(findPluginKey) as FindHighlightState | undefined) ?? value,
        },
        props: {
          decorations(state) {
            const current = findPluginKey.getState(state);
            if (!current || current.query.length === 0) return null;
            const matches = findMatches(state.doc, current.query, current.matchCase);
            if (matches.length === 0) return null;
            const active = Math.min(current.activeIndex, matches.length - 1);
            return DecorationSet.create(
              state.doc,
              matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === active ? "dw-find-active" : "dw-find-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});

export default FindHighlight;
