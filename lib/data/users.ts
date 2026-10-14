import { getDb } from "@/lib/db";
import { isStaffType } from "@/lib/staff-type";
import type { StaffType } from "@/types/portal";

/**
 * The viewer's own account fields the surfaces need but the session does not
 * carry (prompt 7c).
 *
 * `staffType` deliberately does **not** travel on the session: the JWT/session
 * callbacks in `lib/auth.ts` and `lib/auth.config.ts` are locked, and a value
 * that only picks a feed's default view has no business being part of the
 * authentication contract. The portal's server component reads it here instead
 * and hands it to the client shell as a prop.
 *
 * Returns `null` for an unassigned account — or for an id that no longer
 * exists, which is the same "we know nothing" answer the switcher's `ALL`
 * default is for.
 */
export async function getUserStaffType(userId: string): Promise<StaffType | null> {
  const row = await getDb().user.findUnique({
    where: { id: userId },
    select: { staffType: true },
  });
  return isStaffType(row?.staffType) ? row.staffType : null;
}
