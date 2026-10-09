/**
 * Paste sanitizer for Word / Google Docs HTML.
 *
 * When an author copies from Word or Google Docs the clipboard carries a wall of
 * `class`/`style` attributes, XML namespaces (`<o:p>`, `<w:*>`, `<m:*>`),
 * `<meta>`/`<link>`/`<style>` noise, HTML comments, VML shapes, and the oddly
 * specific constructs each editor emits. None of that belongs in stored
 * Markdown, and `components/editor/extensions.tsx` will never round-trip it
 * (the schema deliberately excludes underline and hard breaks).
 *
 * `sanitizePastedHtml` reduces any pasted HTML to the small element set the
 * schema can represent, then lets the editor's own Markdown parsers turn the
 * result into nodes — no raw HTML is ever stored. It is **pure** (string in,
 * string out, no DOM, no dependencies), so `scripts/verify-frontend.ts` drives
 * the Word and Google Docs fixtures through it directly.
 *
 * Rules:
 *  - Element whitelist: `p, h1, h2, h3, ul, ol, li, strong, em, u, a[href],
 *    table, thead, tbody, tr, th, td, br, hr`. Anything else is unwrapped (its
 *    text/content survives, its tag does not).
 *  - `<u>` keeps its text and drops the mark (underline is not in the schema).
 *  - `<br>` becomes a paragraph split.
 *  - `class`/`style` are stripped from every surviving tag; only `href` is kept
 *    (on `<a>`). Namespaced attributes go too.
 *  - Comments, `<meta>`/`<link>`/`<style>`/`<script>`/`<head>`, XML/VML
 *    (`<v:*>`, `<o:*>`, `<w:*>`, `<m:*>`) are removed — VML shapes with their
 *    content.
 *  - Pasted `<img>` (including Word's VML and base64-embedded images) is
 *    dropped, never stored.
 *  - Word's flat `mso-list` paragraphs are converted to real nested `ul`/`ol`.
 */

/** The elements that survive a paste. */
export const PASTE_ALLOWED_TAGS = [
  "p",
  "h1",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "u",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "br",
  "hr",
] as const;

const ALLOWED = new Set<string>(PASTE_ALLOWED_TAGS);

/** Tags whose entire content is discarded when pasted. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "head",
  "title",
  "meta",
  "link",
  "xml",
  "iframe",
  "object",
  "embed",
  "noscript",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "meta", "link", "area", "base", "col", "input", "source", "wbr"]);

/** `1.` / `2)` etc. — a marker that says an ordered list. */
const ORDERED_MARKER_RE = /^\s*\d+[.)]/;
/** Word's literal marker span inside a list paragraph. */
const MSO_MARKER_SPAN_RE = /<\s*span\b[^>]*mso-list\s*:\s*Ignore[^>]*>[\s\S]*?<\s*\/\s*span\s*>/gi;

/** Remove every tag, keeping text (used to read a marker's visible text). */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** HTML-escape a value going back into an attribute. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface ParsedTag {
  closing: boolean;
  selfClosing: boolean;
  name: string;
  attrs: string;
}

/** Parse a single `<…>` token, or `null` for comments / doctype / junk. */
function parseTag(token: string): ParsedTag | null {
  if (token.startsWith("<!--") || token.startsWith("<!")) return null;
  const match = /^<\s*(\/?)\s*([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*(\/?)\s*>$/.exec(token);
  if (!match) return null;
  return {
    closing: match[1] === "/",
    name: match[2].toLowerCase(),
    attrs: match[3] ?? "",
    selfClosing: match[4] === "/",
  };
}

/** Does the tag's attribute soup carry this `key:value` (mso-list etc.)? */
function attrHas(attrs: string, pattern: RegExp): boolean {
  return pattern.test(attrs);
}

/**
 * Convert Word's flat `mso-list` paragraphs into real nested `<ul>` / `<ol>`.
 * Runs before attribute stripping, because the list metadata lives in the
 * (soon-to-be-removed) `style` attribute.
 */
function convertWordListParagraphs(html: string): string {
  const P_RE = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  const out: string[] = [];
  const stack: Array<{ level: number; ordered: boolean; liOpen: boolean }> = [];
  let lastIndex = 0;

  const closeTopLi = () => {
    const top = stack[stack.length - 1];
    if (top && top.liOpen) {
      out.push("</li>");
      top.liOpen = false;
    }
  };
  const popList = () => {
    const top = stack.pop();
    if (!top) return;
    if (top.liOpen) out.push("</li>");
    out.push(top.ordered ? "</ol>" : "</ul>");
  };
  const closeAll = () => {
    while (stack.length > 0) popList();
  };

  const detectOrdered = (inner: string): boolean => {
    const marker = /<\s*span\b[^>]*mso-list\s*:\s*Ignore[^>]*>([\s\S]*?)<\s*\/\s*span\s*>/i.exec(inner);
    if (marker && ORDERED_MARKER_RE.test(stripTags(marker[1]))) return true;
    return ORDERED_MARKER_RE.test(stripTags(inner).trim());
  };

  let match: RegExpExecArray | null;
  while ((match = P_RE.exec(html))) {
    out.push(html.slice(lastIndex, match.index));
    lastIndex = P_RE.lastIndex;

    const attrs = match[1];
    const inner = match[2];
    if (!attrHas(attrs, /mso-list\s*:/i)) {
      closeAll();
      out.push(match[0]);
      continue;
    }

    const levelMatch = /level(\d+)/i.exec(attrs);
    const level = levelMatch ? Math.max(1, Number.parseInt(levelMatch[1], 10)) : 1;
    const ordered = detectOrdered(inner);

    while (stack.length > 0 && stack[stack.length - 1].level > level) popList();
    if (stack.length > 0 && stack[stack.length - 1].level === level && stack[stack.length - 1].ordered !== ordered) {
      popList();
    }
    if (stack.length === 0 || stack[stack.length - 1].level < level) {
      out.push(ordered ? "<ol>" : "<ul>");
      stack.push({ level, ordered, liOpen: false });
    }
    closeTopLi();
    out.push("<li>", inner.replace(MSO_MARKER_SPAN_RE, ""));
    stack[stack.length - 1].liOpen = true;
  }

  closeAll();
  out.push(html.slice(lastIndex));
  return out.join("");
}

/** Drop comments and conditional-comment blocks. */
function stripComments(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[[\s\S]*?\]>/g, "")
    .replace(/<!\[endif\]/gi, "");
}

/** Remove VML shapes (with their content) and other namespaced blocks. */
function stripNamespacedBlocks(html: string): string {
  return html.replace(
    /<\s*(v|o|w|m|x):[\w-]+\b[^>]*>[\s\S]*?<\s*\/\s*(v|o|w|m|x):[\w-]+\s*>/gi,
    "",
  );
}

/** Split `<br>` inside a paragraph into two paragraphs; drop stray `<br>`. */
function splitBreaks(html: string): string {
  const paragraphSplit = html.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, (block) =>
    block.replace(/<\s*br\s*\/?\s*>/gi, "</p><p>"),
  );
  return paragraphSplit.replace(/<\s*br\s*\/?\s*>/gi, "");
}

interface Frame {
  tag: string;
  close: string | null;
  /** The output tag name, or `null` when the element is unwrapped. */
  output: string | null;
}

/**
 * Walk the tag soup, emitting only whitelisted elements with their content.
 * Non-whitelisted tags are unwrapped (content kept); drop-with-content tags are
 * skipped; namespaces, comments, `<img>` and attributes other than `a@href` are
 * removed.
 */
function runWhitelist(html: string): string {
  const out: string[] = [];
  const stack: Frame[] = [];
  let skipDepth: { name: string; depth: number } | null = null;

  const emitClose = (frame: Frame) => {
    if (frame.close) out.push(frame.close);
  };
  const popTo = (index: number, emit: boolean) => {
    while (stack.length > index) {
      const frame = stack.pop();
      if (frame && emit) emitClose(frame);
    }
  };

  const tagRe = /<[^>]*>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    if (skipDepth) {
      // Inside a drop-with-content element: swallow everything until it closes.
      const tag = parseTag(match[0]);
      if (tag && !tag.closing && tag.name === skipDepth.name) skipDepth.depth += 1;
      else if (tag && tag.closing && tag.name === skipDepth.name) {
        skipDepth.depth -= 1;
        if (skipDepth.depth === 0) skipDepth = null;
      }
      cursor = tagRe.lastIndex;
      continue;
    }

    out.push(html.slice(cursor, match.index));
    cursor = tagRe.lastIndex;

    const tag = parseTag(match[0]);
    if (!tag) continue;

    // Any namespaced element (`<o:p>`, `<w:*>`) — drop the tag, keep content.
    if (tag.name.includes(":")) continue;

    if (DROP_WITH_CONTENT.has(tag.name)) {
      // Void elements (`<meta>`, `<link>`) drop themselves; the rest swallow
      // their content until the matching close tag.
      if (!tag.closing && !tag.selfClosing && !VOID_TAGS.has(tag.name)) {
        skipDepth = { name: tag.name, depth: 1 };
      }
      continue;
    }

    if (tag.name === "img") continue; // pasted images are never stored

    if (tag.closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag.name) {
          popTo(i, true);
          break;
        }
      }
      continue;
    }

    if (tag.name === "b" || tag.name === "i") {
      // A genuine bold / italic; GDocs wraps lines in `<b style="font-weight:
      // normal">`, which is not emphasis and must be unwrapped instead.
      const isNeutral = attrHas(tag.attrs, /font-weight\s*:\s*normal/i);
      if (isNeutral) {
        stack.push({ tag: tag.name, close: null, output: null });
        continue;
      }
      const output = tag.name === "b" ? "strong" : "em";
      out.push(`<${output}>`);
      stack.push({ tag: tag.name, close: `</${output}>`, output });
      continue;
    }

    if (tag.name === "u") {
      // Underline is not in the schema: keep the text, drop the mark.
      stack.push({ tag: "u", close: null, output: null });
      continue;
    }

    if (tag.name === "span") {
      // Google Docs expresses bold / italic as a `font-weight:700` /
      // `font-style:italic` span rather than `<strong>` / `<em>`; keep that
      // emphasis. Any other span is a layout wrapper and is unwrapped.
      const bold = attrHas(tag.attrs, /font-weight\s*:\s*(?:700|bold)/i);
      const italic = attrHas(tag.attrs, /font-style\s*:\s*italic/i);
      if (bold || italic) {
        const output = bold ? "strong" : "em";
        out.push(`<${output}>`);
        stack.push({ tag: "span", close: `</${output}>`, output });
        continue;
      }
    }

    if (!ALLOWED.has(tag.name)) {
      // Unwrap anything else (span, div, font, …): content survives.
      stack.push({ tag: tag.name, close: null, output: null });
      continue;
    }

    // Whitelisted: rebuild with only the attributes we keep.
    let attrString = "";
    if (tag.name === "a") {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag.attrs);
      const value = href ? (href[1] ?? href[2] ?? href[3] ?? "") : "";
      if (value) attrString = ` href="${escapeAttribute(value)}"`;
    }

    if (VOID_TAGS.has(tag.name)) {
      out.push(`<${tag.name}>`);
      continue;
    }
    out.push(`<${tag.name}${attrString}>`);
    stack.push({ tag: tag.name, close: `</${tag.name}>`, output: tag.name });
  }

  out.push(html.slice(cursor));
  popTo(0, true);
  return out.join("");
}

/** Collapse the empty paragraphs a `<br>` split can leave behind. */
function tidy(html: string): string {
  return html
    .replace(/<p\b[^>]*>\s*<\/p>/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Sanitize pasted HTML down to the schema's own element set. The single entry
 * point the editor uses (via `transformPastedHTML`) and the verify script
 * exercises.
 */
export function sanitizePastedHtml(html: string): string {
  if (!html) return "";
  let out = html;
  out = stripComments(out);
  out = convertWordListParagraphs(out);
  out = stripNamespacedBlocks(out);
  out = runWhitelist(out);
  out = splitBreaks(out);
  return tidy(out);
}

/**
 * A boolean "is this clean?" probe the verify script uses to assert a fixture
 * carried none of the junk a paste should have removed.
 */
export function htmlIsClean(html: string): boolean {
  return (
    !/\bclass\s*=/i.test(html) &&
    !/\bstyle\s*=/i.test(html) &&
    !/<(o|w|m|v|x):/i.test(html) &&
    !/<!--/.test(html) &&
    !/<img\b/i.test(html) &&
    !/<(meta|link|style|script)\b/i.test(html) &&
    !/xmlns/i.test(html)
  );
}
