/**
 * Editor-side view types (prompt 7c).
 *
 * `ReviewerOption` is gone with the review gate: publishing a procedure is a
 * single action by its author, so there is no reviewer to pick and no
 * clinical-lead pool to fetch from.
 */
import type { Role } from "@/lib/roles";

/** The signed-in user, as the editor needs to know them. */
export interface EditorViewer {
  id: string;
  role: Role;
  name: string;
}
