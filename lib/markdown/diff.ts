/**
 * Line-level diff for the reader's version-to-version view.
 *
 * A longest-common-subsequence over lines: the classic, readable unified-diff
 * shape (context lines, `+` additions, `-` removals). SOPs are small documents,
 * so the `O(n·m)` table is comfortably cheap and, unlike a myers/trigram
 * approximation, never surprises the reader by misaligning near-duplicate lines.
 *
 * Framework-free and side-effect-free: `MarkdownReader`'s version view and
 * `scripts/verify-frontend.ts` both exercise it.
 */

export type DiffOp = "same" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

export interface DiffSummary {
  added: number;
  removed: number;
  unchanged: number;
}

function splitLines(value: string): string[] {
  // A trailing newline should not manufacture a phantom empty final line.
  const normalised = value.replace(/\r\n?/g, "\n");
  const lines = normalised.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Diff `before` against `after`, line by line.
 *
 * The result is a linear sequence in reading order: unchanged lines, removals
 * (taken from `before`), and additions (taken from `after`). Adjacent runs are
 * emitted removal-first, then addition — how a human proofreads a change.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the LCS of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: "remove", text: a[i] });
      i += 1;
    } else {
      out.push({ op: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ op: "remove", text: a[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ op: "add", text: b[j] });
    j += 1;
  }

  return out;
}

/** Counts for the diff header, e.g. "3 added · 1 removed". */
export function summarizeDiff(lines: readonly DiffLine[]): DiffSummary {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.op === "add") added += 1;
    else if (line.op === "remove") removed += 1;
    else unchanged += 1;
  }
  return { added, removed, unchanged };
}

/**
 * Collapse long runs of unchanged lines to `context` lines around every change,
 * inserting a single gap marker (`op: "same"`, `text: ""` with the omitted count
 * carried separately) — the shape a "clean" diff view needs so an unchanged
 * 200-line SOP body does not bury the two lines that changed.
 */
export interface CollapsedDiffLine extends DiffLine {
  /** Set on a gap marker: how many unchanged lines were elided here. */
  elided?: number;
}

export function collapseDiff(lines: readonly DiffLine[], context = 3): CollapsedDiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.op === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) {
      keep[k] = true;
    }
  });

  const out: CollapsedDiffLine[] = [];
  let elided = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (elided > 0) {
        out.push({ op: "same", text: "", elided });
        elided = 0;
      }
      out.push(line);
    } else {
      elided += 1;
    }
  });
  if (elided > 0) out.push({ op: "same", text: "", elided });

  return out;
}
