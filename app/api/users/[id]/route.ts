import type { NextRequest } from "next/server";
import { ApiError, errorResponse, optionalString, readJsonBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ROLE_LABELS, isRole } from "@/lib/roles";
import { parseStaffType, staffTypeLabel } from "@/lib/staff-type";

/**
 * `PATCH /api/users/[id]` — change an account's role, staff type, or display
 * name/title. `admin` only.
 *
 * Two guards keep an administrator from locking the hospital out of its own
 * portal: you cannot demote yourself, and you cannot remove the last remaining
 * admin. Both are cheap queries and both are the kind of mistake that is only
 * discovered at the worst possible moment otherwise.
 *
 * `staff_type` (prompt 7c) is the one field that is *not* an authorization
 * change: it only picks the Knowledge Home feed's default audience. Any of
 * `MEDICAL`, `NON_MEDICAL`, or absent/empty for "unassigned" is accepted.
 */

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireRole("admin");
    const { id } = await params;
    const body = await readJsonBody(request);
    const db = getDb();

    const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!target) throw new ApiError(404, `No user with id \`${id}\` exists.`);

    const data: {
      role?: "admin" | "clinical_lead" | "author" | "staff" | "readonly";
      name?: string;
      title?: string | null;
      staffType?: "MEDICAL" | "NON_MEDICAL" | null;
    } = {};

    if (body.role !== undefined) {
      const role = optionalString(body, "role");
      if (!isRole(role)) {
        throw new ApiError(422, `\`role\` must be one of ${Object.keys(ROLE_LABELS).join(", ")}.`, {
          details: { field: "role" },
        });
      }

      if (target.id === actor.id && role !== "admin") {
        throw new ApiError(422, "You cannot change your own role. Ask another administrator.", {
          code: "self_demotion_refused",
        });
      }

      if (target.role === "admin" && role !== "admin") {
        const admins = await db.user.count({ where: { role: "admin" } });
        if (admins <= 1) {
          throw new ApiError(422, "This is the only administrator account; promote someone else first.", {
            code: "last_admin_refused",
          });
        }
      }

      data.role = role;
    }

    if (body.name !== undefined) data.name = optionalString(body, "name", { maxLength: 200 }) ?? "";
    if (body.title !== undefined) {
      const title = optionalString(body, "title", { maxLength: 200 });
      data.title = title && title.length > 0 ? title : null;
    }

    // Staff type (prompt 7c). Absent → untouched; empty/null → unassigned.
    if (body.staff_type !== undefined) {
      const parsed = parseStaffType(body.staff_type);
      if (!parsed.ok) {
        throw new ApiError(422, "`staff_type` must be `MEDICAL`, `NON_MEDICAL`, or empty for unassigned.", {
          details: { field: "staff_type" },
        });
      }
      data.staffType = parsed.staffType;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiError(422, "No updatable fields were supplied.", { code: "empty_update" });
    }

    const updated = await db.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, title: true, role: true, staffType: true },
    });

    return Response.json({
      ...updated,
      role_label: ROLE_LABELS[updated.role],
      staff_type: updated.staffType,
      staff_type_label: staffTypeLabel(updated.staffType as "MEDICAL" | "NON_MEDICAL" | null),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
