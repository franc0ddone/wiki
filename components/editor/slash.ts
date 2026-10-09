"use client";

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps } from "@tiptap/suggestion";
import { SlashMenu } from "@/components/editor/SlashMenu";
import type { SlashMenuHandle, SlashMenuProps } from "@/components/editor/SlashMenu";
import { filterSlashItems } from "@/components/editor/slashItems";
import type { SlashItem } from "@/components/editor/slashItems";

/**
 * The `/` command menu, implemented as a `@tiptap/suggestion` plugin.
 *
 * It fires only at the very start of an *empty* paragraph or heading block —
 * `parentOffset === 0` and the block is a paragraph/heading — which is why
 * clinical prose like "1 / 2" never opens it, and why it can never open inside
 * a code block (whose node type is neither).
 *
 * The item list, the filtering and the per-command behaviour all live in
 * `slashItems.ts`; this file only wires the suggestion lifecycle to the
 * {@link SlashMenu} listbox. The host callbacks (`onImage`, `onLink`) come from
 * `buildEditorExtensions({ onLink, onImage })` because the dialog state lives in
 * the host, not the editor.
 */

export interface SlashCommandsOptions {
  onImage: () => void;
  onLink: () => void;
}

const SLASH_PLUGIN_KEY = new PluginKey("slashCommands");

function slashMenuProps(props: SuggestionProps<SlashItem, SlashItem>) {
  return {
    items: props.items,
    command: (item: SlashItem) => props.command(item),
  };
}

/** The `/` is at the start of an empty paragraph or heading block. */
function isSlashContext(editor: Editor, from: number): boolean {
  const $from = editor.state.doc.resolve(from);
  const parent = $from.parent;
  if (parent.type.name !== "paragraph" && parent.type.name !== "heading") return false;
  return $from.parentOffset === 0;
}

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: "slashCommands",

  addOptions() {
    return { onImage: () => {}, onLink: () => {} };
  },

  addProseMirrorPlugins() {
    const { onImage, onLink } = this.options;
    const editor = this.editor;

    return [
      Suggestion<SlashItem, SlashItem>({
        editor,
        pluginKey: SLASH_PLUGIN_KEY,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        // The position rule below is the gate; the prefix rule would also block
        // a `/` at the very start of a block, which is exactly where we want it.
        allowedPrefixes: null,
        items: ({ query }) => filterSlashItems(query),
        allow: ({ range }) => isSlashContext(editor, range.from),
        command: ({ editor: current, range, props }) => {
          props.run({ editor: current, range, onImage, onLink });
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null = null;
          let unmount: (() => void) | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer<SlashMenuHandle, SlashMenuProps>(SlashMenu, {
                editor: props.editor,
                props: slashMenuProps(props),
              });
              unmount = props.mount(component.element);
            },
            onUpdate: (props) => {
              component?.updateProps(slashMenuProps(props));
            },
            onKeyDown: (props) => {
              // Escape is the suggestion plugin's to handle (it dismisses the menu).
              if (props.event.key === "Escape") return false;
              return component?.ref?.onKeyDown({ event: props.event }) ?? false;
            },
            onExit: () => {
              unmount?.();
              unmount = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});

export default SlashCommands;
