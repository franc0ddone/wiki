import { DoveLewisIcon } from "@/components/brand/DoveLewisIcon";

/**
 * The bulletin reader's "nothing selected" state: the canonical empty bowl,
 * centred, with one quiet line of muted copy beneath it.
 *
 * That bowl — dark green, hand-drawn (`roughness`) — is the *same* empty-state
 * accent the board's own empty rail and the Knowledge Home use, so a pane that
 * has nothing to show reads the same way everywhere in the product. It replaces
 * the animated `LivingDove`, which is still in the codebase
 * (`components/bulletin/LivingDove`) but is no longer this surface's
 * placeholder.
 *
 * **Sized as an illustration, not an accent.** The other two surfaces set the
 * bowl at 44px because it sits above a plate and a title in a small column; here
 * it is the whole state, alone in a wide reading canvas, so it is drawn at 120px
 * — roughly 2.75× that accent — to fill the space deliberately. The treatment is
 * otherwise identical (same mark, same colour, same `opacity-55` weight).
 *
 * **It rocks once, on appear.** `.dw-bowl-rock` (globals.css) tips it three slow
 * times about its own foot and settles still — a nudge on the entrance, never a
 * loop — and stands down entirely under `prefers-reduced-motion`.
 *
 * Deliberately lighter than the board's no-notices-at-all state: a rail and a
 * canvas are on screen at the same time here, so there is no icon plate and no
 * title — just the mark and the instruction. Decorative by contract: the icon
 * carries no `title`, so it renders `aria-hidden`/`role="presentation"`, and the
 * copy below it is the only text.
 */
export function BulletinReaderEmptyState() {
  return (
    <div className="flex flex-col items-center text-center">
      <DoveLewisIcon
        className="dw-bowl-rock mx-auto mb-3 opacity-55"
        color="dark-green"
        name="empty-bowl"
        roughness={true}
        size={120}
      />
      <p className="text-[12.5px] leading-5 text-zinc-500">Select a bulletin to begin reading</p>
    </div>
  );
}

export default BulletinReaderEmptyState;
