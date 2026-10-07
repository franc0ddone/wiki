"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Asterisk,
  Bold,
  ChevronDown,
  Code,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Info,
  Italic,
  Link2,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Subscript,
  Superscript,
  Table2,
  Undo2,
} from "lucide-react";
import { CALLOUT_LABELS } from "@/components/editor/extensions";
import { LINE_HEIGHTS, LINE_HEIGHT_LABELS, type LineHeight } from "@/lib/markdown/block-attributes";
import { CALLOUT_VARIANTS, type CalloutVariant } from "@/lib/markdown/parser";
import { cx } from "@/lib/utils";

/**
 * Minimal toolbar: exactly the formatting the reader can show.
 *
 * Buttons keep the editor focused (`onMouseDown` is prevented), expose state
 * with `aria-pressed`, and the group is a single `role="toolbar"` with
 * ←/→ roving between buttons.
 */

const CALLOUT_HINTS: Record<CalloutVariant, string> = {
  note: "General information",
  tip: "Practical advice",
  dosing: "Dosing or drug reference",
  protocol: "Mandatory protocol step",
  warning: "Caution",
  critical: "Patient-safety critical",
};

function ToolButton({
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
  children,
  ...rest
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      data-tb
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40",
        active ? "bg-teal-50 text-[#0F766E] ring-1 ring-inset ring-teal-600/25" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-zinc-200" />;
}

function CalloutMenu({ editor, active }: { editor: Editor; active: CalloutVariant | null }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const handlePointer = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  const choose = (variant: CalloutVariant) => {
    editor.chain().focus().setCallout(variant).run();
    setOpen(false);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const current = items.findIndex((item) => item === document.activeElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      wrapperRef.current?.querySelector<HTMLElement>("[data-callout-trigger]")?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        data-tb
        data-callout-trigger
        aria-label="Insert callout"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active !== null}
        title="Insert callout"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          "flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40",
          active ? "bg-teal-50 text-[#0F766E] ring-1 ring-inset ring-teal-600/25" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
        )}
      >
        <Info size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[12.5px] font-medium">Callout</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Callout type"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-[calc(100%+6px)] z-30 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.22),0_2px_6px_rgba(24,24,27,0.06)]"
        >
          {CALLOUT_VARIANTS.map((variant, index) => (
            <button
              key={variant}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              onClick={() => choose(variant)}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100"
            >
              <span
                aria-hidden="true"
                className={cx(
                  "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                  variant === "warning" ? "bg-amber-500" : variant === "critical" ? "bg-red-500" : "bg-teal-600",
                )}
              />
              <span>
                <span className="block text-[13px] font-medium text-zinc-900">
                  {CALLOUT_LABELS[variant]}
                  {active === variant ? <span className="ml-1.5 text-xs font-normal text-zinc-500">(current)</span> : null}
                </span>
                <span className="block text-xs text-zinc-500">{CALLOUT_HINTS[variant]}</span>
              </span>
            </button>
          ))}
          {active ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                editor.chain().focus().unsetCallout().run();
                setOpen(false);
              }}
              className="mt-1 flex w-full items-center rounded-lg border-t border-zinc-100 px-2.5 py-2 text-left text-[13px] text-zinc-600 outline-none hover:bg-zinc-100 focus-visible:bg-zinc-100"
            >
              Remove callout
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function EditorToolbar({
  editor,
  onLink,
  onImage,
}: {
  editor: Editor;
  onLink: () => void;
  /** Opens the file picker, or the alt-text editor when an image is selected. */
  onImage: (selectedImage: boolean) => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      task: current.isActive("taskList"),
      quote: current.isActive("blockquote"),
      code: current.isActive("codeBlock"),
      codeLang: (current.getAttributes("codeBlock").language as string | null) ?? "",
      callout: current.isActive("callout") ? ((current.getAttributes("callout").variant as CalloutVariant) ?? "note") : null,
      link: current.isActive("link"),
      image: current.isActive("image"),
      table: current.isActive("table"),
      headerCell: current.isActive("tableHeader"),
      subscript: current.isActive("subscript"),
      superscript: current.isActive("superscript"),
      highlight: current.isActive("highlight"),
      alignLeft: current.isActive({ textAlign: "left" }),
      alignCenter: current.isActive({ textAlign: "center" }),
      alignRight: current.isActive({ textAlign: "right" }),
      alignJustify: current.isActive({ textAlign: "justify" }),
      lineHeight:
        ((current.isActive("heading")
          ? current.getAttributes("heading").lineHeight
          : current.getAttributes("paragraph").lineHeight) as LineHeight | null) ?? null,
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });

  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    if ((event.target as HTMLElement).closest("[role=menu]")) return;
    const buttons = Array.from(toolbarRef.current?.querySelectorAll<HTMLElement>("[data-tb]:not([disabled])") ?? []);
    const current = buttons.findIndex((button) => button === document.activeElement);
    if (current === -1) return;
    event.preventDefault();
    const next = (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  const chain = () => editor.chain().focus();
  const languageOptions = ["", "mermaid"];
  if (state.codeLang && !languageOptions.includes(state.codeLang)) languageOptions.push(state.codeLang);

  return (
    <div className="sticky top-0 z-20 rounded-t-xl border-b border-zinc-200 bg-white/95 backdrop-blur-md">
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Formatting"
        aria-controls="procedure-body"
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-0.5 px-2 py-1.5"
      >
        <ToolButton label="Bold" shortcut="Ctrl+B" active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Italic" shortcut="Ctrl+I" active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Subscript" shortcut="Ctrl+," active={state.subscript} onClick={() => chain().toggleSubscript().run()}>
          <Subscript size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Superscript" shortcut="Ctrl+." active={state.superscript} onClick={() => chain().toggleSuperscript().run()}>
          <Superscript size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Highlight" shortcut="Ctrl+Shift+H" active={state.highlight} onClick={() => chain().toggleHighlight().run()}>
          <Highlighter size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <Divider />
        <ToolButton label="Heading 2" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={17} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Heading 3" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          <Heading3 size={17} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <Divider />
        <div role="group" aria-label="Paragraph formatting" className="flex items-center gap-0.5">
          <ToolButton label="Align left" shortcut="Ctrl+Shift+L" active={state.alignLeft} onClick={() => chain().toggleTextAlign("left").run()}>
            <AlignLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          </ToolButton>
          <ToolButton label="Align center" shortcut="Ctrl+Shift+E" active={state.alignCenter} onClick={() => chain().toggleTextAlign("center").run()}>
            <AlignCenter size={16} strokeWidth={1.75} aria-hidden="true" />
          </ToolButton>
          <ToolButton label="Align right" shortcut="Ctrl+Shift+R" active={state.alignRight} onClick={() => chain().toggleTextAlign("right").run()}>
            <AlignRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </ToolButton>
          <ToolButton label="Justify" shortcut="Ctrl+Shift+J" active={state.alignJustify} onClick={() => chain().toggleTextAlign("justify").run()}>
            <AlignJustify size={16} strokeWidth={1.75} aria-hidden="true" />
          </ToolButton>
          <label htmlFor="line-spacing" className="sr-only">
            Line spacing
          </label>
          <select
            id="line-spacing"
            value={state.lineHeight ?? ""}
            title="Line spacing"
            aria-label="Line spacing"
            onChange={(event) =>
              event.target.value === ""
                ? chain().unsetLineHeight().run()
                : chain().setLineHeight(event.target.value as LineHeight).run()
            }
            className="h-8 rounded-md border border-zinc-300/70 bg-white px-1.5 text-[12.5px] text-zinc-700 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
          >
            <option value="">Line spacing</option>
            {LINE_HEIGHTS.map((value) => (
              <option key={value} value={value}>
                {LINE_HEIGHT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <Divider />
        <ToolButton label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}>
          <List size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Task list" active={state.task} onClick={() => chain().toggleList("taskList", "taskItem").run()}>
          <ListChecks size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <Divider />
        <ToolButton label="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}>
          <Quote size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <CalloutMenu editor={editor} active={state.callout} />
        <ToolButton label="Collapsible section" onClick={() => chain().insertDetails().run()}>
          <ListCollapse size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Code block" active={state.code} onClick={() => chain().toggleCodeBlock().run()}>
          <Code size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Horizontal rule" onClick={() => chain().setHorizontalRule().run()}>
          <Minus size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <Divider />
        <ToolButton label="Link" active={state.link} onClick={onLink}>
          <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Footnote" onClick={() => chain().insertFootnote().run()}>
          <Asterisk size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton
          label={state.image ? "Edit image alt text" : "Insert image"}
          active={state.image}
          onClick={() => onImage(state.image)}
        >
          <ImagePlus size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton
          label="Insert table"
          active={state.table}
          disabled={state.table}
          onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <Table2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <Divider />
        <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!state.canUndo} onClick={() => chain().undo().run()}>
          <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
        <ToolButton label="Redo" shortcut="Ctrl+Y" disabled={!state.canRedo} onClick={() => chain().redo().run()}>
          <Redo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </ToolButton>
      </div>

      {state.code ? (
        <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-1.5 text-xs text-zinc-600">
          <label htmlFor="code-language">Code block type</label>
          <select
            id="code-language"
            value={state.codeLang}
            onChange={(event) =>
              chain()
                .updateAttributes("codeBlock", { language: event.target.value || null })
                .run()
            }
            className="h-7 rounded-md border border-zinc-300/70 bg-white px-2 text-xs text-zinc-800 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
          >
            {languageOptions.map((option) => (
              <option key={option || "plain"} value={option}>
                {option === "" ? "Plain text" : option === "mermaid" ? "Mermaid diagram" : option}
              </option>
            ))}
          </select>
          {state.codeLang === "mermaid" ? <span>Readers see this as a flowchart.</span> : null}
        </div>
      ) : null}

      {state.table ? (
        <div role="toolbar" aria-label="Table" className="flex flex-wrap items-center gap-1 border-t border-zinc-100 px-3 py-1.5 text-xs">
          <span className="mr-1 font-medium text-zinc-500">Table</span>
          {[
            { label: "Add row below", run: () => chain().addRowAfter().run(), disabled: false },
            { label: "Delete row", run: () => chain().deleteRow().run(), disabled: state.headerCell },
            { label: "Add column", run: () => chain().addColumnAfter().run(), disabled: false },
            { label: "Delete column", run: () => chain().deleteColumn().run(), disabled: false },
            { label: "Delete table", run: () => chain().deleteTable().run(), disabled: false },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              data-tb
              disabled={action.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={action.run}
              title={action.disabled ? "The header row can’t be deleted" : undefined}
              className="h-7 rounded-md border border-zinc-300/70 bg-white px-2 font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
