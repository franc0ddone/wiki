"use client";

import { cx } from "@/lib/utils";

/**
 * The Dove Hub brand lockup (prompt 7c, item 1).
 *
 * A single fixed-dimension slot — `flex items-center gap-2.5 h-9` — rendered at
 * the top of the Knowledge Home surface. Everything inside is one mark plus one
 * wordmark, so the official artwork can be dropped in without touching layout
 * anywhere else:
 *
 *   ┌──────────────────────── DROP-IN REPLACEMENT POINT ────────────────────────┐
 *   │ Replace the whole `<BrandMark />` + wordmark pair below with the official │
 *   │ image:                                                                    │
 *   │                                                                           │
 *   │   <Image src="/brand/dove-hub-lockup.png" alt="Dove Hub"                  │
 *   │          width={132} height={36} priority />                              │
 *   │                                                                           │
 *   │ Keep the asset 36 px tall with a transparent background and it fills this │
 *   │ slot exactly. No parent class, gap, or height changes.                    │
 *   └───────────────────────────────────────────────────────────────────────────┘
 *
 * The fallback mark is a geometric dove drawn inline in the locked brand
 * colours — Dark Green #5F6E00 as the field and Dove Green #AFBE23 as the bird —
 * so there is no raster asset to ship and nothing to load before the Oct 21
 * demo. The wordmark is Domine bold, in Dove Black #20241E on light surfaces and
 * white in the Knowledge Home's dark header band (`tone="light"`). The mark
 * itself is unchanged in either tone: it carries its own ground.
 */

export interface BrandLockupProps {
  /** Optional extra classes; the slot's own geometry is fixed. */
  className?: string;
  /**
   * The surface the lockup sits on. `"dark"` (the default) is Dove Black on a
   * light surface; `"light"` inverts the wordmark only, for the #20241E band.
   */
  tone?: "dark" | "light";
}

export function BrandLockup({ className, tone = "dark" }: BrandLockupProps) {
  return (
    <div className={cx("flex h-9 items-center gap-2.5", className)}>
      {/* ---- DROP-IN REPLACEMENT POINT (see the docblock above) ---- */}
      <BrandMark />
      <span
        className={cx(
          "dw-display truncate text-[17px] font-bold leading-9 tracking-[-0.01em]",
          tone === "light" ? "text-white" : "text-[#20241E]",
        )}
      >
        Dove Hub
      </span>
      {/* ------------------------------------------------------------ */}
    </div>
  );
}

/**
 * The fallback mark: a rounded clinical field in Dark Green carrying a
 * geometric dove in Dove Green. Deliberately built from two colours and five
 * shapes so it stays crisp at 28 px on a 1080p workstation.
 */
function BrandMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      role="img"
      aria-label="Dove Hub"
      className="shrink-0"
    >
      <rect width="28" height="28" rx="9" fill="#5F6E00" />
      {/* Wing: the dove's body, a single upward chevron. */}
      <path d="M6.6 18.1 13.3 8.4l6.2 9.7z" fill="#AFBE23" />
      {/* Head and beak, offset to the upper right so the bird reads in silhouette. */}
      <circle cx="18.4" cy="9.3" r="2.5" fill="#AFBE23" />
      <path d="M20.6 8.2 24 6.7l-2.5 3z" fill="#AFBE23" />
      {/* The clinical rule under the wing — the same hairline motif the bulletin
          headline uses, in Dove Green. */}
      <rect x="8" y="20.4" width="12" height="1.6" rx="0.8" fill="#AFBE23" />
    </svg>
  );
}

export default BrandLockup;
