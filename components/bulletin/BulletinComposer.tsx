"use client";

import { useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Eye, OctagonAlert, PenLine, TriangleAlert } from "lucide-react";
import { ArticleSearch } from "@/components/editor/ArticleSearch";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { buildEditorExtensions } from "@/components/editor/extensions";
import { ImageDialog, type ImageDialogMode } from "@/components/editor/ImageDialog";
import { LinkDialog } from "@/components/editor/LinkDialog";
import { fieldClass, Modal, primaryButton, secondaryButton } from "@/components/editor/Modal";
import { MarkdownReader } from "@/components/MarkdownReader";
import { ApiRequestError, createBulletin, patchBulletin, type BulletinPayload } from "@/lib/bulletin/api";
import {
  BULLETIN_TITLE_MAX_LENGTH,
  canPostPriority,
  expiryLabel,
  shouldClearAcksForUrgentEdit,
  validateBulletinDraft,
  type BulletinIssue,
} from "@/lib/bulletin/lifecycle";
import { buildLinkRegistry, extractHeadingIds } from "@/lib/links";
import { roleAtLeast, type Role } from "@/lib/roles";
import { cx } from "@/lib/utils";
import {
  CLINICAL_DEPARTMENTS,
  DEPARTMENT_LABELS,
  type Bulletin,
  type BulletinPriority,
  type ClinicalDepartment,
  type KnowledgeArticle,
} from "@/types/portal";

/**
 * Bulletin composer — the shared write surface, used to post a new notice and
 * to edit an existing one ("edit mode": prefilled, `Edit bulletin`, Save).
 *
 * One editor, used twice: the body is the same full Tiptap (and reader) as
 * procedures. A bulletin skips the change-summary, reviewer, and publish
 * workflow — it is live the moment it is posted, so the shape is the same but
 * the ceremony is not.
 */

export interface BulletinComposerProps {
  mode: "create" | "edit";
  role: Role;
  articles: readonly KnowledgeArticle[];
  initial?: Bulletin | null;
  onClose: () => void;
  onPosted: (bulletin: Bulletin) => void;
  onSaved: (bulletin: Bulletin) => void;
}

const PRIORITY_OPTIONS: ReadonlyArray<{ value: BulletinPriority; label: string; hint: string }> = [
  { value: "normal", label: "Notice", hint: "An ordinary announcement. May be posted without an expiry." },
  { value: "pinned", label: "Pinned", hint: "A standing reminder that floats above ordinary notices." },
  { value: "urgent", label: "Urgent", hint: "A shift-level alert. Always expires; needs the clinical lead role." },
];

function readMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown().trim();
}

function FeedbackError({ error }: { error: { status: number; message: string } }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900">
      <p className="flex items-start gap-2 font-medium">
        <OctagonAlert size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          {error.status > 0 ? (
            <span className="mr-1.5 rounded bg-red-100 px-1.5 py-px text-xs font-semibold tabular-nums">{error.status}</span>
          ) : null}
          {error.message}
        </span>
      </p>
    </div>
  );
}

export default function BulletinComposer({
  mode,
  role,
  articles,
  initial = null,
  onClose,
  onPosted,
  onSaved,
}: BulletinComposerProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [departments, setDepartments] = useState<ClinicalDepartment[]>(initial?.departments ?? []);
  const [priority, setPriority] = useState<BulletinPriority>(initial?.priority ?? "normal");
  const [expires, setExpires] = useState("");
  const [linkedSlug, setLinkedSlug] = useState(() => {
    if (!initial?.linked_sop_id) return "";
    return articles.find((article) => article.id === initial.linked_sop_id)?.slug ?? "";
  });
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [markdown, setMarkdown] = useState(initial?.body_markdown ?? "");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<BulletinIssue[]>([]);
  const [serverError, setServerError] = useState<{ status: number; message: string } | null>(null);
  const [imageDialog, setImageDialog] = useState<ImageDialogMode | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canPostRestricted = roleAtLeast(role, "clinical_lead");

  const [extensions] = useState(() => buildEditorExtensions());
  const editor = useEditor({
    extensions,
    content: initial?.body_markdown ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id: "bulletin-body",
        class: "dw-prose",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Bulletin body",
      },
    },
    onCreate: ({ editor: created }) => setMarkdown(readMarkdown(created)),
    onUpdate: ({ editor: updated }) => setMarkdown(readMarkdown(updated)),
  });

  const linkedId = useMemo(
    () => articles.find((article) => article.slug === linkedSlug)?.id ?? null,
    [articles, linkedSlug],
  );

  const articleSearchOptions = useMemo(
    () => articles.map((article) => ({ slug: article.slug, title: article.title, body_markdown: article.body_markdown })),
    [articles],
  );
  const registry = useMemo(
    () => buildLinkRegistry(articles.map((article) => ({ slug: article.slug, bodyMarkdown: article.body_markdown }))),
    [articles],
  );

  const clearsAcks =
    mode === "edit" && initial
      ? shouldClearAcksForUrgentEdit(
          { priority: initial.priority, title: initial.title, body_markdown: initial.body_markdown },
          { priority, title: title.trim(), body_markdown: markdown },
        )
      : false;

  const issueFor = (field: BulletinIssue["field"]) => issues.filter((issue) => issue.field === field);

  const expiresAtIso = (): string | null | undefined => {
    if (expires.length === 0) return undefined; // keep current / apply priority default
    const parsed = new Date(`${expires}T23:59:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  };

  const submit = async () => {
    if (busy) return;
    const body = editor ? readMarkdown(editor) : markdown;
    const result = validateBulletinDraft(
      { title, body_markdown: body, departments, priority, expires_at: expiresAtIso() ?? undefined },
      { canPostRestricted },
    );
    setIssues(result.errors);
    if (result.errors.length > 0) return;

    const payload: BulletinPayload = {
      title: title.trim(),
      body_markdown: body,
      departments,
      priority,
      linked_article_id: linkedId,
    };
    const expiresIso = expiresAtIso();
    if (expiresIso !== undefined) payload.expires_at = expiresIso;

    setBusy(true);
    setServerError(null);
    try {
      const saved =
        mode === "edit" && initial ? await patchBulletin(initial.id, payload) : await createBulletin(payload);
      if (mode === "edit") onSaved(saved);
      else onPosted(saved);
    } catch (caught) {
      setServerError(
        caught instanceof ApiRequestError
          ? { status: caught.status, message: caught.message }
          : { status: 0, message: "Something went wrong while posting. Nothing was lost; try again." },
      );
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === "edit" ? "Edit bulletin" : "New bulletin"}
      description={
        mode === "edit"
          ? "Changes go live the moment you save. Editing an urgent notice clears its acknowledgements."
          : "Posting makes this notice live immediately — there is no review step for a bulletin."
      }
      onClose={onClose}
      widthClass="max-w-3xl"
      dismissible={!busy}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label htmlFor="bulletin-title" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
            Headline
          </label>
          <input
            id="bulletin-title"
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={BULLETIN_TITLE_MAX_LENGTH}
            aria-invalid={issueFor("title").length > 0 ? true : undefined}
            placeholder="e.g. Blood bank fridge temperature check — new log sheet"
            className={cx(fieldClass, issueFor("title").length > 0 && "border-red-300")}
            disabled={busy}
          />
          {issueFor("title").map((issue) => (
            <p key={issue.code} role="alert" className="mt-1 text-xs text-red-700">
              {issue.message}
            </p>
          ))}
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-zinc-800">Departments</legend>
          <div className="flex flex-wrap gap-1.5">
            {CLINICAL_DEPARTMENTS.map((department) => {
              const selected = departments.includes(department);
              return (
                <button
                  key={department}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() =>
                    setDepartments((current) =>
                      current.includes(department) ? current.filter((entry) => entry !== department) : [...current, department],
                    )
                  }
                  className={cx(
                    "flex h-7 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
                    selected
                      ? "border-teal-600/40 bg-teal-50 text-teal-800"
                      : "border-zinc-300/60 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900",
                  )}
                >
                  {DEPARTMENT_LABELS[department]}
                </button>
              );
            })}
          </div>
          {issueFor("departments").map((issue) => (
            <p key={issue.code} role="alert" className="mt-1.5 text-xs text-red-700">
              {issue.message}
            </p>
          ))}
        </fieldset>

        {/* Body: write / preview */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-zinc-800">Body</span>
            <div role="tablist" aria-label="Body view" className="flex gap-1 rounded-lg bg-zinc-100 p-0.5">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "write"}
                onClick={() => setTab("write")}
                className={cx(
                  "flex h-7 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
                  tab === "write" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900",
                )}
              >
                <PenLine size={13} strokeWidth={1.75} aria-hidden="true" />
                Write
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "preview"}
                onClick={() => setTab("preview")}
                className={cx(
                  "flex h-7 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
                  tab === "preview" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900",
                )}
              >
                <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
                Preview
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-300/70 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
            {tab === "write" ? (
              <>
                {editor ? (
                  <EditorToolbar
                    editor={editor}
                    onLink={() => setLinkDialogOpen(true)}
                    onImage={(selected) => {
                      if (!editor) return;
                      if (selected) {
                        const attrs = editor.getAttributes("image") as { src?: string; alt?: string; title?: string | null };
                        if (attrs.src) {
                          setImageDialog({ kind: "alt", src: attrs.src, alt: attrs.alt ?? "", title: attrs.title ?? "" });
                        }
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                  />
                ) : (
                  <div className="h-11 border-b border-zinc-200" />
                )}
                <div className="max-h-[42vh] overflow-y-auto px-5 py-5">
                  {editor ? (
                    <EditorContent editor={editor} />
                  ) : (
                    <p className="text-[13px] text-zinc-500" role="status">
                      Loading editor…
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="max-h-[42vh] overflow-y-auto px-5 py-5">
                <MarkdownReader source={markdown.length > 0 ? markdown : "_Nothing to preview yet._"} showTableOfContents={false} />
              </div>
            )}
          </div>
          {issueFor("body").map((issue) => (
            <p key={issue.code} role="alert" className="mt-1.5 text-xs text-red-700">
              {issue.message}
            </p>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="bulletin-priority" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Priority
            </label>
            <select
              id="bulletin-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as BulletinPriority)}
              className={cx(fieldClass, "mb-1")}
              disabled={busy}
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} disabled={!canPostPriority(role, option.value)}>
                  {option.label}
                  {canPostPriority(role, option.value) ? "" : " — clinical lead only"}
                </option>
              ))}
            </select>
            <p className="text-xs leading-5 text-zinc-500">
              {PRIORITY_OPTIONS.find((option) => option.value === priority)?.hint}
              {!canPostRestricted && priority !== "normal"
                ? " You do not hold the clinical lead role."
                : null}
            </p>
            {issueFor("priority").map((issue) => (
              <p key={issue.code} role="alert" className="mt-1 text-xs text-red-700">
                {issue.message}
              </p>
            ))}
          </div>

          <div>
            <label htmlFor="bulletin-expires" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
              Expires <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              id="bulletin-expires"
              type="date"
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
              className={cx(fieldClass, "mb-1")}
              disabled={busy}
            />
            <p className="text-xs leading-5 text-zinc-500">
              {mode === "edit"
                ? `Leave blank to keep the current expiry. Changing the priority applies: ${expiryLabel(priority)}.`
                : `Leave blank for the default: ${expiryLabel(priority)}.`}
            </p>
            {issueFor("expiry").map((issue) => (
              <p key={issue.code} role="alert" className="mt-1 text-xs text-red-700">
                {issue.message}
              </p>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-800">
            Linked SOP <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <ArticleSearch
            articles={articleSearchOptions}
            value={linkedSlug}
            label="Linked procedure"
            placeholder="Search procedures to reference…"
            onChange={(slug) => setLinkedSlug(slug)}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          data-testid="bulletin-image-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) setImageDialog({ kind: "insert", file });
          }}
        />

        {clearsAcks ? (
          <aside role="note" className="flex gap-3 rounded-[10px] border border-amber-200 bg-amber-50/80 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
            <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" />
            Saving clearing acknowledgements: this will change an urgent notice, so everyone who acknowledged the current
            text must acknowledge the new one.
          </aside>
        ) : null}

        {serverError ? <FeedbackError error={serverError} /> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={primaryButton} disabled={busy || !editor}>
            {busy ? "Saving…" : mode === "edit" ? "Save changes" : "Post bulletin"}
          </button>
        </div>
      </form>

      {/* Dialogs */}
      {linkDialogOpen && editor ? (
        <LinkDialog
          initialHref={(editor.getAttributes("link").href as string | undefined) ?? ""}
          hasSelection={!editor.state.selection.empty || editor.isActive("link")}
          articles={articleSearchOptions}
          registry={registry}
          ownHeadingIds={extractHeadingIds(markdown)}
          onClose={() => {
            setLinkDialogOpen(false);
            editor.commands.focus();
          }}
          onRemove={() => {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            setLinkDialogOpen(false);
          }}
          onApply={({ href, text }) => {
            if (!editor.state.selection.empty || editor.isActive("link")) {
              editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            } else {
              editor.chain().focus().insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] }).run();
            }
            setLinkDialogOpen(false);
          }}
        />
      ) : null}

      {imageDialog && editor ? (
        <ImageDialog
          mode={imageDialog}
          onClose={() => {
            setImageDialog(null);
            editor.commands.focus();
          }}
          onInsert={({ src, alt, title }) => {
            editor
              .chain()
              .focus()
              .insertContent({ type: "image", attrs: { src, alt, title: title.length > 0 ? title : null } })
              .run();
            setImageDialog(null);
          }}
          onUpdateAlt={({ alt, title }) => {
            editor.chain().focus().updateAttributes("image", { alt, title: title.length > 0 ? title : null }).run();
            setImageDialog(null);
          }}
        />
      ) : null}
    </Modal>
  );
}
