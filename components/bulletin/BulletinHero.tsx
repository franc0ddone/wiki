/**
 * The featured bulletin hero band: a flat petroleum-teal (`#0f766e`, no
 * gradient) panel carrying the optional kicker pill, the headline, and the
 * optional deck in white, with the subtle ring decoration from the approved
 * mockup.
 *
 * Deliberately **no** navy / brand-blue in this tree — featured bulletins stay
 * Clinical Light teal (brand-package decision, 2026-10-07). Pure, so
 * `scripts/verify-frontend.ts` can render it and assert both the teal band and
 * the absence of `#1E2A4A`.
 */
import { BulletinHeadline } from "@/components/bulletin/BulletinHeadline";

export function BulletinHero({
  title,
  kicker,
  deck,
}: {
  title: string;
  kicker?: string | null;
  deck?: string | null;
}) {
  return (
    <div className="relative mt-4 overflow-hidden rounded-xl bg-[#0f766e]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full border border-white/15"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-12 h-40 w-40 rounded-full border border-white/10"
      />
      <div className="relative px-6 py-8 md:px-8 md:py-10">
        {kicker ? (
          <span className="mb-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-white">
            {kicker}
          </span>
        ) : null}
        <BulletinHeadline title={title} light />
        {deck ? <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-white/90">{deck}</p> : null}
      </div>
    </div>
  );
}

export default BulletinHero;
