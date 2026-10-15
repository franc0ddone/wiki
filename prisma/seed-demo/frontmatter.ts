/**
 * A deliberately tiny front matter reader for the demo seed.
 *
 * The seed's content files are Markdown with a `---`-fenced header, so the
 * human reviewer sees the metadata and the prose in one place, and the seed
 * script never has to keep a second manifest in step with the files. It is not
 * YAML, and it is not meant to be: only the four value shapes the demo content
 * actually uses are understood —
 *
 *   key: some text                 a string (surrounding quotes are optional)
 *   key: 2026-10-12T15:00:00.000Z  still just a string
 *   key: true / false              a boolean
 *   key: null                      null (also an empty value)
 *   key: [ER, CSR]                 an inline list of strings
 *
 * Anything else — nesting, block lists, multi-line scalars — is intentionally
 * unsupported, so a file that drifts into real YAML fails loudly at load time
 * rather than being half-understood. No dependency is pulled in for this: the
 * project's rule is that the seed adds no new packages.
 */

export type FrontmatterValue = string | boolean | null | string[];

export interface Frontmatter {
  /** `key → value`, in file order. Unknown keys are the caller's business. */
  data: Record<string, FrontmatterValue>;
  /** Everything after the closing fence, with the fence's trailing newline removed. */
  body: string;
}

/** The exact `---` fence: a line of three or more dashes and nothing else. */
const FENCE = /^-{3,}\s*$/;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseValue(raw: string): FrontmatterValue {
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((entry) => stripQuotes(entry));
  }
  return stripQuotes(value);
}

/**
 * Split a `---`-fenced Markdown file into its header map and its body.
 *
 * A file with no leading fence has an empty header and its whole text as the
 * body — convenient for prose that needs no metadata, though every demo content
 * file here carries one.
 */
export function parseFrontmatter(source: string): Frontmatter {
  const text = source.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines.length === 0 || !FENCE.test(lines[0])) {
    return { data: {}, body: text };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error("front matter opened with `---` but was never closed");
  }

  const data: Record<string, FrontmatterValue> = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) continue;
    const colon = line.indexOf(":");
    if (colon === -1) {
      throw new Error(`front matter line is not \`key: value\`: ${JSON.stringify(line)}`);
    }
    const key = line.slice(0, colon).trim();
    if (key.length === 0) throw new Error(`front matter line has no key: ${JSON.stringify(line)}`);
    data[key] = parseValue(line.slice(colon + 1));
  }

  return { data, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}
