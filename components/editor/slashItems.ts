/**
 * The slash-command registry: one definition per command, shared by the
 * suggestion menu's rendering and by `scripts/verify-frontend.ts`.
 *
 * Every item is `{ id, label, icon, run }`. `run` receives the editor, the
 * range of the `/query` text the suggestion matched, and the two host
 * callbacks (opening the link dialog, opening the image file picker) that the
 * editor itself cannot own. The registry is DOM-free — it only reaches for the
 * editor's command API at call time — so it can be imported and asserted
 * without a browser.
 */
import type { Editor, Range } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  Asterisk,
  ClipboardCheck,
  Heading2,
  Heading3,
  ImagePlus,
  Info,
  Lightbulb,
  Link2,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  OctagonAlert,
  Pill,
  Table2,
  TriangleAlert,
  Workflow,
} from "lucide-react";

export interface SlashRunContext {
  editor: Editor;
  range: Range;
  /** Open the host's hidden file input → ImageDialog. */
  onImage: () => void;
  /** Set the host's `linkDialogOpen` state. */
  onLink: () => void;
}

export interface SlashItem {
  id: string;
  label: string;
  /** Short description shown under the label in the menu. */
  hint: string;
  /** Extra words the filter matches on (e.g. "warning", "warn", "caution"). */
  keywords: string[];
  icon: LucideIcon;
  run: (context: SlashRunContext) => void;
}

/** Delete the `/query` text, then run the block command at the cursor. */
function replaceThen(context: SlashRunContext, apply: (chain: ReturnType<Editor["chain"]>) => void): void {
  const chain = context.editor.chain().focus().deleteRange(context.range);
  apply(chain);
  chain.run();
}

export const SLASH_ITEMS: readonly SlashItem[] = [
  {
    id: "heading-2",
    label: "Heading 2",
    hint: "Section heading",
    keywords: ["h2", "section", "title"],
    icon: Heading2,
    run: (context) => replaceThen(context, (chain) => chain.setHeading({ level: 2 })),
  },
  {
    id: "heading-3",
    label: "Heading 3",
    hint: "Sub-section heading",
    keywords: ["h3", "subsection"],
    icon: Heading3,
    run: (context) => replaceThen(context, (chain) => chain.setHeading({ level: 3 })),
  },
  {
    id: "bullet-list",
    label: "Bulleted list",
    hint: "Unordered list",
    keywords: ["ul", "bullets", "unordered"],
    icon: List,
    run: (context) => replaceThen(context, (chain) => chain.toggleBulletList()),
  },
  {
    id: "ordered-list",
    label: "Numbered list",
    hint: "Ordered list",
    keywords: ["ol", "numbers", "ordered"],
    icon: ListOrdered,
    run: (context) => replaceThen(context, (chain) => chain.toggleOrderedList()),
  },
  {
    id: "task-list",
    label: "Task list",
    hint: "Checklist",
    keywords: ["todo", "checkbox", "checklist"],
    icon: ListChecks,
    run: (context) => replaceThen(context, (chain) => chain.toggleList("taskList", "taskItem")),
  },
  {
    id: "callout-note",
    label: "Note callout",
    hint: "General information",
    keywords: ["callout", "note"],
    icon: Info,
    run: (context) => replaceThen(context, (chain) => chain.setCallout("note")),
  },
  {
    id: "callout-tip",
    label: "Tip callout",
    hint: "Practical advice",
    keywords: ["callout", "tip", "advice"],
    icon: Lightbulb,
    run: (context) => replaceThen(context, (chain) => chain.setCallout("tip")),
  },
  {
    id: "callout-dosing",
    label: "Dosing callout",
    hint: "Dosing or drug reference",
    keywords: ["callout", "dosing", "dose", "drug"],
    icon: Pill,
    run: (context) => replaceThen(context, (chain) => chain.setCallout("dosing")),
  },
  {
    id: "callout-protocol",
    label: "Protocol callout",
    hint: "Mandatory protocol step",
    keywords: ["callout", "protocol", "procedure"],
    icon: ClipboardCheck,
    run: (context) => replaceThen(context, (chain) => chain.setCallout("protocol")),
  },
  {
    id: "callout-warning",
    label: "Warning callout",
    hint: "Caution",
    keywords: ["callout", "warning", "warn", "caution"],
    icon: TriangleAlert,
    run: (context) => replaceThen(context, (chain) => chain.setCallout("warning")),
  },
  {
    id: "callout-critical",
    label: "Critical callout",
    hint: "Patient-safety critical",
    keywords: ["callout", "critical", "danger"],
    icon: OctagonAlert,
    run: (context) => replaceThen(context, (chain) => chain.setCallout("critical")),
  },
  {
    id: "table",
    label: "Table",
    hint: "3×3 table with a header row",
    keywords: ["grid", "columns", "rows"],
    icon: Table2,
    run: (context) => replaceThen(context, (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true })),
  },
  {
    id: "image",
    label: "Image",
    hint: "Upload a picture",
    keywords: ["picture", "photo", "figure", "upload"],
    icon: ImagePlus,
    run: (context) => {
      context.editor.chain().focus().deleteRange(context.range).run();
      context.onImage();
    },
  },
  {
    id: "details",
    label: "Collapsible section",
    hint: "Details block",
    keywords: ["details", "collapsible", "summary", "fold"],
    icon: ListCollapse,
    run: (context) => replaceThen(context, (chain) => chain.insertDetails()),
  },
  {
    id: "mermaid",
    label: "Mermaid diagram",
    hint: "Flowchart",
    keywords: ["mermaid", "flowchart", "diagram", "chart"],
    icon: Workflow,
    run: (context) => replaceThen(context, (chain) => chain.setCodeBlock({ language: "mermaid" })),
  },
  {
    id: "footnote",
    label: "Footnote",
    hint: "Add a footnote",
    keywords: ["footnote", "reference", "cite"],
    icon: Asterisk,
    run: (context) => replaceThen(context, (chain) => chain.insertFootnote()),
  },
  {
    id: "link",
    label: "Link",
    hint: "Link to a procedure or the web",
    keywords: ["link", "url", "href"],
    icon: Link2,
    run: (context) => {
      context.editor.chain().focus().deleteRange(context.range).run();
      context.onLink();
    },
  },
];

/**
 * Filter the registry as the author types. An empty query keeps everything.
 * Matching is case-insensitive over the label, the id and the keywords, so
 * "warning" and "warn" both find the warning callout.
 */
export function filterSlashItems(query: string, items: readonly SlashItem[] = SLASH_ITEMS): SlashItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...items];
  return items.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) ||
      item.id.toLowerCase().includes(needle) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
  );
}
