/**
 * The optional hero banner above a bulletin's headline: a full-bleed,
 * fixed-height image. Present for any bulletin that carries one (prompt 6c
 * dropped the format tier that used to gate it).
 *
 * The image carries required alt text, stored on the bulletin and rendered
 * verbatim as the `<img alt>`. Presentational and pure so
 * `scripts/verify-frontend.ts` can render it.
 */
export function BulletinHeroImage({ url, alt }: { url: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- cloud-stored banner, fixed dimensions
    <img
      src={url}
      alt={alt}
      data-testid="bulletin-hero-image"
      className="mt-4 h-[220px] w-full rounded-xl object-cover"
    />
  );
}

export default BulletinHeroImage;
