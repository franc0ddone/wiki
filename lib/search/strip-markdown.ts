/**
 * Markdown → plain searchable text.
 *
 * Link labels are kept (URLs dropped), fenced-code content is kept (fence
 * markers and the language tag dropped), callout markers `[!tip]` and
 * `:::details` directives are dropped (the summary text is kept), list / quote
 * / heading / emphasis markers are removed, table pipes become spaces, and the
 * stored block / inline formatting this wiki adds (`{align=…}` suffixes,
 * `~sub~`, `^sup^`, `==mark==`) is stripped so only the words are indexed.
 * The result is one whitespace-collapsed string, which is what Fuse indexes and
 * what result snippets are cut from — so highlight indices line up exactly.
 */

import { splitInlineConventions } from "@/lib/markdown/inline-conventions";
import { stripBlockAttributeSuffix } from "@/lib/markdown/block-attributes";

/** `~sub~` / `^sup^` / `==mark==` → `sub` / `sup` / `mark`; lone markers are prose. */
function stripInlineConventions(line: string): string {
  return splitInlineConventions(line)
    .map((part) => part.value)
    .join("");
}

export function stripMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw.trim());
      continue;
    }

    let line = raw;
    if (/^\s*:::\s*$/.test(line)) continue;
    // `:::details` / `:::steps` / `:::spotlight` are directives, not words.
    line = line.replace(/^\s*:::(?:details|steps|spotlight)\s*/, "");
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue; // table divider
    if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) continue; // rule

    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, "") // heading marker
      .replace(/^\s*(?:>\s?)+/, "") // quote
      .replace(/^\s*\[![A-Za-z]+\]\s*/, "") // callout marker
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "") // list marker
      .replace(/^\s*\[[ xX]\]\s+/, "") // task marker
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // image → alt
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link → label
      .replace(/(\*\*|__|\*|`)/g, "") // emphasis / code ticks
      .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, "$1") // escapes
      .replace(/\|/g, " "); // table pipes

    line = stripInlineConventions(line);
    line = stripBlockAttributeSuffix(line).trim();

    out.push(line.trim());
  }

  return out.filter((line) => line.length > 0).join(" ").replace(/\s+/g, " ").trim();
}
