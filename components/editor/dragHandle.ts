/**
 * The grip element the drag handle extension positions in the gutter.
 *
 * Kept as a plain DOM factory (not a React component) because the extension's
 * `render()` returns a raw element it manages itself. The `data-drag-handle`
 * hook marks it for styling; the handle never fights an image's own native
 * drag because the two are separate elements.
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
