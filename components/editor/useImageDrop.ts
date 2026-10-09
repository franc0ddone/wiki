"use client";

import { useCallback, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Drag-and-drop image state for one host. Each host (ArticleEditor,
 * BulletinComposer) owns its own instance, so the two never share a popover.
 *
 * Only the *first* dropped file counts, and only when it is an image; anything
 * else is ignored (no dialog, no upload). The drop position is resolved from
 * the pointer so the image lands where it was dropped.
 */

export interface PendingDrop {
  file: File;
  pos: number;
  anchor: { left: number; top: number };
}

export function useImageDrop(editor: Editor | null) {
  const [pending, setPending] = useState<PendingDrop | null>(null);

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
  }, []);

  const onDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (!editor) return;
      const first = event.dataTransfer?.files?.[0];
      if (!first || !first.type.startsWith("image/")) return;
      event.preventDefault();

      const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      const pos = coords?.pos ?? editor.state.doc.content.size;
      setPending({ file: first, pos, anchor: { left: event.clientX, top: event.clientY } });
    },
    [editor],
  );

  const clear = useCallback(() => setPending(null), []);

  return { pending, onDragOver, onDrop, clear };
}
