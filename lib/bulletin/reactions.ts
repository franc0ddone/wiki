/**
 * Bulletin reactions — the bounded, fixed emoji set (decision 2026-10-07) and
 * the pure helpers that define it.
 *
 * A bulletin may be reacted to with exactly three emoji, in a fixed order, and
 * only those three: freeform input, custom picks, and anything beyond this list
 * are refused at the API. This module is the single definition — the data
 * layer, the route handler, the client, and `scripts/verify-frontend.ts` all
 * read it, so the allowlist can never drift.
 *
 * (The ❤️🎉👍 set is the one place product UI uses emoji; everywhere else is
 * Lucide icons. That exception is deliberate and scoped to bulletin reactions.)
 */

/** The allowlist, in display order. Exactly three, exactly these. */
export const BULLETIN_REACTION_EMOJIS = ["\u2764\uFE0F", "\uD83C\uDF89", "\uD83D\uDC4D"] as const;

export type BulletinReactionEmoji = (typeof BULLETIN_REACTION_EMOJIS)[number];

/** True only for the three allowlisted emoji. */
export function isBulletinReactionEmoji(value: unknown): value is BulletinReactionEmoji {
  return typeof value === "string" && (BULLETIN_REACTION_EMOJIS as readonly string[]).includes(value);
}

export interface ReactionSummaryEntry {
  emoji: BulletinReactionEmoji;
  count: number;
  viewer_reacted: boolean;
}

/**
 * Fold raw `(emoji, userId)` rows into the summary the reader renders: one
 * entry per allowlisted emoji, in allowlist order, with the viewer's own
 * reaction flagged. Rows outside the allowlist are ignored rather than shown —
 * the API cannot create them, but a legacy row must never crash the reader.
 */
export function summarizeReactions(
  rows: ReadonlyArray<{ emoji: string; userId: string }>,
  viewerId: string | null,
): ReactionSummaryEntry[] {
  return BULLETIN_REACTION_EMOJIS.map((emoji) => {
    const matching = rows.filter((row) => row.emoji === emoji);
    return {
      emoji,
      count: matching.length,
      viewer_reacted: viewerId !== null && matching.some((row) => row.userId === viewerId),
    };
  });
}
