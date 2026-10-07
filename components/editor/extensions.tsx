"use client";

import { mergeAttributes, Node, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { Markdown } from "tiptap-markdown";
import { CALLOUT_VARIANTS, normalizeVariant, type CalloutVariant } from "@/lib/markdown/parser";
import {
  clampWidth,
  serializeImageMarkdown,
} from "@/lib/markdown/image-attributes";
import { FootnoteDefinitionView } from "@/components/editor/FootnoteView";
import { ImageView } from "@/components/editor/ImageView";

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
  wrapBlock(delim: string, firstDelim: string | null, node: unknown, render: () => void): void;
}

interface PMNodeLike {
  text?: string | null;
  attrs: Record<string, unknown>;
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

/* ---------------------------------------------------------------- builder */

/** Links the reader will render: web, mail, phone, site-relative, in-page. */
function isAllowedLinkUri(url: string): boolean {
  const value = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(value)) return true;
  if (value.startsWith("#")) return true;
  return value.startsWith("/") && !value.startsWith("//");
}

export function buildEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] }, // H1 is not offered in the toolbar but must survive a round trip
      strike: false,
      underline: false,
      hardBreak: false,
      text: false, // replaced by MarkdownText below
      link: { openOnClick: false, autolink: false, isAllowedUri: isAllowedLinkUri },
    }),
    MarkdownText,
    ArticleImage,
    Callout,
    Details,
    FootnoteReference,
    FootnoteDefinition,
    TaskList,
    TaskItem,
    Table.configure({ resizable: false }),
    TableRow,
    // One paragraph per cell: that is all a Markdown pipe table can hold, and
    // anything richer would be dropped on save.
    TableHeader.extend({ content: "paragraph" }),
    TableCell.extend({ content: "paragraph" }),
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: "-",
      linkify: false,
      breaks: false,
      transformPastedText: true,
      transformCopiedText: false,
    }),
  ];
}
