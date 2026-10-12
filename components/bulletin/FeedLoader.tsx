"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

/**
 * The tail of the unpinned feed.
 *
 * The feed renders one page (30) at a time; this element sits directly beneath
 * the last loaded row — `MasterDetailShell` renders it via `listFooter`, inside
 * the rail's own scroll container. As it scrolls into view an
 * `IntersectionObserver` asks for the next page. The **Load more** button does
 * the same thing by hand: it is the deliberate path for anyone whose environment
 * suppresses the automatic one (reduced-motion, or no `IntersectionObserver`),
 * so a page is never reachable by scroll alone.
 *
 * It holds no board state — it only reports "the tail is here" upward, and the
 * appending happens in `OperationsHubClient`, so nothing on screen shifts when a
 * page lands.
 */
export function FeedLoader({
  hasMore,
  loading,
  onLoadMore,
}: {
  /** Another page exists. `false` (feed exhausted, or a filter is active) hides the button. */
  hasMore: boolean;
  /** A page request is in flight. */
  loading: boolean;
  /** Ask the board for the next page. */
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || loading) return;
    if (typeof IntersectionObserver === "undefined") return;
    // Reduced motion: the user gets the button, not an automatic page load.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      // Start a little early so the next page is ready before the user hits the end.
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  return (
    <div ref={sentinel} className="flex flex-col items-center px-2 py-4" data-testid="bulletin-feed-footer">
      {loading ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 size={12} strokeWidth={2} aria-hidden="true" className="animate-spin" />
          Loading more…
        </p>
      ) : hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="flex h-8 items-center rounded-lg border border-zinc-300/60 bg-white px-3 text-[12.5px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}

export default FeedLoader;
