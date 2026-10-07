"use client";

import { useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import {
  IMAGE_MAX_WIDTH,
  IMAGE_MIN_WIDTH,
  clampWidth,
  type ImageAlign,
} from "@/lib/markdown/image-attributes";
import { cx } from "@/lib/utils";

/**
 * Image node view: a sized, aligned figure with drag-to-resize.
 *
 * Width and alignment are node attributes that serialize to the bracketed
 * suffix (`![alt](src "caption"){width=480 align=center}`); this view is the
 * editing affordance for them. Caption and alt text are edited in `ImageDialog`
 * (opened from the toolbar when the image is selected). Pure DOM pointer events
 * — no drag library.
 */

const ALIGNMENTS: ReadonlyArray<{ value: ImageAlign; label: string; icon: typeof AlignLeft }> = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align centre", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
];

export function ImageView({ node, selected, updateAttributes, editor, getPos }: NodeViewProps) {
  const width = node.attrs.width === null || node.attrs.width === undefined ? null : Number(node.attrs.width);
  const align = (node.attrs.align ?? null) as ImageAlign | null;
  const frameRef = useRef<HTMLDivElement | null>(null);

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const startX = event.clientX;
    const startWidth = frame.getBoundingClientRect().width;
    // A right-aligned image grows leftwards, so the drag direction flips.
    const direction = align === "right" ? -1 : 1;

    const onMove = (move: PointerEvent) => {
      updateAttributes({ width: clampWidth(startWidth + direction * (move.clientX - startX)) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const justify = align === "left" ? "justify-start" : align === "right" ? "justify-end" : "justify-center";

  return (
    <NodeViewWrapper
      as="figure"
      className="dw-figure"
      data-align={align ?? "center"}
      contentEditable={false}
      onClick={() => {
        // A custom node view does not select the node on its own, so the
        // resize handle and alignment controls would never appear.
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos === "number") editor?.commands.setNodeSelection(pos);
      }}
      onMouseDown={(event: ReactMouseEvent) => {
        // ProseMirror calls preventDefault on mousedown for atom nodes, which
        // suppresses the follow-up `click` — so select here, not in onClick.
        event.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (typeof pos === "number") editor?.commands.setNodeSelection(pos);
      }}
    >
      <div className={cx("flex", justify)}>
        <div
          ref={frameRef}
          className="relative"
          style={width !== null ? { width: `${width}px`, maxWidth: "100%" } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- origin is the hospital's object store */}
          <img
            src={String(node.attrs.src ?? "")}
            alt={String(node.attrs.alt ?? "")}
            title={node.attrs.title ? String(node.attrs.title) : undefined}
            draggable={false}
            className="dw-image w-full"
          />

          {selected ? (
            <>
              <span
                role="slider"
                aria-label="Resize image"
                aria-valuemin={IMAGE_MIN_WIDTH}
                aria-valuemax={IMAGE_MAX_WIDTH}
                aria-valuenow={width ?? undefined}
                onPointerDown={startResize}
                className="absolute -right-1.5 top-1/2 h-9 w-3 -translate-y-1/2 cursor-ew-resize rounded-full border border-teal-600/50 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.2)]"
              />
              <div className="absolute -top-9 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-[0_4px_16px_-6px_rgba(24,24,27,0.25)]">
                {ALIGNMENTS.map((option) => {
                  const Icon = option.icon;
                  const active = (align ?? "center") === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={active}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => updateAttributes({ align: option.value })}
                      className={cx(
                        "flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40",
                        active ? "bg-teal-50 text-[#0F766E]" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
                      )}
                    >
                      <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export default ImageView;
