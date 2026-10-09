"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { AlertTriangle, ArrowLeft, CheckCircle2, History, OctagonAlert } from "lucide-react";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { EditorBubbleMenu } from "@/components/editor/EditorBubbleMenu";
import { FindReplaceBar } from "@/components/editor/FindReplaceBar";
import { DropImagePopover } from "@/components/editor/DropImagePopover";
import { useImageDrop } from "@/components/editor/useImageDrop";
import { buildEditorExtensions } from "@/components/editor/extensions";
import { ImageDialog, type ImageDialogMode } from "@/components/editor/ImageDialog";
import { LinkDialog } from "@/components/editor/LinkDialog";
import { fieldClass, primaryButton, secondaryButton } from "@/components/editor/Modal";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import {
  ApiRequestError,
  createArticle,
  patchArticle,
  type PatchArticleBody,
} from "@/lib/editor/api";
import type { EditorViewer, ReviewerOption } from "@/lib/editor/types";
import {
  CHANGE_SUMMARY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  validateArticle,
  type EditorIntent,
  type EditorIssue,
} from "@/lib/editor/validation";
import { useDebouncedValue } from "@/lib/hooks";
import { buildLinkRegistry, extractHeadingIds, type LinkRegistry } from "@/lib/links";
import { ROLE_LABELS, roleAtLeast } from "@/lib/roles";
import { cx } from "@/lib/utils";
import {
  CLINICAL_DEPARTMENTS,
  DEPARTMENT_LABELS,
  type ClinicalDepartment,
  type KnowledgeArticleStatus,
} from "@/types/portal";

/**
 * Full-page SOP editor (Markdown in, Markdown out).
 *
 * Workflow — the only transitions the UI offers, matching `ArticleStatus` and
 * the PATCH rules:
 *
 *   (new) ──create──▶ draft ──submit for review──▶ in_review ──publish──▶ published
 *                       ▲                              │                      │
 *                       └──────── return to draft ─────┘        save & republish
 *
 * There is no draft → published shortcut: publishing is only offered from
 * `in_review`, needs a reviewer drawn from the clinical-lead pool, and the API
 * additionally refuses anyone below `clinical_lead` (that refusal is shown
 * verbatim, not hidden behind a disabled button).
 *
 * **Editing a live procedure.** An `author` may open and edit a published
 * procedure. Their save is a *plain* save — it omits `status` — so the API keeps
 * the procedure published and snapshots a new immutable version (a
 * republication). Only a `clinical_lead`+ sees "Save & republish", which sends
 * the explicit `status: "published"`. Both leave the procedure live; neither
 * lets an author publish a *draft*, which remains a clinical act.
 *
 * Every save that changes the title or body needs a change summary; it becomes
 * the version's changelog when the procedure is published. Versions are
 * immutable — this page edits the *current* text, never an old version.
 */

export interface EditableArticle {
  slug: string;
  title: string;
  body_markdown: string;
  departments: ClinicalDepartment[];
  status: KnowledgeArticleStatus;
  reviewerId: string | null;
}

export interface ArticleEditorProps {
  mode: "new" | "edit";
  viewer: EditorViewer;
  article: EditableArticle | null;
  /** Every article, for the link picker and `validateLinks` (built into a registry client-side). */
  registrySource: ReadonlyArray<{ slug: string; title: string; body_markdown: string }>;
  reviewers: readonly ReviewerOption[];
}

type Feedback =
  | { kind: "success"; message: string }
  | { kind: "error"; status: number; message: string; details?: Record<string, unknown> };

const STATUS_LABEL: Record<KnowledgeArticleStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  published: "Published",
};

const STATUS_STYLE: Record<KnowledgeArticleStatus, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-800",
  in_review: "border-sky-200 bg-sky-50 text-sky-800",
  published: "border-teal-200 bg-teal-50 text-teal-800",
};

function readMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown
    .getMarkdown()
    .trim();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

export default function ArticleEditor({ viewer, article, registrySource, reviewers }: ArticleEditorProps) {
  const router = useRouter();
  const initialMarkdown = article?.body_markdown ?? "";

  const [title, setTitle] = useState(article?.title ?? "");
  const [departments, setDepartments] = useState<ClinicalDepartment[]>(article?.departments ?? []);
  const [status, setStatus] = useState<KnowledgeArticleStatus>(article?.status ?? "draft");
  const slug = article?.slug ?? null;
  const [reviewerId, setReviewerId] = useState<string>(article?.reviewerId ?? "");
  const [changeSummary, setChangeSummary] = useState("");

  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [baseline, setBaseline] = useState({
    title: article?.title ?? "",
    markdown: initialMarkdown,
    departments: article?.departments ?? [],
  });

  const [lastIntent, setLastIntent] = useState<EditorIntent | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [imageDialog, setImageDialog] = useState<ImageDialogMode | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  // Bumped by the slash menu's "image" item; the effect below opens the file
  // picker, so the extension never closes over a ref.
  const [imagePickerNonce, setImagePickerNonce] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const feedbackRef = useRef<HTMLDivElement | null>(null);

  const canPublish = roleAtLeast(viewer.role, "clinical_lead");
  const isNew = slug === null;

  /* ----------------------------------------------------------- the editor */
  const [extensions] = useState(() =>
    buildEditorExtensions({
      // The slash menu's image and link items reach back into the host, which
      // owns the file input and the dialog state.
      onLink: () => setLinkDialogOpen(true),
      onImage: () => setImagePickerNonce((value) => value + 1),
    }),
  );
  const editor = useEditor({
    extensions,
    content: initialMarkdown,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id: "procedure-body",
        class: "dw-prose",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Procedure body",
      },
    },
    onCreate: ({ editor: created }) => {
      // The baseline is the editor's own normalised form of the stored text, so
      // "unchanged" means unchanged by the author, not merely re-serialised.
      const normalised = readMarkdown(created);
      setMarkdown(normalised);
      setBaseline((current) => ({ ...current, markdown: normalised }));
    },
    onUpdate: ({ editor: updated }) => setMarkdown(readMarkdown(updated)),
  });

  // Drag-and-drop image insertion: this host owns its own drop popover.
  const drop = useImageDrop(editor);

  // The slash menu's "image" item bumps the nonce; open the file picker here.
  useEffect(() => {
    if (imagePickerNonce > 0) fileInputRef.current?.click();
  }, [imagePickerNonce]);

  // Ctrl+H opens find/replace — only while the editor or the find bar has focus
  // (the handler is a capture listener on the wrapper that holds both). Unlike
  // the window-level Ctrl+S listener below, this one never fires from anywhere
  // else on the page, and it preventDefaults Edge's History shortcut.
  const onFindKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() !== "h" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    setFindOpen(true);
  };

  /* ----------------------------------------------------------- validation */
  const debouncedMarkdown = useDebouncedValue(markdown, 300);

  const baseRegistry = useMemo(
    () =>
      buildLinkRegistry(
        registrySource.map((entry) => ({ slug: entry.slug, bodyMarkdown: entry.body_markdown })),
      ),
    [registrySource],
  );

  const contentChanged = title.trim() !== baseline.title.trim() || markdown !== baseline.markdown;
  const dirty = contentChanged || !sameSet(departments, baseline.departments);

  const validationFor = useCallback(
    (intent: EditorIntent, body: string, summary = changeSummary): { errors: EditorIssue[]; warnings: EditorIssue[] } => {
      // The saved copy of this article is stale while it is being edited: its
      // own headings come from what is on screen now, so a link to a section
      // added this session is not flagged.
      const registry: LinkRegistry = slug
        ? {
            slugs: baseRegistry.slugs.includes(slug) ? baseRegistry.slugs : [...baseRegistry.slugs, slug],
            anchors: { ...baseRegistry.anchors, [slug]: extractHeadingIds(body) },
          }
        : baseRegistry;
      return validateArticle(
        {
          title,
          markdown: body,
          departments,
          intent,
          reviewerId: reviewerId || null,
          changeSummary: summary,
          contentChanged: !isNew && (title.trim() !== baseline.title.trim() || body !== baseline.markdown),
        },
        registry,
      );
    },
    [slug, baseRegistry, title, departments, reviewerId, changeSummary, isNew, baseline],
  );

  const live = useMemo(
    () => validationFor(lastIntent ?? (isNew ? "create" : "save"), debouncedMarkdown),
    [validationFor, lastIntent, isNew, debouncedMarkdown],
  );
  // Errors are shown only once the author has tried to save; warnings always.
  const shownErrors = lastIntent ? live.errors : [];
  const errorsFor = (field: EditorIssue["field"]) => shownErrors.filter((issue) => issue.field === field);

  /* ------------------------------------------------------- unsaved changes */
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /* ------------------------------------------------------------- actions */
  const showFeedback = (next: Feedback) => {
    setFeedback(next);
    requestAnimationFrame(() => feedbackRef.current?.scrollIntoView({ block: "nearest" }));
  };

  const run = useCallback(
    async (action: "create" | "save" | "submit_review" | "return_to_draft" | "publish") => {
      if (!editor || busy) return;
      setFeedback(null);

      const intent: EditorIntent = action === "return_to_draft" ? "save" : action;
      const body = readMarkdown(editor);
      setLastIntent(intent);

      const result = validationFor(intent, body);
      if (result.errors.length > 0) {
        showFeedback({
          kind: "error",
          status: 0,
          message: `Not saved — ${result.errors.length} ${result.errors.length === 1 ? "problem needs" : "problems need"} fixing (listed below the editor).`,
        });
        return;
      }

      const trimmedTitle = title.trim();
      const payload: PatchArticleBody = {
        title: trimmedTitle,
        departments,
        ...(body !== baseline.markdown || isNew ? { body_markdown: body } : {}),
        ...(changeSummary.trim() ? { change_summary: changeSummary.trim() } : {}),
      };

      setBusy(action);
      try {
        if (action === "create") {
          const created = await createArticle({
            title: trimmedTitle,
            body_markdown: body,
            departments,
          });
          setBaseline({ title: created.title, markdown: body, departments: created.departments });
          router.replace(`/articles/${encodeURIComponent(created.slug)}/edit`);
          return;
        }

        if (!slug) return;
        const next: PatchArticleBody = { ...payload };
        if (action === "submit_review") {
          next.status = "in_review";
          next.reviewer_id = reviewerId;
        } else if (action === "return_to_draft") {
          next.status = "draft";
        } else if (action === "publish") {
          next.status = "published";
          next.reviewer_id = reviewerId;
        }

        const saved = await patchArticle(slug, next);
        setStatus(saved.status);
        setBaseline({ title: saved.title, markdown: body, departments: saved.departments });
        setChangeSummary("");
        setLastIntent(null);

        if (action === "publish") {
          router.push(`/portal?article=${encodeURIComponent(saved.slug)}`);
          return;
        }
        showFeedback({
          kind: "success",
          message:
            action === "submit_review"
              ? "Submitted for review. A clinical lead can now review and publish it."
              : action === "return_to_draft"
                ? "Returned to draft."
                : "Saved.",
        });
      } catch (caught) {
        if (caught instanceof ApiRequestError) {
          showFeedback({
            kind: "error",
            status: caught.status,
            message: caught.message,
            details: caught.details,
          });
        } else {
          showFeedback({ kind: "error", status: 0, message: "Something went wrong while saving. Nothing was lost; try again." });
        }
      } finally {
        setBusy(null);
      }
    },
    [editor, busy, validationFor, title, departments, baseline, changeSummary, isNew, slug, reviewerId, router],
  );

  // Ctrl/Cmd+S saves (as a draft / in place — never publishes).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      if (status === "published") return; // republishing must be a deliberate click
      void run(isNew ? "create" : "save");
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [run, isNew, status]);

  /* ------------------------------------------------------- toolbar bridges */
  const openLinkDialog = () => setLinkDialogOpen(true);

  const handleImage = (selectedImage: boolean) => {
    if (!editor) return;
    if (selectedImage) {
      const attrs = editor.getAttributes("image") as { src?: string; alt?: string; title?: string | null };
      if (attrs.src) {
        setImageDialog({ kind: "alt", src: attrs.src, alt: attrs.alt ?? "", title: attrs.title ?? "" });
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const ownHeadingIds = useMemo(() => extractHeadingIds(debouncedMarkdown), [debouncedMarkdown]);
  const articleSearchOptions = useMemo(
    () =>
      registrySource.map((entry) => ({
        slug: entry.slug,
        title: entry.title,
        body_markdown: entry.body_markdown,
      })),
    [registrySource],
  );

  const selectedReviewer = reviewers.find((reviewer) => reviewer.id === reviewerId) ?? null;

  /* ---------------------------------------------------------------- render */
  const needsReviewer = status === "draft" || status === "in_review" || status === "published";
  const summaryRequired = !isNew && contentChanged;
  const summaryErrors = errorsFor("summary");
  const reviewerErrors = errorsFor("reviewer");

  return (
    <div className="flex h-dvh flex-col bg-[#F4F4F5] text-zinc-900">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={slug ? `/portal?article=${encodeURIComponent(slug)}` : "/portal"}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[#0F766E] transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" />
            {slug ? "Back to procedure" : "Back to portal"}
          </Link>
          <span aria-hidden="true" className="h-5 w-px bg-zinc-200" />
          <h1 className="truncate text-[13px] font-bold uppercase tracking-[0.06em] text-zinc-900">
            {isNew ? "New procedure" : "Edit procedure"}
          </h1>
          <span className={cx("shrink-0 rounded-full border px-2 py-px text-xs font-semibold", STATUS_STYLE[status])}>
            {isNew ? "Unsaved draft" : STATUS_LABEL[status]}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {dirty ? (
            <span className="hidden items-center gap-1.5 text-xs font-medium text-amber-800 sm:flex" role="status">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Unsaved changes
            </span>
          ) : null}
          {slug ? (
            <button type="button" className={cx(secondaryButton, "h-8 px-2.5 text-[13px]")} onClick={() => setHistoryOpen(true)}>
              <History size={14} strokeWidth={1.75} aria-hidden="true" />
              History
            </button>
          ) : null}
        </div>
      </header>

      {/* Canvas */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-scroll-root>
        <div className="mx-auto w-full max-w-[56rem] space-y-5 px-4 py-6 sm:px-6">
          <section aria-label="Procedure details" className="space-y-4">
            <div>
              <label htmlFor="article-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">
                Title
              </label>
              <input
                id="article-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Canine Parvovirus Isolation Protocol"
                aria-invalid={errorsFor("title").length > 0 ? true : undefined}
                aria-describedby="article-title-help"
                className={cx(
                  "h-12 w-full rounded-xl border bg-white px-4 text-[1.35rem] font-semibold tracking-tight text-zinc-900 shadow-[0_1px_2px_rgba(16,24,40,0.05)] placeholder:font-normal placeholder:text-zinc-400 focus:outline-none focus:ring-2",
                  errorsFor("title").length > 0
                    ? "border-red-300 focus:border-red-400 focus:ring-red-500/15"
                    : "border-zinc-300/70 focus:border-teal-600/40 focus:ring-teal-600/15",
                )}
              />
              <div id="article-title-help" className="mt-1.5 flex items-start justify-between gap-3 text-xs">
                <div className="space-y-0.5 text-red-700">
                  {errorsFor("title").map((issue) => (
                    <p key={issue.code} role="alert">
                      {issue.message}
                    </p>
                  ))}
                </div>
                <span className={cx("ml-auto shrink-0 tabular-nums", title.trim().length > TITLE_MAX_LENGTH ? "font-semibold text-red-700" : "text-zinc-400")}>
                  {title.trim().length}/{TITLE_MAX_LENGTH}
                </span>
              </div>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Departments</legend>
              <div className="flex flex-wrap gap-1.5">
                {CLINICAL_DEPARTMENTS.map((department) => {
                  const selected = departments.includes(department);
                  return (
                    <button
                      key={department}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setDepartments((current) =>
                          current.includes(department) ? current.filter((entry) => entry !== department) : [...current, department],
                        )
                      }
                      className={cx(
                        "flex h-7 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
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
              {errorsFor("departments").map((issue) => (
                <p key={issue.code} role="alert" className="mt-1.5 text-xs text-red-700">
                  {issue.message}
                </p>
              ))}
            </fieldset>
          </section>

          <section aria-label="Procedure body" className="rounded-xl border border-zinc-300/70 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_32px_-16px_rgba(16,24,40,0.18)] ring-1 ring-black/[0.04]">
            {editor ? <EditorToolbar editor={editor} onLink={openLinkDialog} onImage={handleImage} /> : <div className="h-11 border-b border-zinc-200" />}
            {editor ? (
              <div
                onKeyDownCapture={onFindKeyDownCapture}
                onDragOver={drop.onDragOver}
                onDrop={drop.onDrop}
              >
                {findOpen ? <FindReplaceBar editor={editor} onClose={() => setFindOpen(false)} /> : null}
                <div className="px-6 py-6 md:px-10 md:py-8">
                  <EditorBubbleMenu editor={editor} linkDialogOpen={linkDialogOpen} onLink={openLinkDialog} />
                  <EditorContent editor={editor} />
                </div>
                {drop.pending ? (
                  <DropImagePopover
                    editor={editor}
                    file={drop.pending.file}
                    pos={drop.pending.pos}
                    anchor={drop.pending.anchor}
                    onClose={drop.clear}
                  />
                ) : null}
              </div>
            ) : (
              <div className="px-6 py-6 md:px-10 md:py-8">
                <p className="text-[13px] text-zinc-500" role="status">
                  Loading editor…
                </p>
              </div>
            )}
          </section>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            data-testid="image-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) setImageDialog({ kind: "insert", file });
            }}
          />

          {/* Problems */}
          {errorsFor("body").length > 0 ? (
            <section aria-labelledby="body-problems" className="rounded-xl border border-red-200 bg-red-50/80 px-4 py-3.5" role="alert">
              <h2 id="body-problems" className="flex items-center gap-2 text-[13px] font-semibold text-red-800">
                <OctagonAlert size={15} strokeWidth={1.75} aria-hidden="true" />
                Fix before saving
              </h2>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-5 text-red-900">
                {errorsFor("body").map((issue, index) => (
                  <li key={`${issue.code}-${issue.target ?? index}`} data-issue={issue.code}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {live.warnings.length > 0 ? (
            <section aria-labelledby="body-warnings" className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5">
              <h2 id="body-warnings" className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                <AlertTriangle size={15} strokeWidth={1.75} aria-hidden="true" />
                Worth a look (won’t block saving)
              </h2>
              <ul className="mt-2 space-y-1.5 text-[13px] leading-5 text-amber-950">
                {live.warnings.map((issue, index) => (
                  <li key={`${issue.code}-${index}`} data-issue={issue.code}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {/* Save bar */}
      <footer className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-[56rem] space-y-3">
          <div ref={feedbackRef} aria-live="polite">
            {feedback ? <FeedbackBanner feedback={feedback} viewerRole={viewer.role} /> : null}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label htmlFor="change-summary" className="mb-1 flex items-baseline justify-between text-xs font-semibold text-zinc-600">
                <span>
                  Change summary
                  {summaryRequired ? <span className="ml-1.5 font-medium text-red-600">required</span> : null}
                </span>
                <span className={cx("tabular-nums font-normal", changeSummary.length > CHANGE_SUMMARY_MAX_LENGTH ? "text-red-700" : "text-zinc-400")}>
                  {changeSummary.length}/{CHANGE_SUMMARY_MAX_LENGTH}
                </span>
              </label>
              <input
                id="change-summary"
                value={changeSummary}
                onChange={(event) => setChangeSummary(event.target.value)}
                disabled={isNew}
                placeholder={isNew ? "Not needed for a new draft" : "What changed, and why? Becomes this version’s changelog."}
                aria-invalid={summaryErrors.length > 0 ? true : undefined}
                aria-describedby={summaryErrors.length > 0 ? "change-summary-error" : undefined}
                className={cx(fieldClass, summaryErrors.length > 0 && "border-red-300", isNew && "bg-zinc-50")}
              />
              {summaryErrors.map((issue) => (
                <p key={issue.code} id="change-summary-error" role="alert" className="mt-1 text-xs text-red-700">
                  {issue.message}
                </p>
              ))}
            </div>

            {!isNew && needsReviewer ? (
              <div className="w-full sm:w-64">
                <label htmlFor="reviewer" className="mb-1 block text-xs font-semibold text-zinc-600">
                  Reviewer (clinical lead)
                </label>
                <select
                  id="reviewer"
                  value={reviewerId}
                  onChange={(event) => setReviewerId(event.target.value)}
                  aria-invalid={reviewerErrors.length > 0 ? true : undefined}
                  aria-describedby={reviewerErrors.length > 0 ? "reviewer-error" : undefined}
                  className={cx(fieldClass, reviewerErrors.length > 0 && "border-red-300")}
                >
                  <option value="">Choose a reviewer…</option>
                  {reviewers.map((reviewer) => (
                    <option key={reviewer.id} value={reviewer.id}>
                      {reviewer.name}
                      {reviewer.title ? ` — ${reviewer.title}` : ""}
                    </option>
                  ))}
                </select>
                {reviewerErrors.map((issue) => (
                  <p key={issue.code} id="reviewer-error" role="alert" className="mt-1 text-xs text-red-700">
                    {issue.message}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {isNew ? (
                <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("create")}>
                  {busy === "create" ? "Creating…" : "Create draft"}
                </button>
              ) : null}

              {!isNew && status === "draft" ? (
                <>
                  <button type="button" className={secondaryButton} disabled={!editor || busy !== null} onClick={() => void run("save")}>
                    {busy === "save" ? "Saving…" : "Save draft"}
                  </button>
                  <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("submit_review")}>
                    {busy === "submit_review" ? "Submitting…" : "Submit for review"}
                  </button>
                </>
              ) : null}

              {!isNew && status === "in_review" ? (
                <>
                  <button type="button" className={secondaryButton} disabled={!editor || busy !== null} onClick={() => void run("return_to_draft")}>
                    {busy === "return_to_draft" ? "Returning…" : "Return to draft"}
                  </button>
                  <button type="button" className={secondaryButton} disabled={!editor || busy !== null} onClick={() => void run("save")}>
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                  <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("publish")}>
                    {busy === "publish" ? "Publishing…" : "Publish"}
                  </button>
                </>
              ) : null}

              {!isNew && status === "published" ? (
                canPublish ? (
                  <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("publish")}>
                    {busy === "publish" ? "Republishing…" : "Save & republish"}
                  </button>
                ) : (
                  // An author's save omits `status`, so the procedure stays
                  // published and a new version is recorded — republication
                  // without the clinical-lead-only explicit publish.
                  <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("save")}>
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                )
              ) : null}
            </div>
          </div>

          {!isNew && status === "in_review" && !canPublish ? (
            <p className="text-xs leading-5 text-zinc-500">
              Publishing needs the clinical lead role (you are signed in as {ROLE_LABELS[viewer.role].toLowerCase()}). You can edit and save;
              a clinical lead publishes.
            </p>
          ) : null}
          {!isNew && status === "published" ? (
            <p className="text-xs leading-5 text-zinc-500">
              This procedure is live. Saving republishes it immediately and records a new version
              {selectedReviewer ? ` reviewed by ${selectedReviewer.name}` : ""}.
            </p>
          ) : null}
        </div>
      </footer>

      {/* Dialogs */}
      {linkDialogOpen && editor ? (
        <LinkDialog
          initialHref={(editor.getAttributes("link").href as string | undefined) ?? ""}
          hasSelection={!editor.state.selection.empty || editor.isActive("link")}
          articles={articleSearchOptions}
          registry={baseRegistry}
          ownHeadingIds={ownHeadingIds}
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
              editor
                .chain()
                .focus()
                .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
                .run();
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
            editor
              .chain()
              .focus()
              .updateAttributes("image", { alt, title: title.length > 0 ? title : null })
              .run();
            setImageDialog(null);
          }}
        />
      ) : null}

      {historyOpen && slug ? (
        <VersionHistoryDialog slug={slug} articleTitle={title || "Procedure"} onClose={() => setHistoryOpen(false)} />
      ) : null}
    </div>
  );
}

function FeedbackBanner({ feedback, viewerRole }: { feedback: Feedback; viewerRole: EditorViewer["role"] }): ReactNode {
  if (feedback.kind === "success") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-[13px] font-medium text-teal-900">
        <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden="true" />
        {feedback.message}
      </p>
    );
  }

  const required = typeof feedback.details?.requiredRole === "string" ? feedback.details.requiredRole : null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-900">
      <p className="flex items-start gap-2 font-medium">
        <OctagonAlert size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          {feedback.status > 0 ? <span className="mr-1.5 rounded bg-red-100 px-1.5 py-px text-xs font-semibold tabular-nums">{feedback.status}</span> : null}
          {feedback.message}
        </span>
      </p>
      {feedback.status === 403 && required ? (
        <p className="mt-1 pl-[23px] text-xs text-red-800">
          Required role: {required.replace("_", " ")} · You are signed in as {ROLE_LABELS[viewerRole].toLowerCase()}. Your changes are still on screen.
        </p>
      ) : null}
    </div>
  );
}
