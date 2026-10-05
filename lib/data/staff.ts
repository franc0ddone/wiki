import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { toStaffMember } from "@/lib/data/mappers";
import type { Department, StaffMember } from "@/types/portal";

/**
 * Staff directory — the drop-in replacement for `STAFF_DIRECTORY` in
 * `lib/mock-data.ts`. Ordering: alphabetical by full name.
 */

export interface StaffFilters {
  /** `"All"` (or omitted) does not filter. */
  department?: Department;
  q?: string;
}

function buildWhere(filters: StaffFilters): Prisma.StaffMemberWhereInput {
  const conditions: Prisma.StaffMemberWhereInput[] = [];

  if (filters.department && filters.department !== "All") {
    conditions.push({ departments: { has: filters.department } });
  }

  const q = filters.q?.trim();
  if (q) {
    // Mirrors the component's search fields exactly: full_name, preferred_name,
    // pronouns, title, email, phone_extension, system_id.
    conditions.push({
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { preferredName: { contains: q, mode: "insensitive" } },
        { pronouns: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phoneExtension: { contains: q, mode: "insensitive" } },
        { systemId: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

export async function getStaff(filters: StaffFilters = {}): Promise<StaffMember[]> {
  const rows = await getDb().staffMember.findMany({
    where: buildWhere(filters),
    orderBy: [{ fullName: "asc" }],
  });
  return rows.map(toStaffMember);
}

export async function getStaffMemberById(id: string): Promise<StaffMember | null> {
  const row = await getDb().staffMember.findUnique({ where: { id } });
  return row ? toStaffMember(row) : null;
}

export async function getStaffMemberBySystemId(systemId: string): Promise<StaffMember | null> {
  const row = await getDb().staffMember.findUnique({ where: { systemId } });
  return row ? toStaffMember(row) : null;
}
