import type { ResolvedPos } from "@tiptap/pm/model";

/**
 * The grip element the drag handle extension positions in the gutter.
 *
 * Kept as a plain DOM factory (not a React component) because the extension's
 * `render()` returns a raw element it manages itself. The `data-drag-handle`
 * hook marks it for styling; the handle never fights an image's own native
 * drag because the two are separate elements.
 *
 * The two `nested.rules` predicates below are the pure half of this module:
 * they take only a candidate node and its resolved position, so
 * `scripts/verify-frontend.ts` can unit-check the drag-targeting logic without a
 * browser. `components/editor/extensions.tsx` imports them into
 * `DragHandle.configure({ nested: { rules: [...] } })`.
 */
export function createDragHandleElement(): HTMLElement {
  const handle = document.createElement("div");
  handle.setAttribute("data-drag-handle", "");
  handle.setAttribute("data-testid", "drag-handle");
  handle.setAttribute("aria-hidden", "true");
  handle.setAttribute("title", "Drag to move this block");
  handle.className = "dw-drag-handle";
  handle.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/>' +
    '<circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>' +
    "</svg>";
  return handle;
}

/** The shape `@tiptap/extension-drag-handle`'s nested `evaluate` receives. */
export interface DragRuleArgs {
  node: { type: { name: string } };
  $pos: ResolvedPos;
}

/** The block names the handle must never target (footnotes and table structure). */
const UNTARGETABLE = new Set(["table", "tableRow", "tableCell", "tableHeader"]);

/** The wrapper blocks that drag as one unit, never their inner blocks. */
const WRAPPER_BLOCKS = new Set(["callout", "details"]);

/**
 * Exclude footnote definitions (which must stay at the document tail) and
 * anything nested in a table (rows / cells), both as drag targets.
 */
export function excludeFootnotesAndTables({ node, $pos }: DragRuleArgs): number {
  if (node.type.name === "footnoteDefinition") return 1000;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (UNTARGETABLE.has($pos.node(depth).type.name)) return 1000;
  }
  return 0;
}

/**
 * A callout / details block drags as one unit: never offer its inner paragraphs
 * to the handle, only the wrapper itself. Returns 1000 for a paragraph nested
 * inside a callout/details, 0 for the wrapper, and 0 for a top-level block.
 */
export function dragWrappersAsUnit({ node, $pos }: DragRuleArgs): number {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const name = $pos.node(depth).type.name;
    if (WRAPPER_BLOCKS.has(name)) {
      return node.type.name === name ? 0 : 1000;
    }
  }
  return 0;
}
