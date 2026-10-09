import type { ArticleStatus, BulletinFormat, BulletinPriority, ShiftPreference } from "@/generated/prisma/enums";
import type {
  Bulletin,
  ClinicalDepartment,
  KnowledgeArticle,
  StaffMember,
  ShiftRotation,
} from "@/types/portal";

/**
 * Row → portal-type mapping.
 *
 * The single job of this module is the one thing the frontend pass depends on:
 * a database row must come out looking exactly like the object the components
 * read out of `lib/mock-data.ts` today. Field names, optionality, and timestamp
 * format are all reproduced deliberately.
 */

/** Shape of the `author` relation every query selects. */
export interface AuthorRow {
  name: string;
  title: string | null;
}

/**
 * Reproduce the phase-1 author string, which the fixtures write as
 * `"Trevor Lindqvist, ICU Technician II"` — display name, comma, role.
 * Service accounts with no title degrade to just the name.
 */
export function formatAuthorName(author: AuthorRow | null | undefined): string {
  if (!author) return "Unknown author";
  return author.title ? `${author.name}, ${author.title}` : author.name;
}

/** Departments are a `String[]` column; the portal type narrows them. */
function asDepartments(values: readonly string[]): ClinicalDepartment[] {
  return values as ClinicalDepartment[];
}

export interface ArticleRowInput {
  id: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  departments: string[];
  status: ArticleStatus;
  updatedAt: Date;
  author: AuthorRow | null;
}

export function toKnowledgeArticle(row: ArticleRowInput): KnowledgeArticle {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    departments: asDepartments(row.departments),
    status: row.status,
    body_markdown: row.bodyMarkdown,
    // The portal renders ISO strings and formats them itself, pinned to
    // FACILITY_TIME_ZONE. UTC on the wire, local on the screen.
    updated_at: row.updatedAt.toISOString(),
    author_name: formatAuthorName(row.author),
  };
}

export interface BulletinRowInput {
  id: string;
  title: string;
  bodyMarkdown: string;
  departments: string[];
  priority: BulletinPriority;
  format: BulletinFormat;
  kicker: string | null;
  deck: string | null;
  linkedArticleId: string | null;
  publishedAt: Date;
  author: AuthorRow | null;
}

export function toBulletin(row: BulletinRowInput): Bulletin {
  return {
    id: row.id,
    title: row.title,
    departments: asDepartments(row.departments),
    priority: row.priority,
    format: row.format,
    // Featured-only fields are omitted entirely when empty so the reader's
    // `bulletin.kicker` stays falsy exactly as it did for the old fixtures.
    ...(row.kicker ? { kicker: row.kicker } : {}),
    ...(row.deck ? { deck: row.deck } : {}),
    body_markdown: row.bodyMarkdown,
    created_at: row.publishedAt.toISOString(),
    author_name: formatAuthorName(row.author),
    // Optional in the portal type: omitted entirely when there is no link, so
    // `bulletin.linked_sop_id` stays falsy exactly as in the fixtures.
    ...(row.linkedArticleId ? { linked_sop_id: row.linkedArticleId } : {}),
  };
}

export interface StaffRowInput {
  id: string;
  systemId: string;
  fullName: string;
  preferredName: string;
  pronouns: string;
  title: string;
  departments: string[];
  email: string;
  phoneExtension: string;
  directPhone: string;
  shiftPreference: ShiftPreference;
  shiftRotations: unknown;
  avatarUrl: string | null;
}

export function toStaffMember(row: StaffRowInput): StaffMember {
  return {
    id: row.id,
    system_id: row.systemId,
    full_name: row.fullName,
    preferred_name: row.preferredName,
    pronouns: row.pronouns,
    title: row.title,
    departments: asDepartments(row.departments),
    email: row.email,
    phone_extension: row.phoneExtension,
    direct_phone: row.directPhone,
    shift_preference: row.shiftPreference,
    shift_rotations: toShiftRotations(row.shiftRotations),
    // The portal type uses `""` (not null) for "no avatar yet".
    avatar_url: row.avatarUrl ?? "",
  };
}

/**
 * Rebuild each rotation as `{ label, days, hours }`.
 *
 * Postgres stores a `Json` column as `jsonb`, which normalises object key order
 * — a row written as `{ label, days, hours }` comes back as
 * `{ days, hours, label }`. Nothing reads by position, but a stable key order
 * keeps the values comparing equal to the fixtures without ceremony, and it is
 * where a malformed row gets caught rather than leaking to the UI.
 */
function toShiftRotations(value: unknown): ShiftRotation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const rotation = entry as Record<string, unknown>;
    return [
      {
        label: rotation.label as ShiftRotation["label"],
        days: String(rotation.days ?? ""),
        hours: String(rotation.hours ?? ""),
      },
    ];
  });
}
