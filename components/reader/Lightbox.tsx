"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * Minimal image lightbox: dialog semantics, `Esc` closes, `←`/`→` page through
 * the article's images, `Tab` is trapped between the controls. The caller
 * restores focus to the thumbnail it opened from.
 */

export interface LightboxImage {
  src: string;
  alt: string;
}

export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: readonly LightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const image = images[index];
  const multiple = images.length > 1;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (multiple && event.key === "ArrowRight") {
        event.preventDefault();
        onIndexChange((index + 1) % images.length);
      } else if (multiple && event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange((index - 1 + images.length) % images.length);
      } else if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    // Capture so Esc closes the lightbox, not a drawer or palette underneath.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [index, images.length, multiple, onClose, onIndexChange]);

  if (!image) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${image.alt}`}
      className="fixed inset-0 z-[70] flex flex-col bg-zinc-950/85 backdrop-blur-sm print:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-4 px-4 py-3 text-white">
        <p className="min-w-0 truncate text-[13px] tabular-nums text-zinc-300">
          {multiple ? `${index + 1} of ${images.length}` : "Image"}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center gap-3 px-3"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {multiple ? (
          <button
            type="button"
            onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
            aria-label="Previous image"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- origin is the hospital's object store */}
        <img src={image.src} alt={image.alt} className="max-h-full max-w-full rounded-md bg-white object-contain shadow-2xl" />
        {multiple ? (
          <button
            type="button"
            onClick={() => onIndexChange((index + 1) % images.length)}
            aria-label="Next image"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <ChevronRight size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <p className="shrink-0 px-6 py-4 text-center text-[13.5px] leading-relaxed text-zinc-200">{image.alt}</p>
    </div>
  );
}
