/**
 * The bulletin presentation tier — one shared field, `format`.
 *
 * Three values: an ordinary `notice`, an `announcement`, and a `featured`
 * celebratory post. The vocabulary is defined here once and mirrored by the
 * Prisma `BulletinFormat` enum and `types/portal.ts`; prompt 6 renders the
 * announcement hero off this same enum. In this batch an `announcement`
 * persists end-to-end but renders with the standard notice layout.
 */

export const BULLETIN_FORMATS = ["notice", "announcement", "featured"] as const;
export type BulletinFormat = (typeof BULLETIN_FORMATS)[number];

export const BULLETIN_FORMAT_LABELS: Record<BulletinFormat, string> = {
  notice: "Formal notice",
  announcement: "Announcement",
  featured: "Featured",
};

export const DEFAULT_BULLETIN_FORMAT: BulletinFormat = "notice";

/** Featured-only field limits, shared by the composer UI and the API. */
export const KICKER_MAX_LENGTH = 40;
export const DECK_MAX_LENGTH = 140;


export function isBulletinFormat(value: unknown): value is BulletinFormat {
  return typeof value === "string" && (BULLETIN_FORMATS as readonly string[]).includes(value);
}

/**
 * A celebratory post (an `announcement` or a `featured`) has no formal
 * acknowledge button — celebratory posts get reactions, not acks. Hiding the
 * button never deletes the underlying ack records.
 */
export function formatUsesAck(format: BulletinFormat): boolean {
  return format === "notice";
}
