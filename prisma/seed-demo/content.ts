/**
 * Load and validate the demo seed's content files.
 *
 * The files under this directory are the source of truth for what a demo
 * database contains; this module is the only reader of them. It parses the
 * Markdown front matter (see `frontmatter.ts`), checks that every value the
 * seed will write is present and well-formed, and returns plain typed records.
 *
 * Validation is deliberately loud. A demo database that is missing half its
 * bulletins, or that has an article pointing at an author who does not exist,
 * is worse than a seed that refuses to run — so every problem throws, naming
 * the file it came from. The checks that need the rest of the content (does an
 * article's linked SOP exist? is every author a known staff member?) live in
 * `seed.ts`, which has the full set in hand.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter, type FrontmatterValue } from "./frontmatter";
import { CLINICAL_DEPARTMENTS, AUDIENCES, type ArticleAudience } from "@/types/portal";

/** The directory this module reads beside — resolved from the repo root. */
const DEMO_DIR = join(process.cwd(), "prisma", "seed-demo");

export interface DemoSop {
  /** Slug, and the Markdown file's base name. */
  slug: string;
  title: string;
  departments: string[];
  status: "draft" | "published";
  essential: boolean;
  audience: ArticleAudience;
  authorEmail: string;
  /** ISO 8601; both `updated_at` and (when published) `effective_date`. */
  updatedAt: string;
  changeSummary: string;
  body: string;
  file: string;
}

export interface DemoBulletin {
  id: string;
  title: string;
  departments: string[];
  pinned: boolean;
  urgent: boolean;
  ackRequired: boolean;
  deck: string | null;
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  /** ISO 8601, or `null` for a notice with nothing scheduled. */
  expiresAt: string | null;
  authorEmail: string;
  publishedAt: string;
  /** Slug of a seeded SOP this notice references, or `null`. */
  linkedSop: string | null;
  /** File names under `attachments/` to upload and attach to this notice. */
  attachments: string[];
  body: string;
  file: string;
}

export interface DemoStaff {
  systemId: string;
  fullName: string;
  preferredName: string;
  pronouns: string;
  title: string;
  departments: string[];
  email: string;
  phoneExtension: string;
  directPhone: string;
  shiftPreference: "Day" | "Swing" | "Overnight";
  shiftRotations: Array<{ label: string; days: string; hours: string }>;
  avatarUrl: string;
}

export interface DemoContent {
  bulletins: DemoBulletin[];
  sops: DemoSop[];
  staff: DemoStaff[];
}

/* ------------------------------------------------------------------ helpers */

function expectString(data: Record<string, FrontmatterValue>, key: string, file: string): string {
  const value = data[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${file}: front matter \`${key}\` must be a non-empty string`);
  }
  return value;
}

function optionalString(data: Record<string, FrontmatterValue>, key: string, file: string): string | null {
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${file}: front matter \`${key}\` must be a string or null`);
  return value.length > 0 ? value : null;
}

function expectBool(data: Record<string, FrontmatterValue>, key: string, file: string, fallback: boolean): boolean {
  const value = data[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${file}: front matter \`${key}\` must be true or false`);
  return value;
}

function expectList(data: Record<string, FrontmatterValue>, key: string, file: string): string[] {
  const value = data[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${file}: front matter \`${key}\` must be a non-empty [a, b] list`);
  }
  return value;
}

/** An optional `[a, b]` list; absent or null means "none". */
function optionalList(data: Record<string, FrontmatterValue>, key: string, file: string): string[] {
  const value = data[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${file}: front matter \`${key}\` must be a [a, b] list`);
  return value;
}

/** Departments are a closed vocabulary — a typo here would never match a filter. */
function expectDepartments(data: Record<string, FrontmatterValue>, key: string, file: string): string[] {
  const values = expectList(data, key, file);
  const known = new Set<string>(CLINICAL_DEPARTMENTS);
  for (const value of values) {
    if (!known.has(value)) {
      throw new Error(
        `${file}: department ${JSON.stringify(value)} is not one of ${CLINICAL_DEPARTMENTS.join(", ")}`,
      );
    }
  }
  return values;
}

function expectIso(value: string, label: string, file: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${file}: \`${label}\` is not a parseable date: ${value}`);
  return date.toISOString();
}

function expectIsoOrNull(value: string | null, label: string, file: string): string | null {
  return value === null ? null : expectIso(value, label, file);
}

/* -------------------------------------------------------------------- files */

function readMarkdownFiles(subdir: string): Array<{ file: string; source: string }> {
  const dir = join(DEMO_DIR, subdir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => ({ file: `${subdir}/${name}`, source: readFileSync(join(dir, name), "utf8") }));
}

function parseSop(file: string, source: string): DemoSop {
  const { data, body } = parseFrontmatter(source);
  const slug = expectString(data, "slug", file);
  const base = file.split("/").pop() ?? "";
  if (base !== `${slug}.md`) {
    throw new Error(`${file}: slug \`${slug}\` must match the file name \`${slug}.md\``);
  }
  const status = data.status === undefined ? "published" : data.status;
  if (status !== "published" && status !== "draft") {
    throw new Error(`${file}: \`status\` must be \`published\` or \`draft\``);
  }
  const audience = data.audience === undefined ? "ALL" : data.audience;
  if (typeof audience !== "string" || !(AUDIENCES as readonly string[]).includes(audience)) {
    throw new Error(`${file}: \`audience\` must be one of ${AUDIENCES.join(", ")}`);
  }
  const updatedAt = expectIso(expectString(data, "updated_at", file), "updated_at", file);

  return {
    slug,
    title: expectString(data, "title", file),
    departments: expectDepartments(data, "departments", file),
    status,
    essential: expectBool(data, "essential", file, false),
    audience: audience as ArticleAudience,
    authorEmail: expectString(data, "author", file).toLowerCase(),
    updatedAt,
    changeSummary: optionalString(data, "change_summary", file) ?? "Initial demo seed publish.",
    body,
    file,
  };
}

function parseBulletin(file: string, source: string): DemoBulletin {
  const { data, body } = parseFrontmatter(source);
  const id = expectString(data, "id", file);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`${file}: \`id\` must be a lowercase UUID (it is the bulletin's stable identity)`);
  }
  const heroImageUrl = optionalString(data, "hero_image_url", file);
  const heroImageAlt = optionalString(data, "hero_image_alt", file);
  if (heroImageUrl && !heroImageAlt) throw new Error(`${file}: a hero image requires \`hero_image_alt\``);
  if (heroImageAlt && !heroImageUrl) throw new Error(`${file}: \`hero_image_alt\` is set but there is no hero image`);

  const publishedAt = expectIso(expectString(data, "published_at", file), "published_at", file);
  const expiresAt = expectIsoOrNull(optionalString(data, "expires_at", file), "expires_at", file);

  return {
    id,
    title: expectString(data, "title", file),
    departments: expectDepartments(data, "departments", file),
    pinned: expectBool(data, "pinned", file, false),
    urgent: expectBool(data, "urgent", file, false),
    ackRequired: expectBool(data, "ack_required", file, false),
    deck: optionalString(data, "deck", file),
    heroImageUrl,
    heroImageAlt,
    expiresAt,
    authorEmail: expectString(data, "author", file).toLowerCase(),
    publishedAt,
    linkedSop: optionalString(data, "linked_sop", file),
    attachments: optionalList(data, "attachments", file),
    body,
    file,
  };
}

function parseStaff(file: string): DemoStaff[] {
  const parsed: unknown = JSON.parse(readFileSync(join(DEMO_DIR, file), "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array of staff records`);

  return parsed.map((entry, index) => {
    const where = `${file}[${index}]`;
    if (entry === null || typeof entry !== "object") throw new Error(`${where}: expected an object`);
    const row = entry as Record<string, unknown>;

    const string = (key: string): string => {
      const value = row[key];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${where}: \`${key}\` must be a non-empty string`);
      }
      return value;
    };
    const departments = row.departments;
    if (!Array.isArray(departments) || departments.length === 0) {
      throw new Error(`${where}: \`departments\` must be a non-empty array`);
    }
    const known = new Set<string>(CLINICAL_DEPARTMENTS);
    for (const department of departments) {
      if (typeof department !== "string" || !known.has(department)) {
        throw new Error(`${where}: department ${JSON.stringify(department)} is not a clinical department`);
      }
    }
    const shiftPreference = string("shift_preference");
    if (shiftPreference !== "Day" && shiftPreference !== "Swing" && shiftPreference !== "Overnight") {
      throw new Error(`${where}: \`shift_preference\` must be Day, Swing, or Overnight`);
    }
    const rotations = row.shift_rotations;
    if (!Array.isArray(rotations) || rotations.length === 0) {
      throw new Error(`${where}: \`shift_rotations\` must be a non-empty array`);
    }

    return {
      systemId: string("system_id"),
      fullName: string("full_name"),
      preferredName: string("preferred_name"),
      pronouns: string("pronouns"),
      title: string("title"),
      departments: departments as string[],
      email: string("email").toLowerCase(),
      phoneExtension: string("phone_extension"),
      directPhone: string("direct_phone"),
      shiftPreference,
      shiftRotations: rotations.map((rotation, rotationIndex) => {
        if (rotation === null || typeof rotation !== "object") {
          throw new Error(`${where}.shift_rotations[${rotationIndex}]: expected an object`);
        }
        const item = rotation as Record<string, unknown>;
        const readPart = (key: string): string => {
          const value = item[key];
          if (typeof value !== "string" || value.length === 0) {
            throw new Error(`${where}.shift_rotations[${rotationIndex}]: \`${key}\` must be a non-empty string`);
          }
          return value;
        };
        const label = readPart("label");
        if (label !== "Day" && label !== "Swing" && label !== "Overnight") {
          throw new Error(`${where}.shift_rotations[${rotationIndex}]: \`label\` must be Day, Swing, or Overnight`);
        }
        return { label, days: readPart("days"), hours: readPart("hours") };
      }),
      avatarUrl: typeof row.avatar_url === "string" ? row.avatar_url : "",
    };
  });
}

/**
 * Read every demo content file and return the validated set.
 *
 * Called by both the seed and the reset convenience script; it touches no
 * database and no network.
 */
export function loadDemoContent(): DemoContent {
  const bulletins = readMarkdownFiles("bulletins").map(({ file, source }) => parseBulletin(file, source));
  const sops = readMarkdownFiles("sops").map(({ file, source }) => parseSop(file, source));
  const staff = parseStaff("staff.json");

  return { bulletins, sops, staff };
}

/** The directory the attachment source files live in, for the seed's uploader. */
export const DEMO_ATTACHMENT_DIR = join(DEMO_DIR, "attachments");
