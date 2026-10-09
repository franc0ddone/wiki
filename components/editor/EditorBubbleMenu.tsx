"use client";

import type { ComponentType } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Highlighter, Italic, Link2 } from "lucide-react";
import { BUBBLE_FORMAT_ORDER, FORMAT_COMMANDS } from "@/components/editor/formatCommands";
import type { FormatCommandId } from "@/components/editor/formatCommands";
import { shouldShowBubbleMenu } from "@/lib/editor/bubble";
import { cx } from "@/lib/utils";

/**
 * Format-on-selection popup. Exactly bold, italic, link, highlight and
 * alignment — no extra items — and every button calls the same
 * `formatCommands.ts` function the toolbar uses, so the two cannot drift.
 *
 * Visibility is decided by the pure `shouldShowBubbleMenu`: a non-empty
 * TextSelection, not in a code block, and not while the link dialog is open
 * (`linkDialogOpen` is owned by the host, so it is passed in).
 */

const ICONS: Record<FormatCommandId, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  bold: Bold,
  italic: Italic,
  highlight: Highlighter,
  alignLeft: AlignLeft,
  alignCenter: AlignCenter,
  alignRight: AlignRight,
  alignJustify: AlignJustify,
  link: Link2,
};

export function EditorBubbleMenu({
  editor,
  linkDialogOpen,
  onLink,
}: {
  editor: Editor;
  linkDialogOpen: boolean;
  onLink: () => void;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const result: Partial<Record<FormatCommandId, boolean>> = {};
      for (const id of BUBBLE_FORMAT_ORDER) result[id] = FORMAT_COMMANDS[id].isActive(current);
      return result;
    },
  });

  return (
    <BubbleMenu
      editor={editor}
      data-testid="bubble-menu"
      shouldShow={({ state }) => shouldShowBubbleMenu(state, linkDialogOpen)}
      options={{ placement: "top", offset: 8 }}
      className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.28),0_2px_6px_rgba(24,24,27,0.08)]"
    >
      {BUBBLE_FORMAT_ORDER.map((id) => {
        const command = FORMAT_COMMANDS[id];
        const Icon = ICONS[id];
        const isActive = active[id] ?? false;
        return (
          <button
            key={id}
            type="button"
            aria-label={command.label}
            aria-pressed={isActive}
            title={command.shortcut ? `${command.label} (${command.shortcut})` : command.label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => (id === "link" ? onLink() : command.run(editor))}
            className={cx(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40",
              isActive ? "bg-teal-50 text-[#0F766E] ring-1 ring-inset ring-teal-600/25" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
            )}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        );
      })}
    </BubbleMenu>
  );
}

export default EditorBubbleMenu;
