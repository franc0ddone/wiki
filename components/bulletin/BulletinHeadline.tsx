/**
 * The bulletin headline treatment (owner's "Option C"): 34px, weight 700,
 * letter-spacing -0.02em, line-height 1.1, with a 64px-wide × 3px-tall
 * dove-green (`#5F6E00`) rule sitting 14px below the headline — the deep end of
 * the locked brand green, the same accent the product draws its other rules and
 * dots in (`BulletinHeadline` used to carry the retired petroleum tone).
 *
 * Kept pure and presentational so `scripts/verify-frontend.ts` can render it
 * with `renderToStaticMarkup` and assert the exact classes; `BulletinDetail`
 * renders it for the standard layout (`light` for the featured hero band).
 */
import { cx } from "@/lib/utils";

export function BulletinHeadline({ title, light = false }: { title: string; light?: boolean }) {
  return (
    <div>
      <h1
        className={cx(
          "text-[34px] font-bold leading-[1.1] tracking-[-0.02em]",
          light ? "text-white" : "text-zinc-900",
        )}
      >
        {title}
      </h1>
      <div
        aria-hidden="true"
        className={cx("mt-[14px] h-[3px] w-16 rounded-[2px]", light ? "bg-white/45" : "bg-[#5F6E00]")}
      />
    </div>
  );
}

export default BulletinHeadline;
