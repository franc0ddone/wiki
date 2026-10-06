import type { Role } from "@/lib/roles";

/** A person who can be named as a procedure's reviewer (clinical lead or admin). */
export interface ReviewerOption {
  id: string;
  name: string;
  title: string | null;
  role: Role;
}

/** The signed-in user, as the editor needs to know them. */
export interface EditorViewer {
  id: string;
  role: Role;
  name: string;
}
