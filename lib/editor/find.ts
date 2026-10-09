/**
 * Find & replace over a ProseMirror document — pure and view-free.
 *
 * The find bar (Ctrl+H) is the only caller, and it needs three things this
 * module decides without a DOM:
 *
 *   - {@link findMatches} — every literal occurrence of the query in the text
 *     nodes of the document. Code blocks, callouts and collapsed details bodies
 *     are ordinary text nodes, so they are covered; image alt/caption are node
 *     *attributes*, not text, so they are naturally excluded from replacement.
 *   - {@link replaceAllInDoc} — the new document with every occurrence replaced,
 *     in one pass. The caller applies it as a single transaction, so replace-all
 *     is one undo step.
 *   - {@link stepMatchIndex} — wrap-around navigation between matches.
 *
 * The replacement is a literal string: no markdown, no backreference syntax.
 */
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";

export interface TextMatch {
  /** Document position of the first character. */
  from: number;
  /** Document position just past the last character. */
  to: number;
}

/** Literal occurrences of `query` in the document's text nodes, in document order. */
export function findMatches(doc: PMNode, query: string, matchCase = false): TextMatch[] {
  if (query.length === 0) return [];
  const needle = matchCase ? query : query.toLowerCase();
  const matches: TextMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    const haystack = matchCase ? node.text : node.text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      matches.push({ from: pos + index, to: pos + index + needle.length });
      index = haystack.indexOf(needle, index + needle.length);
    }
    return true;
  });

  return matches;
}

/** Wrap-around index stepping: `delta` of +1 / -1 over `total` matches. */
export function stepMatchIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

interface ReplaceOutcome {
  fragment: Fragment;
  count: number;
}

function replaceInText(node: PMNode, query: string, replacement: string, matchCase: boolean): { nodes: PMNode[]; count: number } {
  const text = node.text ?? "";
  const needle = matchCase ? query : query.toLowerCase();
  const haystack = matchCase ? text : text.toLowerCase();
  const schema = node.type.schema;

  let index = haystack.indexOf(needle);
  if (index === -1) return { nodes: [node], count: 0 };

  const nodes: PMNode[] = [];
  let last = 0;
  let count = 0;
  while (index !== -1) {
    if (index > last) nodes.push(schema.text(text.slice(last, index), node.marks));
    if (replacement.length > 0) nodes.push(schema.text(replacement, node.marks));
    count += 1;
    last = index + needle.length;
    index = haystack.indexOf(needle, last);
  }
  if (last < text.length) nodes.push(schema.text(text.slice(last), node.marks));
  return { nodes, count };
}

function replaceInFragment(fragment: Fragment, query: string, replacement: string, matchCase: boolean): ReplaceOutcome {
  const children: PMNode[] = [];
  let count = 0;

  fragment.forEach((child) => {
    if (child.isText) {
      const outcome = replaceInText(child, query, replacement, matchCase);
      children.push(...outcome.nodes);
      count += outcome.count;
    } else if (child.isLeaf) {
      children.push(child);
    } else {
      const inner = replaceInFragment(child.content, query, replacement, matchCase);
      count += inner.count;
      children.push(inner.count > 0 ? child.copy(inner.fragment) : child);
    }
  });

  return { fragment: Fragment.fromArray(children), count };
}

/**
 * The document with every occurrence replaced. Returns the original node (and a
 * count of 0) when there is nothing to change, so callers can skip the
 * transaction.
 */
export function replaceAllInDoc(
  doc: PMNode,
  query: string,
  replacement: string,
  matchCase = false,
): { doc: PMNode; count: number } {
  if (query.length === 0) return { doc, count: 0 };
  const outcome = replaceInFragment(doc.content, query, replacement, matchCase);
  return { doc: outcome.count > 0 ? doc.copy(outcome.fragment) : doc, count: outcome.count };
}
