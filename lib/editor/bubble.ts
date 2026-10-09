/**
 * When the format-on-selection bubble menu is shown, and whether it is the
 * format menu or the table-merge menu. Pure: it reads a ProseMirror
 * {@link EditorState} and the host's link-dialog flag, nothing else, so
 * `scripts/verify-frontend.ts` can build a state and assert each rule.
 *
 * Two modes:
 *
 *  - **Format menu** — a non-empty {@link TextSelection} that is not inside a
 *    code block, showing bold / italic / link / highlight / alignment.
 *  - **Table menu** — a selection inside a table (a {@link CellSelection}, or a
 *    non-empty text selection within a cell), showing only Merge / Split.
 *
 * NodeSelections (e.g. a selected image) show nothing.
 */
import { CellSelection } from "@tiptap/pm/tables";
import { TextSelection, type EditorState } from "@tiptap/pm/state";

/** True when the selection's ancestry includes a `table` node. */
export function isSelectionInTable(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === "table") return true;
  }
  return false;
}

export function shouldShowBubbleMenu(state: EditorState, linkDialogOpen: boolean): boolean {
  if (linkDialogOpen) return false;

  const { selection } = state;

  // A selection inside a table shows the merge / split actions. A bare caret
  // (collapsed, not a cell selection) shows nothing.
  if (isSelectionInTable(state)) {
    return selection instanceof CellSelection || !selection.empty;
  }

  if (selection.empty) return false;
  if (!(selection instanceof TextSelection)) return false;

  const { $from } = selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === "codeBlock") return false;
  }

  return true;
}

/** Which menu the bubble should render for the current selection. */
export type BubbleMode = "format" | "table" | "none";

export function bubbleMode(state: EditorState, linkDialogOpen: boolean): BubbleMode {
  if (!shouldShowBubbleMenu(state, linkDialogOpen)) return "none";
  return isSelectionInTable(state) ? "table" : "format";
}
