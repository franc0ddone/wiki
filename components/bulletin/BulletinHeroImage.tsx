/**
 * The optional hero banner above a featured / announcement bulletin's calling
 * card: a full-bleed, fixed-height image (the Employee-of-the-Month treatment).
 *
 * Decorative — the image sits directly above the headline that already names the
 * post, so its alt text is empty rather than a duplicate of the title. Only
 * rendered for the tiers that carry a hero (`formatHasHero`); a `notice` never
 * gets one. Presentational and pure so `scripts/verify-frontend.ts` can render
 * it.
 */
export function BulletinHeroImage({ url }: { url: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- cloud-stored banner, fixed dimensions
    <img
      src={url}
      alt=""
      data-testid="bulletin-hero-image"
      className="mt-4 h-[220px] w-full rounded-xl object-cover"
    />
  );
}

export default BulletinHeroImage;