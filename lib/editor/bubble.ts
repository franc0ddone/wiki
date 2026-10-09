/**
 * When the format-on-selection bubble menu is shown. Pure: it reads a
 * ProseMirror {@link EditorState} and the host's link-dialog flag, nothing else,
 * so `scripts/verify-frontend.ts` can build a state and assert each rule.
 *
 * The menu is shown only for a non-empty {@link TextSelection} that is not
 * inside a code block and not while the link dialog is open. NodeSelections
 * (e.g. a selected image) and table cell selections are not TextSelections, so
 * they fall out automatically.
 */
import { TextSelection, type EditorState } from "@tiptap/pm/state";

export function shouldShowBubbleMenu(state: EditorState, linkDialogOpen: boolean): boolean {
  if (linkDialogOpen) return false;

  const { selection } = state;
  if (selection.empty) return false;
  if (!(selection instanceof TextSelection)) return false;

  const { $from } = selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === "codeBlock") return false;
  }

  return true;
}
