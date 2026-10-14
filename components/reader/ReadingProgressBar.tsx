"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Thin reading-progress bar for the article (prompt 7a, item 3).
 *
 * It measures the nearest `[data-scroll-root]` ancestor — the master/detail
 * shell's reading pane — rather than the viewport, exactly as the reader's
 * scroll-spy does. Rendered inside `ReaderTopBar`, which is itself sticky, so
 * the bar reads as the article's progress and not the page's.
 */
export function ReadingProgressBar() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const scrollRoot = track.closest("[data-scroll-root]");
    const target: HTMLElement | Window = scrollRoot instanceof HTMLElement ? scrollRoot : window;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let ratio = 0;
        if (target instanceof HTMLElement) {
          const max = target.scrollHeight - target.clientHeight;
          ratio = max > 0 ? target.scrollTop / max : 0;
        } else {
          const max = document.documentElement.scrollHeight - window.innerHeight;
          ratio = max > 0 ? window.scrollY / max : 0;
        }
        setProgress(Math.min(1, Math.max(0, ratio)));
      });
    };

    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const percent = Math.round(progress * 100);

  return (
    <div
      ref={trackRef}
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-[3px] w-full bg-zinc-200/80"
    >
      <div
        aria-hidden="true"
        className="h-full rounded-r-full bg-[#5F6E00] transition-[width] duration-100 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
