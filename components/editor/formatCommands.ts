/**
 * The formatting commands the toolbar and the bubble menu share.
 *
 * Both surfaces used to inline their own `chain().toggleBold().run()` calls in
 * JSX, which is how the two drift apart. Here each command has exactly one
 * definition — `isActive` and `run` — and both surfaces render from
 * {@link FORMAT_COMMANDS}. The module is DOM-free (it only touches the editor
 * through its chainable command API at call time), so
 * `scripts/verify-frontend.ts` can import it and assert the surfaces agree.
 */
import type { Editor } from "@tiptap/react";
import type { TextAlignment } from "@/lib/markdown/block-attributes";

export type FormatCommandId =
  | "bold"
  | "italic"
  | "link"
  | "highlight"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "alignJustify";

export interface FormatCommand {
  id: FormatCommandId;
  label: string;
  /** Printed by the toolbar's tooltip; omitted where there is no shortcut. */
  shortcut?: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

/* -------------------------------------------------------- the primitives */

export function bold(editor: Editor): void {
  editor.chain().focus().toggleBold().run();
}

export function italic(editor: Editor): void {
  editor.chain().focus().toggleItalic().run();
}

export function highlight(editor: Editor): void {
  editor.chain().focus().toggleHighlight().run();
}

export function align(editor: Editor, value: TextAlignment): void {
  editor.chain().focus().toggleTextAlign(value).run();
}

/* ----------------------------------------------------------- the registry */

export const FORMAT_COMMANDS: Record<FormatCommandId, FormatCommand> = {
  bold: {
    id: "bold",
    label: "Bold",
    shortcut: "Ctrl+B",
    isActive: (editor) => editor.isActive("bold"),
    run: bold,
  },
  italic: {
    id: "italic",
    label: "Italic",
    shortcut: "Ctrl+I",
    isActive: (editor) => editor.isActive("italic"),
    run: italic,
  },
  link: {
    id: "link",
    label: "Link",
    isActive: (editor) => editor.isActive("link"),
    // The link dialog lives in the host, so "run" is wired by the caller.
    run: () => {},
  },
  highlight: {
    id: "highlight",
    label: "Highlight",
    shortcut: "Ctrl+Shift+H",
    isActive: (editor) => editor.isActive("highlight"),
    run: highlight,
  },
  alignLeft: {
    id: "alignLeft",
    label: "Align left",
    shortcut: "Ctrl+Shift+L",
    isActive: (editor) => editor.isActive({ textAlign: "left" }),
    run: (editor) => align(editor, "left"),
  },
  alignCenter: {
    id: "alignCenter",
    label: "Align center",
    shortcut: "Ctrl+Shift+E",
    isActive: (editor) => editor.isActive({ textAlign: "center" }),
    run: (editor) => align(editor, "center"),
  },
  alignRight: {
    id: "alignRight",
    label: "Align right",
    shortcut: "Ctrl+Shift+R",
    isActive: (editor) => editor.isActive({ textAlign: "right" }),
    run: (editor) => align(editor, "right"),
  },
  alignJustify: {
    id: "alignJustify",
    label: "Justify",
    shortcut: "Ctrl+Shift+J",
    isActive: (editor) => editor.isActive({ textAlign: "justify" }),
    run: (editor) => align(editor, "justify"),
  },
};

/** The order the toolbar renders. */
export const TOOLBAR_FORMAT_ORDER: readonly FormatCommandId[] = [
  "bold",
  "italic",
  "highlight",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignJustify",
  "link",
];

/** The order the bubble menu renders: exactly bold, italic, link, highlight, alignment. */
export const BUBBLE_FORMAT_ORDER: readonly FormatCommandId[] = [
  "bold",
  "italic",
  "link",
  "highlight",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignJustify",
];

export function formatCommandsFor(order: readonly FormatCommandId[]): FormatCommand[] {
  return order.map((id) => FORMAT_COMMANDS[id]);
}
