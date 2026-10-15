"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { AlertTriangle, ArrowLeft, CheckCircle2, History, OctagonAlert, Paperclip, Star } from "lucide-react";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { EditorBubbleMenu } from "@/components/editor/EditorBubbleMenu";
import { FindReplaceBar } from "@/components/editor/FindReplaceBar";
import { DropImagePopover } from "@/components/editor/DropImagePopover";
import { useImageDrop } from "@/components/editor/useImageDrop";
import { buildEditorExtensions } from "@/components/editor/extensions";
import { ImageDialog, type ImageDialogMode } from "@/components/editor/ImageDialog";
import { LinkDialog } from "@/components/editor/LinkDialog";
import { AttachmentDialog } from "@/components/editor/AttachmentDialog";
import { ArticleAttachments } from "@/components/editor/ArticleAttachments";
import { fieldClass, primaryButton, secondaryButton } from "@/components/editor/Modal";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import {
  ApiRequestError,
  createArticle,
  patchArticle,
  type PatchArticleBody,
} from "@/lib/editor/api";
import type { EditorViewer } from "@/lib/editor/types";
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
  AUDIENCE_LABELS,
  CLINICAL_DEPARTMENTS,
  DEPARTMENT_LABELS,
  type ArticleAudience,
  type ClinicalDepartment,
  type KnowledgeArticleStatus,
} from "@/types/portal";

/**
 * Full-page SOP editor (Markdown in, Markdown out).
 *
 * Workflow — the only transitions the UI offers, matching `ArticleStatus` and
 * the PATCH rules:
 *
 *   (new) ──save draft──▶ draft ──publish──▶ published ──save──▶ published
 *                                                              (new version)
 *
 * **Publishing is direct (prompt 7c).** Anyone who can write a procedure can
 * publish it — there is no submit-for-review step, no reviewer to pick, and no
 * approval gate. Publishing writes a new immutable version and the procedure is
 * live immediately.
 *
 * **Editing a live procedure.** A save on a published procedure omits `status`,
 * so the API keeps it published and — when the title or body actually changed —
 * snapshots a new immutable version. The version history is unaffected by the
 * removed review step: versions, diffs, and freshness signals all still work,
 * they just no longer wait on a reviewer.
 *
 * **Two publish-section controls (prompt 7c).** The audience selector says who
 * the procedure is written for (metadata; it only steers the Knowledge Home
 * feed's default view). The Essential toggle, offered to clinical leads for a
 * live procedure, pins it to the top of the Knowledge Home — a metadata-only
 * write that never versions the procedure and never moves its publish time.
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
  /** Who the procedure is written for (prompt 7c). */
  audience: ArticleAudience;
  /** Curated Essential SOP (prompt 7c). */
  isEssential: boolean;
}

export interface ArticleEditorProps {
  mode: "new" | "edit";
  viewer: EditorViewer;
  article: EditableArticle | null;
  /** Every article, for the link picker and `validateLinks` (built into a registry client-side). */
  registrySource: ReadonlyArray<{ slug: string; title: string; body_markdown: string }>;
}

type Feedback =
  | { kind: "success"; message: string }
  | { kind: "error"; status: number; message: string; details?: Record<string, unknown> };

const STATUS_LABEL: Record<KnowledgeArticleStatus, string> = {
  draft: "Draft",
  published: "Published",
};

const STATUS_STYLE: Record<KnowledgeArticleStatus, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-800",
  published: "border-[#5F6E00]/25 bg-[#AFBE23]/15 text-[#3F4A00]",
};

/** The audience selector's options, default first — the order the spec names. */
const AUDIENCE_CHOICES: readonly ArticleAudience[] = ["ALL", "MEDICAL", "NON_MEDICAL"];

/**
 * Who may curate an Essential SOP — the same role check that used to gate
 * publishing (clinical leads, and admins above them). It no longer gates
 * publishing, only curation (prompt 7c, item 3).
 */
const CURATION_FLOOR = "clinical_lead" as const;

function readMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown
    .getMarkdown()
    .trim();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

export default function ArticleEditor({ viewer, article, registrySource }: ArticleEditorProps) {
  const router = useRouter();
  const initialMarkdown = article?.body_markdown ?? "";

  const [title, setTitle] = useState(article?.title ?? "");
  const [departments, setDepartments] = useState<ClinicalDepartment[]>(article?.departments ?? []);
  const [status, setStatus] = useState<KnowledgeArticleStatus>(article?.status ?? "draft");
  const slug = article?.slug ?? null;
  // Prompt 7c publish-section state: who the procedure is written for, and
  // whether it is curated as Essential (clinical leads only).
  const [audience, setAudience] = useState<ArticleAudience>(article?.audience ?? "ALL");
  const [essential, setEssential] = useState<boolean>(article?.isEssential ?? false);
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
  const [attachOpen, setAttachOpen] = useState(false);
  // Bumped after an upload so the list re-fetches; also keys the list.
  const [attachNonce, setAttachNonce] = useState(0);
  // Bumped by the slash menu's "image" item; the effect below opens the file
  // picker, so the extension never closes over a ref.
  const [imagePickerNonce, setImagePickerNonce] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const feedbackRef = useRef<HTMLDivElement | null>(null);

  const isNew = slug === null;
  /**
   * Essential SOP curation is a clinical lead's call (prompt 7c, item 3) — the
   * same role check that used to gate publishing. It gates *curation* only.
   */
  const canCurate = roleAtLeast(viewer.role, CURATION_FLOOR);

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
          changeSummary: summary,
          contentChanged: !isNew && (title.trim() !== baseline.title.trim() || body !== baseline.markdown),
        },
        registry,
      );
    },
    [slug, baseRegistry, title, departments, changeSummary, isNew, baseline],
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
    async (action: "create" | "save" | "publish") => {
      if (!editor || busy) return;
      setFeedback(null);

      const body = readMarkdown(editor);
      const intent: EditorIntent = action;
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
        audience,
        ...(body !== baseline.markdown || isNew ? { body_markdown: body } : {}),
        ...(changeSummary.trim() ? { change_summary: changeSummary.trim() } : {}),
      };

      setBusy(action);
      try {
        if (isNew) {
          // A new procedure is created as a draft. Choosing Publish publishes it
          // in the same action — the whole loop is write → publish → read
          // (prompt 7c: no review step in between).
          const created = await createArticle({
            title: trimmedTitle,
            body_markdown: body,
            departments,
            audience,
          });
          setBaseline({ title: created.title, markdown: body, departments: created.departments });
          setAudience(created.audience);

          if (action === "publish") {
            const published = await patchArticle(created.slug, {
              status: "published",
              change_summary: changeSummary.trim() || "Initial publication.",
            });
            setStatus(published.status);
            router.push(`/portal?article=${encodeURIComponent(published.slug)}`);
            return;
          }

          router.replace(`/articles/${encodeURIComponent(created.slug)}/edit`);
          return;
        }

        if (!slug) return;
        // A published procedure's save omits `status`: it stays live and the API
        // snapshots a new version when the content actually changed.
        const next: PatchArticleBody = { ...payload };
        if (action === "publish") next.status = "published";

        const saved = await patchArticle(slug, next);
        setStatus(saved.status);
        setAudience(saved.audience);
        setEssential(saved.is_essential);
        setBaseline({ title: saved.title, markdown: body, departments: saved.departments });
        setChangeSummary("");
        setLastIntent(null);

        if (action === "publish") {
          // Straight to the reader: the new procedure is live and at the top of
          // the Knowledge Home feed.
          router.push(`/portal?article=${encodeURIComponent(saved.slug)}`);
          return;
        }
        showFeedback({ kind: "success", message: "Saved." });
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
    [editor, busy, validationFor, title, departments, audience, baseline, changeSummary, isNew, slug, router],
  );

  /**
   * Essential SOP curation (prompt 7c, item 3). A metadata-only PATCH: the API
   * writes the flag, records no version, and leaves the procedure's publish
   * timestamp — and therefore its place in the Knowledge Home feed — alone.
   */
  const toggleEssential = useCallback(async () => {
    if (!slug || busy) return;
    setFeedback(null);
    setBusy("essential");
    try {
      const saved = await patchArticle(slug, { is_essential: !essential });
      setEssential(saved.is_essential);
      showFeedback({
        kind: "success",
        message: saved.is_essential
          ? "Pinned to the top of the Knowledge Home as an Essential SOP."
          : "Removed from the Essential SOPs.",
      });
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        showFeedback({ kind: "error", status: caught.status, message: caught.message, details: caught.details });
      } else {
        showFeedback({ kind: "error", status: 0, message: "Could not change the Essential flag. Try again." });
      }
    } finally {
      setBusy(null);
    }
  }, [slug, busy, essential]);

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

  /* ---------------------------------------------------------------- render */
  const summaryRequired = !isNew && contentChanged;
  const summaryErrors = errorsFor("summary");
  /** The Essential toggle is offered on a procedure that is already live. */
  const essentialToggleVisible = !isNew && status === "published" && canCurate;

  return (
    <div className="flex h-dvh flex-col bg-[#F4F4F5] text-zinc-900">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-zinc-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={slug ? `/portal?article=${encodeURIComponent(slug)}` : "/portal"}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[#5F6E00] transition-colors hover:bg-[#AFBE23]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35"
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
          {essentialToggleVisible ? (
            /*
             * Essential SOP curation (prompt 7c, item 3). Sits in the composer
             * header for a live procedure so a clinical lead can pin it without
             * opening a draft — the write is metadata-only, so it neither
             * versions the procedure nor moves its publish time.
             */
            <button
              type="button"
              onClick={() => void toggleEssential()}
              disabled={busy !== null}
              aria-pressed={essential}
              title={
                essential
                  ? "Essential SOP — pinned to the top of the Knowledge Home"
                  : "Pin this procedure to the top of the Knowledge Home"
              }
              className={cx(
                "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/45 focus-visible:ring-offset-1",
                "disabled:cursor-not-allowed disabled:opacity-60",
                essential
                  ? "border-[#5F6E00]/30 bg-[#AFBE23]/20 text-[#3F4A00]"
                  : "border-zinc-300/60 bg-white text-zinc-700 hover:border-[#5F6E00]/40 hover:text-[#3F4A00]",
              )}
            >
              <Star
                size={14}
                strokeWidth={1.75}
                aria-hidden="true"
                fill={essential ? "#AFBE23" : "none"}
              />
              {busy === "essential" ? "Saving…" : "Essential SOP"}
            </button>
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
                    : "border-zinc-300/70 focus:border-[#5F6E00]/40 focus:ring-[#5F6E00]/15",
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
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35",
                        selected
                          ? "border-[#5F6E00]/40 bg-[#AFBE23]/20 text-[#5F6E00]"
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

          {/* Attachments — authors attach reference files to the article. */}
          <section aria-label="Attachments" className="rounded-xl border border-zinc-300/70 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-zinc-500">Attachments</h2>
              {slug ? (
                <button
                  type="button"
                  className={cx(secondaryButton, "h-8 gap-1.5 px-2.5 text-[13px]")}
                  onClick={() => setAttachOpen(true)}
                >
                  <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
                  Attach file
                </button>
              ) : null}
            </div>
            {slug ? (
              <div className="mt-3">
                <ArticleAttachments key={attachNonce} slug={slug} />
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-zinc-500">Save this procedure as a draft before attaching files.</p>
            )}
          </section>

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
                placeholder="What changed, and why? Becomes this version’s changelog."
                aria-invalid={summaryErrors.length > 0 ? true : undefined}
                aria-describedby={summaryErrors.length > 0 ? "change-summary-error" : undefined}
                className={cx(fieldClass, summaryErrors.length > 0 && "border-red-300")}
              />
              {summaryErrors.map((issue) => (
                <p key={issue.code} id="change-summary-error" role="alert" className="mt-1 text-xs text-red-700">
                  {issue.message}
                </p>
              ))}
            </div>

            {/*
              * Audience selector (prompt 7c, item 6). Content metadata, not a
              * permission: it steers the Knowledge Home feed's default view.
              * Default first, then the two narrower choices.
              */}
            <div className="w-full sm:w-56">
              <label htmlFor="audience" className="mb-1 block text-xs font-semibold text-zinc-600">
                Audience
              </label>
              <select
                id="audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value as ArticleAudience)}
                className={fieldClass}
              >
                {AUDIENCE_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice === "ALL" ? "All staff" : AUDIENCE_LABELS[choice]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11.5px] leading-4 text-zinc-500">
                Everyone can still read this procedure; the selector only sets which feed it
                appears in by default.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isNew ? (
                <>
                  <button type="button" className={secondaryButton} disabled={!editor || busy !== null} onClick={() => void run("create")}>
                    {busy === "create" ? "Saving…" : "Save draft"}
                  </button>
                  <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("publish")}>
                    {busy === "publish" ? "Publishing…" : "Publish"}
                  </button>
                </>
              ) : null}

              {!isNew && status === "draft" ? (
                <>
                  <button type="button" className={secondaryButton} disabled={!editor || busy !== null} onClick={() => void run("save")}>
                    {busy === "save" ? "Saving…" : "Save draft"}
                  </button>
                  <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("publish")}>
                    {busy === "publish" ? "Publishing…" : "Publish"}
                  </button>
                </>
              ) : null}

              {!isNew && status === "published" ? (
                <button type="button" className={primaryButton} disabled={!editor || busy !== null} onClick={() => void run("save")}>
                  {busy === "save" ? "Saving…" : contentChanged ? "Save & republish" : "Save changes"}
                </button>
              ) : null}
            </div>
          </div>

          {status === "draft" ? (
            <p className="text-xs leading-5 text-zinc-500">
              Publishing makes this procedure live immediately and records version 1. There is no
              review step — you can edit and publish again at any time.
            </p>
          ) : null}
          {!isNew && status === "published" ? (
            <p className="text-xs leading-5 text-zinc-500">
              This procedure is live. Saving records a new immutable version when the title or body
              changed; the Essential toggle in the header pins it to the top of the Knowledge Home
              without versioning it.
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

      {attachOpen && slug ? (
        <AttachmentDialog
          slug={slug}
          onClose={() => setAttachOpen(false)}
          onUploaded={() => {
            setAttachOpen(false);
            setAttachNonce((value) => value + 1);
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
      <p role="status" className="flex items-center gap-2 rounded-lg border border-[#5F6E00]/20 bg-[#AFBE23]/20 px-3 py-2 text-[13px] font-medium text-[#3F4A00]">
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
