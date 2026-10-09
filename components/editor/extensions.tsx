"use client";

import { Extension, mergeAttributes, Node, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { TextAlign } from "@tiptap/extension-text-align";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Highlight } from "@tiptap/extension-highlight";
import { Typography } from "@tiptap/extension-typography";
import { Dropcursor } from "@tiptap/extension-dropcursor";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { DragHandle } from "@tiptap/extension-drag-handle";
import { Plugin } from "@tiptap/pm/state";
import { Markdown } from "tiptap-markdown";
import {
  LINE_HEIGHTS,
  serializeBlockAttributes,
  splitBlockAttributes,
  type LineHeight,
  type TextAlignment,
} from "@/lib/markdown/block-attributes";
import { findInlineClose, INLINE_DELIMITERS, MARK_DELIMITERS } from "@/lib/markdown/inline-conventions";
import { CALLOUT_VARIANTS, normalizeVariant, type CalloutVariant } from "@/lib/markdown/parser";
import {
  clampWidth,
  serializeImageMarkdown,
} from "@/lib/markdown/image-attributes";
import { splitCellSpan, serializeCellSpan } from "@/lib/markdown/cell-attributes";
import {
  CTA_LABEL_MAX_LENGTH,
  SPOTLIGHT_OPEN_RE,
  STEPS_OPEN_RE,
  isValidCtaHref,
  parseSpotlightLine,
  parseStepLine,
  serializeCtaMarkdown,
  serializeSpotlightLine,
  serializeStepLine,
  type SpotlightEntryData,
  type StepData,
} from "@/lib/markdown/bulletin-blocks";
import { FootnoteDefinitionView } from "@/components/editor/FootnoteView";
import { ImageView } from "@/components/editor/ImageView";
import { SlashCommands } from "@/components/editor/slash";
import { FindHighlight } from "@/components/editor/findHighlight";
import { createDragHandleElement, dragWrappersAsUnit, excludeFootnotesAndTables } from "@/components/editor/dragHandle";
import { sanitizePastedHtml } from "@/lib/editor/paste-sanitize";

/**
 * The editor's schema: Markdown in, Markdown out.
 *
 * `body_markdown` is the stored format and the reader renders it; the editor is
 * a different view of the same text, not a second content model. Every node
 * here serializes to exactly the syntax `lib/markdown/parser.ts` reads:
 *
 *   callout    →  > [!variant]\n> text
 *   details    →  :::details Summary … :::
 *   taskList   →  - [ ] / - [x]
 *   image      →  ![alt](url "caption"){width=N align=X}   (block-level)
 *   footnote   →  [^label] and [^label]: text
 *   table      →  GFM pipe table         (one paragraph per cell, header row first)
 *   codeBlock  →  ```lang                (`mermaid` renders a diagram)
 *
 * Paragraph and heading formatting rides on the same kind of suffix:
 *
 *   paragraph  →  Text.{align=center line-height=1.5}
 *   heading    →  ## Title {#id align=center}
 *
 * Inline emphasis the reader can show:
 *
 *   subscript  →  H~2~O
 *   superscript→  m^2^
 *   highlight  →  ==mark==
 *
 * Deliberately NOT in the schema: strike, underline, hard breaks, font /
 * colour — nothing the reader cannot show, nothing that could be silently lost
 * on a round trip.
 *
 * `tiptap-markdown` is configured with `html: false`: it never emits or parses
 * raw HTML, matching the reader's no-raw-HTML posture.
 */

/** The subset of prosemirror-markdown's serializer state these specs use. */
interface MarkdownState {
  out: string;
  inTable?: boolean;
  write(content?: string): void;
  text(text: string, escape?: boolean): void;
  esc(text: string, startOfLine?: boolean): string;
  closeBlock(node: unknown): void;
  ensureNewLine(): void;
  renderContent(node: unknown): void;
  renderInline(node: unknown, fromBlockStart?: boolean): void;
  repeat(text: string, count: number): string;
  wrapBlock(delim: string, firstDelim: string | null, node: unknown, render: () => void): void;
}

interface PMNodeLike {
  text?: string | null;
  attrs: Record<string, unknown>;
  /** Present on real ProseMirror nodes; the paragraph serializer reads its size. */
  content?: {
    size: number;
    childCount?: number;
    forEach?: (callback: (node: PMNodeLike, offset: number, index: number) => void) => void;
  };
}

/* ------------------------------------------------------------------- text */

/**
 * Replaces StarterKit's text node only to change how text is serialized.
 *
 * tiptap-markdown's stock serializer HTML-escapes `<` and `>` (so "BP < 90"
 * would be stored as `BP &lt; 90`, which the reader would show verbatim).
 * Here `<` is backslash-escaped instead, `|` is escaped inside table cells,
 * and a literal `&name;` is protected from entity decoding.
 */
const MarkdownText = Node.create({
  name: "text",
  group: "inline",
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          const start = state.out.length;
          state.text(node.text ?? "");
          let written = state.out.slice(start);
          written = written.replace(/</g, "\\<").replace(/&(?=#?\w+;)/g, "\\&");
          if (state.inTable) written = written.replace(/\|/g, "\\|");
          state.out = state.out.slice(0, start) + written;
        },
        parse: {},
      },
    };
  },
});

/* ------------------------------------------------------------------ image */

const ArticleImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      /** The caption, stored as the Markdown image title. */
      title: { default: null },
      /** Pixel width from the `{width=…}` suffix; `null` = intrinsic. */
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute("data-width");
          if (!raw) return null;
          const parsed = Number.parseInt(raw, 10);
          return Number.isFinite(parsed) ? clampWidth(parsed) : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.width ? { "data-width": String(attributes.width) } : {},
      },
      /** Alignment from the `{align=…}` suffix; `null` = centred. */
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute("data-align");
          return raw === "left" || raw === "center" || raw === "right" ? raw : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.align ? { "data-align": String(attributes.align) } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { class: "dw-image", loading: "lazy" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(
            serializeImageMarkdown({
              alt: state.esc(String(node.attrs.alt ?? "")),
              src: String(node.attrs.src ?? ""),
              title: node.attrs.title ? String(node.attrs.title) : null,
              width: node.attrs.width === null || node.attrs.width === undefined ? null : Number(node.attrs.width),
              align: (node.attrs.align as "left" | "center" | "right" | null) ?? null,
            }),
          );
          state.closeBlock(node);
        },
        parse: {
          // markdown-it renders `![alt](src "cap"){width=480}` as an <img> whose
          // trailing `{…}` becomes ordinary text; lift the suffix onto the img
          // so the block-image rule can match it cleanly.
          updateDOM(element: HTMLElement) {
            element.querySelectorAll("img").forEach((img) => {
              const next = img.nextSibling;
              if (!next || next.nodeType !== 3) return;
              const text = next.textContent ?? "";
              const match = /^\s*\{([^}]*)\}/.exec(text);
              if (!match) return;
              for (const part of match[1].split(/\s+/)) {
                const [key, value] = part.split("=");
                if (key === "width" && value) {
                  const width = Number.parseInt(value, 10);
                  if (Number.isFinite(width)) img.setAttribute("data-width", String(clampWidth(width)));
                } else if (key === "align" && (value === "left" || value === "center" || value === "right")) {
                  img.setAttribute("data-align", value);
                }
              }
              const remainder = text.slice(match[0].length);
              if (remainder.length > 0) next.textContent = remainder;
              else next.remove();
            });
          },
        },
      },
    };
  },
});

/* ---------------------------------------------------------------- callout */

export const CALLOUT_LABELS: Record<CalloutVariant, string> = {
  note: "Note",
  tip: "Tip",
  dosing: "Dosing",
  protocol: "Protocol",
  warning: "Warning",
  critical: "Critical",
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the selection in a callout, or change the variant of the callout it is in. */
      setCallout: (variant: CalloutVariant) => ReturnType;
      unsetCallout: () => ReturnType;
    };
    details: {
      insertDetails: () => ReturnType;
    };
    footnote: {
      /** Insert a footnote reference at the cursor, ensuring a definition block exists. */
      insertFootnote: () => ReturnType;
    };
    lineHeight: {
      /** Set the line spacing of the block (paragraph or heading) at the selection. */
      setLineHeight: (lineHeight: LineHeight) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "paragraph+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "note",
        parseHTML: (element: HTMLElement) => normalizeVariant(element.getAttribute("data-callout") ?? "note"),
        renderHTML: (attributes: Record<string, unknown>) => {
          const variant = CALLOUT_VARIANTS.includes(attributes.variant as CalloutVariant)
            ? (attributes.variant as CalloutVariant)
            : "note";
          return { "data-callout": variant, "data-label": CALLOUT_LABELS[variant] };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "dw-callout" }), 0];
  },
  addCommands() {
    return {
      setCallout:
        (variant: CalloutVariant) =>
        ({ commands, editor }) =>
          editor.isActive("callout")
            ? commands.updateAttributes("callout", { variant })
            : commands.wrapIn("callout", { variant }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift("callout"),
    };
  },
  addKeyboardShortcuts() {
    return {
      // Enter on an empty trailing paragraph steps out of the callout.
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!selection.empty || !editor.isActive("callout")) return false;
        const { $from } = selection;
        const isEmptyParagraph = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
        const isLastChild = $from.index($from.depth - 1) === $from.node($from.depth - 1).childCount - 1;
        if (isEmptyParagraph && isLastChild && $from.node($from.depth - 1).childCount > 1) {
          return editor.commands.liftEmptyBlock();
        }
        return false;
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(`> [!${String(node.attrs.variant ?? "note")}]\n`);
          state.wrapBlock("> ", null, node, () => state.renderContent(node));
        },
        parse: {
          // markdown-it renders `> [!tip]\n> text` as <blockquote><p>[!tip]\ntext</p></blockquote>.
          updateDOM(element: HTMLElement) {
            element.querySelectorAll("blockquote").forEach((quote) => {
              const first = quote.firstElementChild;
              const lead = first?.firstChild;
              if (!first || first.tagName !== "P" || !lead || lead.nodeType !== 3) return;
              const match = /^\[!(\w+)\][ \t]*\n?/.exec(lead.textContent ?? "");
              if (!match) return;

              lead.textContent = (lead.textContent ?? "").slice(match[0].length);
              if (!lead.textContent) lead.remove();
              if (first.childNodes.length === 0) first.remove();

              const callout = element.ownerDocument.createElement("div");
              callout.setAttribute("data-callout", normalizeVariant(match[1]));
              while (quote.firstChild) callout.appendChild(quote.firstChild);
              quote.replaceWith(callout);
            });
          },
        },
      },
    };
  },
});

/* ---------------------------------------------------------------- details */

interface DetailsOptionsLike {
  summary: string;
}

/**
 * markdown-it block rule for `:::details Summary … :::` (nestable). Written in
 * house — no markdown-it-container dependency. Fenced code inside a details
 * block that itself contains a bare `:::` line is the one thing it does not
 * look through; the reader's parser handles that case, authors rarely write it.
 */
function detailsPlugin(md: unknown) {
  // markdown-it's types are not needed for this one rule; keep the plugin self-contained.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const instance = md as any;
  if (instance.__doveDetails) return;
  instance.__doveDetails = true;

  instance.block.ruler.before(
    "fence",
    "dove_details",
    (state: any, startLine: number, endLine: number, silent: boolean) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const open = /^:::details(?:\s+(.*))?\s*$/.exec(state.src.slice(start, max));
      if (!open) return false;
      if (silent) return true;

      let depth = 1;
      let next = startLine + 1;
      for (; next < endLine; next += 1) {
        const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]).trim();
        if (/^:::details(\s|$)/.test(line)) depth += 1;
        else if (line === ":::") {
          depth -= 1;
          if (depth === 0) break;
        }
      }

      const token = state.push("dove_details_open", "div", 1);
      token.block = true;
      token.attrs = [
        ["data-type", "details"],
        ["data-summary", (open[1] ?? "").trim() || "Details"],
      ];
      token.map = [startLine, next];

      const oldParent = state.parentType;
      const oldLineMax = state.lineMax;
      state.parentType = "container";
      state.lineMax = next;
      state.md.block.tokenize(state, startLine + 1, next);
      state.parentType = oldParent;
      state.lineMax = oldLineMax;

      const close = state.push("dove_details_close", "div", -1);
      close.block = true;
      state.line = next < endLine ? next + 1 : next;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

function DetailsView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="dw-details" data-type="details">
      <div contentEditable={false} className="dw-details-summary">
        <span aria-hidden="true" className="dw-details-chevron">
          ▸
        </span>
        <input
          type="text"
          value={String(node.attrs.summary ?? "")}
          onChange={(event) => updateAttributes({ summary: event.target.value.replace(/\s+/g, " ") })}
          aria-label="Collapsible section title (what readers see while it is collapsed)"
          placeholder="Section title"
          maxLength={160}
        />
      </div>
      <NodeViewContent className="dw-details-body" />
    </NodeViewWrapper>
  );
}

const Details = Node.create<DetailsOptionsLike>({
  name: "details",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      summary: {
        default: "Details",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-summary") || "Details",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="details"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "details", "data-summary": node.attrs.summary }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DetailsView);
  },
  addCommands() {
    return {
      insertDetails:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: "details",
            attrs: { summary: "Details" },
            content: [{ type: "paragraph" }],
          }),
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          const summary = String(node.attrs.summary ?? "").replace(/\s+/g, " ").trim() || "Details";
          state.write(`:::details ${summary}\n`);
          state.renderContent(node);
          state.write(":::");
          state.closeBlock(node);
        },
        parse: {
          setup: detailsPlugin,
        },
      },
    };
  },
});

/* --------------------------------------------------------------- footnotes */

/**
 * markdown-it block rule for `[^label]: text`.
 *
 * Without this, markdown-it swallows the line as a CommonMark *link reference
 * definition* (label `^label`, destination `text`) and renders nothing. The rule
 * runs before `reference` and emits a `div[data-type="footnote-definition"]`
 * carrying the label, with the remaining text as a paragraph.
 */
function footnotePlugin(md: unknown) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const instance = md as any;
  if (instance.__doveFootnotes) return;
  instance.__doveFootnotes = true;

  instance.block.ruler.before(
    "reference",
    "dove_footnote",
    (state: any, startLine: number, endLine: number, silent: boolean) => {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const match = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/.exec(state.src.slice(start, max));
      if (!match) return false;
      if (silent) return true;

      const open = state.push("dove_footnote_open", "div", 1);
      open.block = true;
      open.attrs = [
        ["data-type", "footnote-definition"],
        ["data-label", match[1]],
      ];
      open.map = [startLine, startLine + 1];

      const paragraphOpen = state.push("paragraph_open", "p", 1);
      paragraphOpen.block = true;
      // Parse the text into `children` only. Setting `content` alongside
      // `children` makes markdown-it render the text twice.
      const inline = state.push("inline", "", 0);
      inline.map = [startLine, startLine + 1];
      inline.children = [];
      state.md.inline.parse(match[2], state.md, state.env, inline.children);
      const paragraphClose = state.push("paragraph_close", "p", -1);
      paragraphClose.block = true;

      const close = state.push("dove_footnote_close", "div", -1);
      close.block = true;
      state.line = startLine + 1;
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footnote-ref"),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.label ? { "data-footnote-ref": String(attributes.label) } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote-ref]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { class: "dw-fn-ref" }), String(node.attrs.label ?? "")];
  },
  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ editor, commands }) => {
          const labels = new Set<string>();
          editor.state.doc.descendants((node) => {
            if (node.type.name === "footnoteReference" || node.type.name === "footnoteDefinition") {
              const label = node.attrs.label;
              if (typeof label === "string" && label.length > 0) labels.add(label);
            }
            return true;
          });

          let next = 1;
          while (labels.has(String(next))) next += 1;
          const label = String(next);

          commands.insertContent({ type: "footnoteReference", attrs: { label } });
          commands.insertContentAt(editor.state.doc.content.size, {
            type: "footnoteDefinition",
            attrs: { label },
            content: [{ type: "paragraph" }],
          });
          return true;
        },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(`[^${String(node.attrs.label ?? "")}]`);
        },
        parse: {
          updateDOM(element: HTMLElement) {
            const doc = element.ownerDocument;
            const walker = doc.createTreeWalker(element, 4); // NodeFilter.SHOW_TEXT
            const targets: Text[] = [];
            let current = walker.nextNode();
            while (current) {
              const text = current as Text;
              const parent = text.parentElement;
              if (parent && !parent.closest("code, pre, sup[data-footnote-ref]") && /\[\^[^\]\s]+\]/.test(text.data)) {
                targets.push(text);
              }
              current = walker.nextNode();
            }

            for (const text of targets) {
              const parts = text.data.split(/(\[\^[^\]\s]+\])/g);
              const fragment = doc.createDocumentFragment();
              for (const part of parts) {
                const match = /^\[\^([^\]\s]+)\]$/.exec(part);
                if (match) {
                  const sup = doc.createElement("sup");
                  sup.setAttribute("data-footnote-ref", match[1]);
                  sup.textContent = match[1];
                  fragment.appendChild(sup);
                } else if (part.length > 0) {
                  fragment.appendChild(doc.createTextNode(part));
                }
              }
              text.replaceWith(fragment);
            }
          },
        },
      },
    };
  },
});

const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "paragraph",
  defining: true,
  addAttributes() {
    return {
      label: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-label"),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.label ? { "data-label": String(attributes.label) } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="footnote-definition"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "footnote-definition" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FootnoteDefinitionView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(`[^${String(node.attrs.label ?? "")}]: `);
          state.renderContent(node);
          state.closeBlock(node);
        },
        parse: {
          setup: footnotePlugin,
        },
      },
    };
  },
});

/* ------------------------------------------------------------- task lists */

const TaskList = Node.create({
  name: "taskList",
  group: "block list",
  content: "taskItem+",
  addAttributes() {
    return {
      // Read by prosemirror-markdown's list serializer: tight lists have no
      // blank line between items (bullet / numbered lists get this from
      // tiptap-markdown itself; task lists are ours).
      tight: { default: true, parseHTML: () => true, renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    // Priority above the stock `ul` rule, or bullet lists swallow task lists on load.
    return [{ tag: 'ul[data-type="taskList"]', priority: 51 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes(HTMLAttributes, { "data-type": "taskList", class: "dw-tasklist" }), 0];
  },
});

function TaskItemView({ node, updateAttributes }: NodeViewProps) {
  const checked = Boolean(node.attrs.checked);
  return (
    <NodeViewWrapper as="li" data-type="taskItem" data-checked={checked} className="dw-task">
      <label contentEditable={false} className="dw-task-box">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => updateAttributes({ checked: event.target.checked })}
          aria-label="Done"
        />
      </label>
      <NodeViewContent className="dw-task-body" />
    </NodeViewWrapper>
  );
}

const TaskItem = Node.create({
  name: "taskItem",
  content: "paragraph block*",
  defining: true,
  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-checked") === "true",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-checked": attributes.checked ? "true" : "false" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'li[data-type="taskItem"]', priority: 51 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["li", mergeAttributes(HTMLAttributes, { "data-type": "taskItem" }), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView);
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});

/* -------------------------------------------------------- block formatting */

/**
 * Line spacing as a block attribute (`line-height` on the paragraph/heading),
 * with the three steps the toolbar offers. Tiptap's own TextAlign extension
 * supplies text alignment the same way; both ride on the single stored `{…}`
 * suffix that `lib/markdown/block-attributes.ts` defines.
 */
const LineHeight = Extension.create<{ types: string[] }>({
  name: "lineHeight",
  addOptions() {
    return { types: [] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.style.lineHeight;
              return (LINE_HEIGHTS as readonly string[]).includes(raw) ? (raw as LineHeight) : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.lineHeight ? { style: `line-height: ${String(attributes.lineHeight)}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight:
        (lineHeight: LineHeight) =>
        ({ commands }) =>
          this.options.types.some((type) => commands.updateAttributes(type, { lineHeight })),
      unsetLineHeight:
        () =>
        ({ commands }) =>
          this.options.types.some((type) => commands.resetAttributes(type, "lineHeight")),
    };
  },
});

/** The stored `{align=… line-height=…}` suffix for a block, or `""`. */
function blockFormattingSuffix(attrs: Record<string, unknown>): string {
  return serializeBlockAttributes({
    align: (attrs.textAlign as TextAlignment | null) ?? null,
    lineHeight: (attrs.lineHeight as LineHeight | null) ?? null,
  });
}

/**
 * Paragraphs serialize exactly as prosemirror-markdown does, plus the suffix
 * the reader reads back. An empty block carries no suffix — a `{align=…}` on a
 * blank line would be prose, not formatting.
 */
const BlockParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.renderInline(node);
          const suffix = (node.content?.size ?? 0) > 0 ? blockFormattingSuffix(node.attrs) : "";
          if (suffix) state.write(suffix);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

const BlockHeading = Heading.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(`${state.repeat("#", Number(node.attrs.level ?? 1))} `);
          state.renderInline(node, false);
          // A heading's suffix follows a space, as `## Title {#id}` always has.
          const suffix = (node.content?.size ?? 0) > 0 ? blockFormattingSuffix(node.attrs) : "";
          if (suffix) state.write(` ${suffix}`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

/** The last text node inside a block, or `null` when it holds no text. */
function lastTextNode(element: HTMLElement): Text | null {
  let found: Text | null = null;
  const walker = element.ownerDocument.createTreeWalker(element, 4); // NodeFilter.SHOW_TEXT
  for (let node = walker.nextNode(); node; node = walker.nextNode()) found = node as Text;
  return found;
}

/**
 * Pre-parse pass over markdown-it's output: lift the trailing `{align=…}` group
 * off a paragraph or heading and onto the element, where TextAlign and
 * LineHeight's own `parseHTML` rules pick it up. A group no key recognises is
 * left alone, and one that follows an `<img>` belongs to the image node — its
 * own `{width=… align=…}` suffix.
 */
function applyBlockFormatting(element: HTMLElement) {
  element.querySelectorAll<HTMLElement>("p, h1, h2, h3").forEach((block) => {
    const text = lastTextNode(block);
    if (!text) return;
    if (text.previousElementSibling?.tagName === "IMG") return;

    const parsed = splitBlockAttributes(text.data);
    if (parsed.text === text.data) return; // nothing recognised: the text stands

    text.data = parsed.text;
    if (parsed.align) block.style.textAlign = parsed.align;
    if (parsed.lineHeight) block.style.lineHeight = parsed.lineHeight;
  });
}

const BlockFormatting = Extension.create({
  name: "blockFormatting",
  addStorage() {
    return {
      markdown: {
        parse: { updateDOM: applyBlockFormatting },
      },
    };
  },
});

/* ----------------------------------------------------- inline delimiters */

/**
 * markdown-it inline rules for `~sub~`, `^sup^` and `==mark==`.
 *
 * Written in house for the same reason the details and footnote rules are: the
 * delimiters must mean exactly what `lib/markdown/inline.ts` says they mean, so
 * both sides close a run with `findInlineClose` from
 * `lib/markdown/inline-conventions.ts`. markdown-it emits `<sub>` / `<sup>` /
 * `<mark>`, which the Tiptap marks below parse; the run's content is tokenized
 * into the same stream, so `H~2~O` and `==**urgent**==` nest properly.
 */
function inlineDelimiterPlugin(md: unknown) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const instance = md as any;
  if (instance.__doveInlineDelimiters) return;
  instance.__doveInlineDelimiters = true;

  for (const spec of INLINE_DELIMITERS) {
    instance.inline.ruler.before("emphasis", `dove_${spec.kind}`, (state: any, silent: boolean) => {
      const start = state.pos;
      const src: string = state.src;
      if (!src.startsWith(spec.marker, start)) return false;
      // `[^1]` is a footnote reference; `~~`, `^^` and `===` are not delimiters.
      if (spec.marker === "^" && src[start - 1] === "[") return false;
      if (src[start - 1] === spec.marker[0]) return false;

      const close = findInlineClose(src, start + spec.marker.length, state.posMax, spec);
      if (close === -1) return false;
      if (silent) return true;

      const open = state.push(`${spec.kind}_open`, spec.tag, 1);
      open.markup = spec.marker;

      // Tokenize the content in place, as markdown-it's own link rule does.
      const outerPos = state.pos;
      const outerMax = state.posMax;
      state.pos = start + spec.marker.length;
      state.posMax = close;
      state.md.inline.tokenize(state);
      state.pos = outerPos;
      state.posMax = outerMax;

      const shut = state.push(`${spec.kind}_close`, spec.tag, -1);
      shut.markup = spec.marker;
      state.pos = close + spec.marker.length;
      return true;
    });
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

const InlineDelimiters = Extension.create({
  name: "inlineDelimiters",
  addStorage() {
    return {
      markdown: {
        parse: { setup: inlineDelimiterPlugin },
      },
    };
  },
});

/**
 * The three marks, serialized with the same delimiters the reader parses. The
 * elements markdown-it emits are exactly the tags these extensions already
 * parse, so no `parseHTML` override is needed.
 */
const MarkdownSubscript = Subscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { ...MARK_DELIMITERS.subscript, expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

const MarkdownSuperscript = Superscript.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { ...MARK_DELIMITERS.superscript, expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

const MarkdownHighlight = Highlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { ...MARK_DELIMITERS.highlight, expelEnclosingWhitespace: true },
        parse: {},
      },
    };
  },
});

/* --------------------------------------------- bulletin-only block nodes */

/*
 * CTA button, Steps and Spotlight are registered only when
 * `buildEditorExtensions({ bulletinBlocks: true })` — the bulletin composer
 * passes it, the article editor does not — so they can never leak into an
 * article. Each round-trips to the exact stored Markdown defined in
 * `lib/markdown/bulletin-blocks.ts`, and each renders as a small editor card.
 */

function liftCtaBlocks(element: HTMLElement) {
  element.querySelectorAll("p").forEach((paragraph) => {
    const anchors = paragraph.querySelectorAll("a");
    if (anchors.length !== 1) return;
    const anchor = anchors[0];
    let trailing = "";
    let sibling = anchor.nextSibling;
    while (sibling) {
      trailing += sibling.textContent ?? "";
      sibling = sibling.nextSibling;
    }
    if (!/^\s*\{\.cta\}\s*$/.test(trailing)) return;

    const div = element.ownerDocument.createElement("div");
    div.setAttribute("data-block", "cta");
    div.setAttribute("data-label", anchor.textContent ?? "");
    div.setAttribute("data-href", anchor.getAttribute("href") ?? "");
    paragraph.replaceWith(div);
  });
}

/** A markdown-it block rule for `:::steps` / `:::spotlight` (bulletin-only). */
function bulletinFencePlugin(kind: "steps" | "spotlight") {
  return function setup(md: unknown) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const instance = md as any;
    const guard = `__doveBulletin_${kind}`;
    if (instance[guard]) return;
    instance[guard] = true;

    instance.block.ruler.before(
      "fence",
      `dove_bulletin_${kind}`,
      (state: any, startLine: number, endLine: number, silent: boolean) => {
        const start = state.bMarks[startLine] + state.tShift[startLine];
        const max = state.eMarks[startLine];
        const openRe = kind === "steps" ? STEPS_OPEN_RE : SPOTLIGHT_OPEN_RE;
        if (!openRe.test(state.src.slice(start, max))) return false;
        if (silent) return true;

        let next = startLine + 1;
        for (; next < endLine; next += 1) {
          const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]).trim();
          if (line === ":::") break;
        }

        const items: unknown[] = [];
        for (let i = startLine + 1; i < next; i += 1) {
          const line = state.src.slice(state.bMarks[i] + state.tShift[i], state.eMarks[i]);
          const parsed = kind === "steps" ? parseStepLine(line) : parseSpotlightLine(line);
          if (parsed) items.push(parsed);
        }

        const token = state.push(`dove_bulletin_${kind}`, "div", 0);
        token.block = true;
        token.attrs = [
          ["data-block", kind],
          [kind === "steps" ? "data-steps" : "data-spotlight", JSON.stringify(items)],
        ];
        token.map = [startLine, next];
        state.line = next < endLine ? next + 1 : next;
        return true;
      },
      { alt: ["paragraph", "reference", "blockquote", "list"] },
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
}

function readSteps(node: PMNodeLike): StepData[] {
  return Array.isArray(node.attrs.steps) ? (node.attrs.steps as StepData[]) : [];
}
function readEntries(node: PMNodeLike): SpotlightEntryData[] {
  return Array.isArray(node.attrs.entries) ? (node.attrs.entries as SpotlightEntryData[]) : [];
}

function CtaButtonView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const href = String(node.attrs.href ?? "");
  const invalid = href.trim().length > 0 && !isValidCtaHref(href);
  return (
    <NodeViewWrapper className="dw-block dw-cta-block" data-block="cta">
      <div contentEditable={false} className="flex flex-col gap-2 rounded-lg border border-zinc-300/60 bg-white p-3 sm:flex-row sm:items-center">
        <input
          aria-label="Button label"
          value={String(node.attrs.label ?? "")}
          maxLength={CTA_LABEL_MAX_LENGTH}
          placeholder="Button label"
          onChange={(event) => updateAttributes({ label: event.target.value })}
          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300/60 bg-white px-2.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
        />
        <input
          aria-label="Button link"
          value={href}
          placeholder="https://… or /portal/path"
          onChange={(event) => updateAttributes({ href: event.target.value })}
          className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300/60 bg-white px-2.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
        />
        <button
          type="button"
          onClick={() => deleteNode()}
          className="h-8 shrink-0 rounded-md border border-zinc-300/60 px-2.5 text-[12.5px] font-medium text-zinc-600 transition-colors hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
        >
          Remove
        </button>
      </div>
      {invalid ? (
        <p role="alert" className="mt-1.5 text-xs text-red-700">
          Link must start with https:// or a single “/” (a portal path).
        </p>
      ) : null}
    </NodeViewWrapper>
  );
}

function StepsView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const steps = readSteps(node);
  const replace = (next: StepData[]) => updateAttributes({ steps: next });
  return (
    <NodeViewWrapper className="dw-block dw-steps-block" data-block="steps">
      <div contentEditable={false} className="space-y-2.5 rounded-lg border border-zinc-300/60 bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Steps</p>
          <button
            type="button"
            onClick={() => replace([...steps, { title: "", description: "" }])}
            className="h-7 rounded-md border border-zinc-300/60 px-2 text-[12px] font-medium text-zinc-700 transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            Add step
          </button>
        </div>
        {steps.map((step, index) => (
          <div key={index} className="flex items-start gap-2.5">
            <span className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-600/30 bg-teal-50 text-[12px] font-semibold tabular-nums text-[#0F766E]">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <input
                aria-label={`Step ${index + 1} title`}
                value={step.title}
                placeholder="Step title"
                onChange={(event) => replace(steps.map((entry, i) => (i === index ? { ...entry, title: event.target.value } : entry)))}
                className="h-8 w-full rounded-md border border-zinc-300/60 bg-white px-2.5 text-[13px] font-medium text-zinc-900 placeholder:font-normal placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
              />
              <textarea
                aria-label={`Step ${index + 1} description`}
                value={step.description}
                placeholder="Description"
                rows={2}
                onChange={(event) => replace(steps.map((entry, i) => (i === index ? { ...entry, description: event.target.value } : entry)))}
                className="w-full resize-y rounded-md border border-zinc-300/60 bg-white px-2.5 py-1.5 text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
              />
            </div>
            <button
              type="button"
              onClick={() => replace(steps.filter((_, i) => i !== index))}
              aria-label={`Remove step ${index + 1}`}
              className="mt-1.5 h-7 shrink-0 rounded-md border border-zinc-300/60 px-2 text-[12px] font-medium text-zinc-600 transition-colors hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
            >
              Remove
            </button>
          </div>
        ))}
        {steps.length === 0 ? (
          <button
            type="button"
            onClick={() => deleteNode()}
            className="text-[12px] font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
          >
            Remove empty steps block
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

function SpotlightView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const entries = readEntries(node);
  const replace = (next: SpotlightEntryData[]) => updateAttributes({ entries: next });
  return (
    <NodeViewWrapper className="dw-block dw-spotlight-block" data-block="spotlight">
      <div contentEditable={false} className="space-y-2.5 rounded-lg border border-zinc-300/60 bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Spotlight</p>
          <button
            type="button"
            onClick={() => replace([...entries, { initials: "", name: "", label: "" }])}
            className="h-7 rounded-md border border-zinc-300/60 px-2 text-[12px] font-medium text-zinc-700 transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            Add entry
          </button>
        </div>
        {entries.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              aria-label={`Entry ${index + 1} initials`}
              value={entry.initials}
              maxLength={3}
              placeholder="AB"
              onChange={(event) => replace(entries.map((e, i) => (i === index ? { ...e, initials: event.target.value } : e)))}
              className="h-8 w-12 shrink-0 rounded-md border border-zinc-300/60 bg-white px-2 text-center text-[13px] font-semibold uppercase text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
            />
            <input
              aria-label={`Entry ${index + 1} name`}
              value={entry.name}
              placeholder="Full name"
              onChange={(event) => replace(entries.map((e, i) => (i === index ? { ...e, name: event.target.value } : e)))}
              className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300/60 bg-white px-2.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
            />
            <input
              aria-label={`Entry ${index + 1} label`}
              value={entry.label}
              placeholder="Label"
              onChange={(event) => replace(entries.map((e, i) => (i === index ? { ...e, label: event.target.value } : e)))}
              className="h-8 min-w-0 flex-1 rounded-md border border-zinc-300/60 bg-white px-2.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
            />
            <button
              type="button"
              onClick={() => replace(entries.filter((_, i) => i !== index))}
              aria-label={`Remove entry ${index + 1}`}
              className="h-8 shrink-0 rounded-md border border-zinc-300/60 px-2 text-[12px] font-medium text-zinc-600 transition-colors hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
            >
              Remove
            </button>
          </div>
        ))}
        {entries.length === 0 ? (
          <button
            type="button"
            onClick={() => deleteNode()}
            className="text-[12px] font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
          >
            Remove empty spotlight block
          </button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

const CtaButton = Node.create({
  name: "ctaButton",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-label") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-label": String(attributes.label ?? "") }),
      },
      href: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-href") ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-href": String(attributes.href ?? "") }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-block="cta"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block": "cta", class: "dw-cta-block" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CtaButtonView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(serializeCtaMarkdown(String(node.attrs.label ?? ""), String(node.attrs.href ?? "")));
          state.closeBlock(node);
        },
        parse: { updateDOM: liftCtaBlocks },
      },
    };
  },
});

const Steps = Node.create({
  name: "steps",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      steps: {
        default: [] as StepData[],
        parseHTML: (element: HTMLElement) => {
          try {
            const raw = element.getAttribute("data-steps");
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        },
        renderHTML: (attributes: Record<string, unknown>) => ({ "data-steps": JSON.stringify(attributes.steps ?? []) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-block="steps"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block": "steps", class: "dw-steps-block" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(StepsView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(":::steps\n");
          readSteps(node).forEach((step, index) => state.write(`${serializeStepLine(step, index + 1)}\n`));
          state.write(":::");
          state.closeBlock(node);
        },
        parse: { setup: bulletinFencePlugin("steps") },
      },
    };
  },
});

const Spotlight = Node.create({
  name: "spotlight",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      entries: {
        default: [] as SpotlightEntryData[],
        parseHTML: (element: HTMLElement) => {
          try {
            const raw = element.getAttribute("data-spotlight");
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-spotlight": JSON.stringify(attributes.entries ?? []),
        }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-block="spotlight"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block": "spotlight", class: "dw-spotlight-block" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SpotlightView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.write(":::spotlight\n");
          readEntries(node).forEach((entry) => state.write(`${serializeSpotlightLine(entry)}\n`));
          state.write(":::");
          state.closeBlock(node);
        },
        parse: { setup: bulletinFencePlugin("spotlight") },
      },
    };
  },
});

/* --------------------------------------------------------------- paste */

/**
 * Cleans pasted HTML (Word / Google Docs) before it reaches the schema. A
 * ProseMirror plugin prop rather than an editor prop so it lives with the rest
 * of the schema and both hosts get it for free.
 */
const PasteCleanup = Extension.create({
  name: "pasteCleanup",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML: (html: string) => sanitizePastedHtml(html),
        },
      }),
    ];
  },
});

/* -------------------------------------------------------- merged cells */

/**
 * `{colspan=2}` / `{rowspan=N}` survive the round trip through per-cell
 * attributes: the text suffix is lifted onto the cell element on parse, and the
 * serializer writes it back after the cell's text. The `table` serializer is
 * replaced outright because tiptap-markdown's default refuses to serialize any
 * table with a spanned cell (it falls back to raw HTML, which `html: false`
 * cannot emit).
 */
function cellSpanAttribute(name: "colspan" | "rowspan") {
  return {
    default: 1,
    parseHTML: (element: HTMLElement) => {
      const parsed = Number.parseInt(element.getAttribute(name) ?? "", 10);
      return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      Number(attributes[name]) > 1 ? { [name]: String(attributes[name]) } : {},
  };
}

/** Lift a trailing `{colspan=…}` / `{rowspan=…}` off each cell's text. */
function liftCellSpans(element: HTMLElement) {
  element.querySelectorAll<HTMLElement>("th, td").forEach((cell) => {
    const text = lastTextNode(cell);
    if (!text) return;
    const parsed = splitCellSpan(text.data);
    if (parsed.colspan <= 1 && parsed.rowspan <= 1) return;
    text.data = parsed.text;
    if (parsed.colspan > 1) cell.setAttribute("colspan", String(parsed.colspan));
    if (parsed.rowspan > 1) cell.setAttribute("rowspan", String(parsed.rowspan));
  });
}

/** The child nodes of a block as an array (ProseMirror `Fragment.forEach`). */
function nodeChildren(node: PMNodeLike): PMNodeLike[] {
  const out: PMNodeLike[] = [];
  node.content?.forEach?.((child: PMNodeLike) => {
    out.push(child);
  });
  return out;
}

/** One pipe-table cell: its first paragraph rendered inline, then its span. */
function writeCellContent(state: MarkdownState, cell: PMNodeLike) {
  const first = nodeChildren(cell)[0];
  if (first) state.renderInline(first);
  const span = serializeCellSpan({
    colspan: Number(cell.attrs.colspan ?? 1),
    rowspan: Number(cell.attrs.rowspan ?? 1),
  });
  if (span) state.write(` ${span}`);
}

const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          state.inTable = true;
          nodeChildren(node).forEach((row, rowIndex) => {
            const cells = nodeChildren(row);
            state.write("| ");
            cells.forEach((cell, cellIndex) => {
              if (cellIndex) state.write(" | ");
              writeCellContent(state, cell);
            });
            state.write(" |");
            state.ensureNewLine();
            if (rowIndex === 0) {
              const delimiter = Array.from({ length: cells.length }).map(() => "---").join(" | ");
              state.write(`| ${delimiter} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});

const MarkdownTableCell = TableCell.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: cellSpanAttribute("colspan"),
      rowspan: cellSpanAttribute("rowspan"),
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          writeCellContent(state, node);
        },
        parse: { updateDOM: liftCellSpans },
      },
    };
  },
});

const MarkdownTableHeader = TableHeader.extend({
  content: "paragraph",
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: cellSpanAttribute("colspan"),
      rowspan: cellSpanAttribute("rowspan"),
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownState, node: PMNodeLike) {
          writeCellContent(state, node);
        },
        parse: { updateDOM: liftCellSpans },
      },
    };
  },
});

/* ---------------------------------------------------------------- builder */

/** Links the reader will render: web, mail, phone, site-relative, in-page. */
function isAllowedLinkUri(url: string): boolean {
  const value = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(value)) return true;
  if (value.startsWith("#")) return true;
  return value.startsWith("/") && !value.startsWith("//");
}

export interface EditorExtensionOptions {
  /** Opens the host's link dialog (the dialog state lives in the host). */
  onLink: () => void;
  /** Opens the host's hidden image file input → ImageDialog. */
  onImage: () => void;
  /**
   * Register the bulletin-only block nodes (CTA button, Steps, Spotlight).
   * The bulletin composer passes `true`; the article editor leaves it unset, so
   * those nodes can never appear in — or be pasted into — an article.
   */
  bulletinBlocks: boolean;
}

export function buildEditorExtensions(options: Partial<EditorExtensionOptions> = {}) {
  const onLink = options.onLink ?? (() => {});
  const onImage = options.onImage ?? (() => {});
  const bulletinBlocks = options.bulletinBlocks === true;
  return [
    StarterKit.configure({
      // Paragraphs and headings are re-declared below: their stored form
      // carries the paragraph-formatting suffix.
      paragraph: false,
      heading: false,
      strike: false,
      underline: false,
      hardBreak: false,
      text: false, // replaced by MarkdownText below
      // Dropcursor is re-declared below with the house colour, so StarterKit's
      // default instance is switched off to avoid a duplicate-name schema.
      dropcursor: false,
      link: { openOnClick: false, autolink: false, isAllowedUri: isAllowedLinkUri },
    }),
    BlockHeading.configure({ levels: [1, 2, 3] }), // H1 is not offered in the toolbar but must survive a round trip
    BlockParagraph,
    MarkdownText,
    // Paragraph formatting: alignment, line spacing, and the suffix that makes
    // both survive a save → reload → render round trip.
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    LineHeight.configure({ types: ["heading", "paragraph"] }),
    BlockFormatting,
    // Inline emphasis the reader can show.
    MarkdownSubscript,
    MarkdownSuperscript,
    MarkdownHighlight,
    InlineDelimiters,
    Typography.configure({
      // Smart quotes, em dashes and ellipses only. The rest of Tiptap's
      // typography set would rewrite clinical text — `2 x 3` into `2 × 3`,
      // `10^2` into `10²` — and fight the `^` superscript syntax.
      leftArrow: false,
      rightArrow: false,
      copyright: false,
      trademark: false,
      servicemark: false,
      registeredTrademark: false,
      oneHalf: false,
      oneQuarter: false,
      threeQuarters: false,
      plusMinus: false,
      notEqual: false,
      laquo: false,
      raquo: false,
      multiplication: false,
      superscriptTwo: false,
      superscriptThree: false,
    }),
    ArticleImage,
    Callout,
    Details,
    FootnoteReference,
    FootnoteDefinition,
    TaskList,
    TaskItem,
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    // One paragraph per cell: that is all a Markdown pipe table can hold, and
    // anything richer would be dropped on save. Span attributes ride on the
    // cell nodes so `{colspan=2}` / `{rowspan=N}` round-trip.
    MarkdownTableHeader,
    MarkdownTableCell,
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: "-",
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
    // Editor chrome: the `/` command menu, the drag handle, and find-match
    // decorations. The slash menu's host callbacks come from the host, because
    // the link dialog and the image file input live there.
    SlashCommands.configure({ onLink, onImage }),
    FindHighlight,
    // Pasted Word / Google Docs HTML is reduced to the schema's own element set
    // before it is parsed — no classes, styles, namespaces, VML, or images.
    PasteCleanup,
    // The drop indicator 5b shipped without: a 2px petroleum-teal line where a
    // dragged block will land. No custom CSS class needed.
    Dropcursor.configure({ color: "#0f766e", width: 2 }),
    DragHandle.configure({
      render: createDragHandleElement,
      // Nested handles are enabled so list items get one too; the default rules
      // already exclude table structure (rows/cells) and deprioritise the list
      // wrapper, and the two rules below additionally (a) exclude footnote
      // definitions and anything nested in a table and (b) make a callout /
      // details drag as one unit rather than through its inner paragraphs.
      nested: {
        defaultRules: true,
        rules: [
          { id: "excludeFootnotesAndTables", evaluate: excludeFootnotesAndTables },
          { id: "dragWrappersAsUnit", evaluate: dragWrappersAsUnit },
        ],
      },
    }),
    // Bulletin-only blocks, registered by flag so articles can never carry them.
    ...(bulletinBlocks ? [CtaButton, Steps, Spotlight] : []),
  ];
}
