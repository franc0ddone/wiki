/** Small framework-free helpers shared by the portal components. */

/** Join truthy class names. Keeps conditional Tailwind strings readable. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Timestamps are always rendered in the facility's local time, never the
 * viewer's.
 *
 * This must stay pinned. `Intl.DateTimeFormat` without an explicit `timeZone`
 * formats in whatever zone the runtime happens to be in, so a server running UTC
 * and a browser running Pacific render different strings for the same instant —
 * a hydration mismatch in dev, and silently shifted timestamps in production.
 */
export const FACILITY_TIME_ZONE = "America/Los_Angeles";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: FACILITY_TIME_ZONE,
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: FACILITY_TIME_ZONE,
});

/** Deterministic `Sep 14, 2026` formatting. Falls back to the raw string. */
export function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : DATE_FORMATTER.format(parsed);
}

/** Deterministic `Sep 14, 2026, 8:05 AM` formatting. Falls back to the raw string. */
export function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : DATE_TIME_FORMATTER.format(parsed);
}

const HONORIFICS = /^(dr|mr|ms|mrs|prof)\.?$/i;

/**
 * Two-letter uppercase monogram: `"Dr. Maya Okonkwo"` -> `"MO"`.
 * Honorifics are dropped so they never consume a letter.
 */
export function initials(fullName: string): string {
  const words = fullName
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && !HONORIFICS.test(word));

  const source = words.length > 0 ? words : fullName.split(/\s+/).filter(Boolean);
  const first = source[0]?.[0] ?? "";
  const last = source.length > 1 ? (source[source.length - 1]?.[0] ?? "") : (source[0]?.[1] ?? "");
  return `${first}${last}`.toUpperCase();
}

/**
 * Copy text to the clipboard. Uses the async Clipboard API when available and
 * falls back to a hidden textarea + `execCommand` for non-secure contexts.
 * Returns whether the write succeeded.
 */
export async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Clipboard API present but rejected (permissions / focus). Fall through.
  }

  try {
    const scratch = document.createElement("textarea");
    scratch.value = value;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.top = "-1000px";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(scratch);
    return copied;
  } catch {
    // Nothing else to try; the caller surfaces a failure state.
    return false;
  }
}