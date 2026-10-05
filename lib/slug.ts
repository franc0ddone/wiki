/**
 * Server-safe slug generation.
 *
 * This is a deliberate mirror of `slugify` inside `components/MarkdownReader.tsx`.
 * The reader's copy stays exactly where it is (it is the canonical behaviour for
 * rendered heading ids) and `lib/links.ts` imports *that* one so link validation
 * can never drift from what the reader actually renders.
 *
 * Backend code cannot use the reader's copy: `MarkdownReader.tsx` is a
 * `"use client"` module, and calling a non-component export from server code is
 * a runtime error in the App Router. So the server gets this twin, and
 * `scripts/verify-backend.ts` asserts the two stay character-for-character
 * identical.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
