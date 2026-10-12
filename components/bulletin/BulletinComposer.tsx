"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, Eye, ImagePlus, OctagonAlert, Paperclip, PenLine, Trash2, X } from "lucide-react";
import { ArticleSearch } from "@/components/editor/ArticleSearch";
import { EditorToolbar } from "@/components/editor/EditorToolbar";
import { EditorBubbleMenu } from "@/components/editor/EditorBubbleMenu";
import { FindReplaceBar } from "@/components/editor/FindReplaceBar";
import { DropImagePopover } from "@/components/editor/DropImagePopover";
import { useImageDrop } from "@/components/editor/useImageDrop";
import { buildEditorExtensions } from "@/components/editor/extensions";
import { ImageDialog, type ImageDialogMode } from "@/components/editor/ImageDialog";
import { LinkDialog } from "@/components/editor/LinkDialog";
import { BulletinAttachmentDialog } from "@/components/bulletin/BulletinAttachmentDialog";
import { AttachmentTypeIcon, attachmentTypeLabel } from "@/components/bulletin/AttachmentTypeIcon";
import { fieldClass, Modal, primaryButton, secondaryButton } from "@/components/editor/Modal";
import { MarkdownReader } from "@/components/MarkdownReader";
import {
  ApiRequestError,
  createBulletin,
  deleteBulletinAttachment,
  deleteStagedBulletinAttachment,
  formatBytes,
  listBulletinAttachments,
  patchBulletin,
  type BulletinAttachmentRecord,
  type BulletinPayload,
} from "@/lib/bulletin/api";
import { uploadImage } from "@/lib/editor/api";
import { HERO_ALT_MAX_LENGTH } from "@/lib/bulletin/hero";
import {
  BULLETIN_TITLE_MAX_LENGTH,
  DECK_MAX_LENGTH,
  shouldClearAcksForUrgentEdit,
  validateBulletinDraft,
  type BulletinIssue,
} from "@/lib/bulletin/lifecycle";
import { buildLinkRegistry, extractHeadingIds } from "@/lib/links";
import type { Role } from "@/lib/roles";
import { cx } from "@/lib/utils";
import {
  CLINICAL_DEPARTMENTS,
  DEPARTMENT_LABELS,
  type Bulletin,
  type ClinicalDepartment,
  type KnowledgeArticle,
} from "@/types/portal";

/**
 * Bulletin composer — the shared write surface, used to post a new notice and
 * to edit an existing one ("edit mode": prefilled, `Edit bulletin`, Save).
 *
 * Prompt 6c collapsed this to one simple model. In order: headline → deck
 * (optional) → hero image (always available) → attachments (optional) → body →
 * departments (optional, an enclosed dropdown) → Options (Pinned, which requires
 * an expiry — four preset chips — beneath it, and Urgent) → linked SOP. There
 * are no templates, no priority dropdown, no format selector, no kicker, and no
 * TTL defaults — expiry is opt-in for an ordinary post and required for a
 * pinned one.
 *
 * Prompt 6d gave it attachments: the files a notice carries (PDF / DOCX / XLSX /
 * PPTX / TXT / CSV, ≤ 25 MB). A file is uploaded the moment it is chosen — for a
 * *new* notice too, where the record comes back with no bulletin id (staged) and
 * is linked by the API as the notice is created. The section therefore behaves
 * identically in both modes: pick a file, see it listed with its type and size,
 * save. Discarding a staged file is immediate (there is nothing to save it
 * against); removing one from a posted notice happens when the notice is saved.
 * A staged file that is never linked is swept 24 h later.
 *
 * One editor, used twice: the body is the same full Tiptap (and reader) as
 * procedures. A bulletin skips the change-summary, reviewer, and publish
 * workflow — it is live the moment it is posted.
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

function readMarkdown(editor: Editor): string {
  return (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown().trim();
}

/**
 * One-tap expiry presets — the only expiry UI. Each lands at end-of-day
 * **11:45 PM** (the last 15-minute increment), so a pinned "tomorrow" notice
 * stays up through tomorrow.
 */
const EXPIRY_PRESETS = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "In 1 week" },
  { days: 30, label: "In 30 days" },
] as const;

/** `days` out from `from`, at 11:45 PM local — a preset's datetime. */
function expiryPresetDate(days: number, from: Date = new Date()): Date {
  const target = new Date(from);
  target.setDate(target.getDate() + days);
  target.setHours(23, 45, 0, 0);
  return target;
}

/** The department-dropdown button label. Empty means an all-staff post. */
function departmentSummary(departments: readonly ClinicalDepartment[]): string {
  if (departments.length === 0) return "All staff";
  return departments.length === 1 ? "1 department" : `${departments.length} departments`;
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
  articles,
  initial = null,
  onClose,
  onPosted,
  onSaved,
}: BulletinComposerProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [deck, setDeck] = useState(initial?.deck ?? "");
  const [departments, setDepartments] = useState<ClinicalDepartment[]>(initial?.departments ?? []);
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [urgent, setUrgent] = useState(initial?.urgent ?? false);
  // The chosen expiry datetime (set from a preset chip, or carried in by an
  // edit). `null` means no expiry is set.
  const [expiryDate, setExpiryDate] = useState<Date | null>(() => {
    if (!initial?.expires_at) return null;
    const parsed = new Date(initial.expires_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  });
  const [deptOpen, setDeptOpen] = useState(false);
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
  const [findOpen, setFindOpen] = useState(false);
  const [imagePickerNonce, setImagePickerNonce] = useState(0);
  // The optional hero banner (always available) and its required alt text.
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(initial?.hero_image_url ?? null);
  const [heroAlt, setHeroAlt] = useState(initial?.hero_image_alt ?? "");
  const [heroBusy, setHeroBusy] = useState(false);
  const [heroError, setHeroError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const heroInputRef = useRef<HTMLInputElement | null>(null);

  // Attachments. A file is stored the moment it is chosen (the API writes the
  // bytes and returns the record, exactly as the article dialog does); a
  // removal is only *staged* here and carried out when the bulletin is saved.
  const [attachments, setAttachments] = useState<BulletinAttachmentRecord[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Starts true in edit mode: the effect below fetches the list immediately, so
  // there is never a frame that claims "no files" before the answer arrives.
  const [attachmentsLoading, setAttachmentsLoading] = useState(mode === "edit");
  // A file attaches to a bulletin that exists, so create mode has nothing to
  // upload against yet (the section says so rather than hiding itself).
  const bulletinId = mode === "edit" ? initial?.id ?? null : null;

  const [extensions] = useState(() =>
    buildEditorExtensions({
      onLink: () => setLinkDialogOpen(true),
      onImage: () => setImagePickerNonce((value) => value + 1),
      // Bulletin-only blocks: CTA button, Steps, Spotlight.
      bulletinBlocks: true,
      // No block drag handle: its grip read as a modal-window handle the modal
      // does not have.
      dragHandle: false,
    }),
  );
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

  // Drag-and-drop image insertion — this host owns its own drop popover.
  const drop = useImageDrop(editor);

  // The slash menu's "image" item bumps the nonce; open the file picker here.
  useEffect(() => {
    if (imagePickerNonce > 0) fileInputRef.current?.click();
  }, [imagePickerNonce]);

  // The bulletin's existing attachments, loaded once when editing. A failure
  // leaves the list empty and says so; it never blocks the edit.
  useEffect(() => {
    if (!bulletinId) return;
    let active = true;
    (async () => {
      try {
        const records = await listBulletinAttachments(bulletinId);
        if (active) setAttachments(records);
      } catch {
        if (active) setAttachError("Could not load this bulletin's attachments.");
      } finally {
        if (active) setAttachmentsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [bulletinId]);

  // Ctrl+H opens find/replace while the editor or the find bar has focus.
  const onFindKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key.toLowerCase() !== "h" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    setFindOpen(true);
  };

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
          { urgent: initial.urgent, title: initial.title, body_markdown: initial.body_markdown },
          { urgent, title: title.trim(), body_markdown: markdown },
        )
      : false;

  const issueFor = (field: BulletinIssue["field"]) => issues.filter((issue) => issue.field === field);

  // Expiry is only settable on a pinned post (pinning means expiring — there is
  // no permanent pin). Tapping a preset chip is the only way to set it.
  const expirySet = pinned && expiryDate !== null;
  // The chosen datetime → the ISO string the API stores. Only a pinned post
  // carries an expiry (unchanged API contract).
  const expiresAtIso = (): string | null => (expirySet && expiryDate ? expiryDate.toISOString() : null);

  /** A preset chip: `days` out at 11:45 PM. */
  const applyExpiryPreset = (days: number) => setExpiryDate(expiryPresetDate(days));

  /**
   * Discard a *staged* file — one uploaded for a notice that does not exist yet.
   * There is nothing to save it against, so this is immediate: the record goes
   * now, and the sweep after it is only a safety net for a composer that was
   * closed without ever saving.
   */
  const discardStaged = async (item: BulletinAttachmentRecord) => {
    setAttachError(null);
    try {
      await deleteStagedBulletinAttachment(item.id);
      setAttachments((current) => current.filter((entry) => entry.id !== item.id));
    } catch (caught) {
      setAttachError(
        caught instanceof ApiRequestError
          ? `Could not discard ${item.file_name}: ${caught.message}`
          : `Could not discard ${item.file_name}. Try again.`,
      );
    }
  };

  /**
   * Carry out the removals the poster staged, after the save has succeeded —
   * "removing one in the composer deletes it on save". A file that is already
   * gone (404, from an interrupted earlier run) counts as removed, so a retry
   * is always safe; anything else is reported by name and the composer stays
   * open so the poster can try again.
   */
  const applyRemovals = async (id: string): Promise<string[]> => {
    if (removedIds.length === 0) return [];
    const targets = attachments.filter((item) => removedIds.includes(item.id));
    const failed: string[] = [];
    for (const item of targets) {
      try {
        await deleteBulletinAttachment(id, item.id);
      } catch (caught) {
        if (!(caught instanceof ApiRequestError && caught.status === 404)) {
          failed.push(item.file_name);
          continue;
        }
      }
      setAttachments((current) => current.filter((entry) => entry.id !== item.id));
      setRemovedIds((current) => current.filter((entry) => entry !== item.id));
    }
    return failed;
  };

  const submit = async () => {
    if (busy) return;
    const body = editor ? readMarkdown(editor) : markdown;
    const result = validateBulletinDraft({
      title,
      body_markdown: body,
      departments,
      deck: deck.trim() || null,
      expires_at: expiresAtIso(),
      hero_image_url: heroImageUrl,
      hero_image_alt: heroImageUrl ? heroAlt.trim() : null,
    });
    const errors = [...result.errors];
    // Pinned posts must expire — there is no permanent pin.
    if (pinned && expiryDate === null) {
      errors.push({ field: "expiry", code: "expiry_required", message: "Pinned posts need an expiry date." });
    } else if (expirySet && expiryDate && expiryDate.getTime() <= Date.now()) {
      errors.push({ field: "expiry", code: "expiry_not_future", message: "Expiry must be in the future." });
    }
    setIssues(errors);
    if (errors.length > 0) return;

    const payload: BulletinPayload = {
      title: title.trim(),
      body_markdown: body,
      departments,
      pinned,
      urgent,
      deck: deck.trim() || null,
      heroImageUrl: heroImageUrl ?? null,
      heroImageAlt: heroImageUrl ? heroAlt.trim() : null,
      linked_article_id: linkedId,
      expires_at: expiresAtIso(),
      // Files picked while writing — before this notice had an id. The API
      // links them as part of the same save.
      attachment_ids: attachments.filter((item) => item.bulletin_id === null).map((item) => item.id),
    };

    setBusy(true);
    setServerError(null);
    try {
      const saved =
        mode === "edit" && initial ? await patchBulletin(initial.id, payload) : await createBulletin(payload);
      if (mode === "edit") {
        const failed = await applyRemovals(saved.id);
        if (failed.length > 0) {
          setServerError({
            status: 0,
            message: `The bulletin was saved, but ${failed.length === 1 ? "this file" : "these files"} could not be removed: ${failed.join(", ")}. Save again to retry.`,
          });
          setBusy(false);
          return;
        }
        onSaved(saved);
      } else {
        onPosted(saved);
      }
    } catch (caught) {
      setServerError(
        caught instanceof ApiRequestError
          ? { status: caught.status, message: caught.message }
          : { status: 0, message: "Something went wrong while posting. Nothing was lost; try again." },
      );
      setBusy(false);
    }
  };

  /**
   * Upload the hero banner through the shared image pipeline. A failure keeps
   * the previous value and surfaces the error inline — the poster never loses a
   * hero that was already set.
   */
  const uploadHeroImage = async (file: File) => {
    setHeroBusy(true);
    setHeroError(null);
    try {
      const uploaded = await uploadImage(file);
      setHeroImageUrl(uploaded.url);
    } catch (caught) {
      setHeroError(
        caught instanceof ApiRequestError
          ? `Upload failed (${caught.status || "network"}): ${caught.message}`
          : "Upload failed. Try again.",
      );
    } finally {
      setHeroBusy(false);
    }
  };

  const checkboxClass =
    "mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 accent-[#5F6E00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50";

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

        <div>
          <label htmlFor="bulletin-deck" className="mb-1.5 block text-[13px] font-medium text-zinc-800">
            Deck <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="bulletin-deck"
            value={deck}
            maxLength={DECK_MAX_LENGTH}
            onChange={(event) => setDeck(event.target.value)}
            aria-invalid={issueFor("deck").length > 0 ? true : undefined}
            placeholder="A one-line summary shown under the headline."
            className={cx(fieldClass, issueFor("deck").length > 0 && "border-red-300")}
            disabled={busy}
          />
          {issueFor("deck").map((issue) => (
            <p key={issue.code} role="alert" className="mt-1 text-xs text-red-700">
              {issue.message}
            </p>
          ))}
        </div>

        {/* Hero image — always available, with required alt text. */}
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-800">
            Hero image <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          {heroImageUrl ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded preview */}
              <img
                src={heroImageUrl}
                alt={heroAlt.trim() || "Hero image preview"}
                className="h-[120px] w-full rounded-lg border border-zinc-200/80 object-cover"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => heroInputRef.current?.click()}
                  disabled={busy || heroBusy}
                  className="flex h-7 items-center gap-1.5 rounded-lg border border-zinc-300/70 bg-white px-2.5 text-[12.5px] font-medium text-zinc-700 transition-colors hover:border-[#5F6E00]/40 hover:text-[#5F6E00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ImagePlus size={13} strokeWidth={1.75} aria-hidden="true" />
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHeroImageUrl(null);
                    setHeroAlt("");
                    setHeroError(null);
                  }}
                  disabled={busy || heroBusy}
                  className="flex h-7 items-center gap-1.5 rounded-lg border border-zinc-300/70 bg-white px-2.5 text-[12.5px] font-medium text-zinc-700 transition-colors hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X size={13} strokeWidth={1.75} aria-hidden="true" />
                  Remove
                </button>
                {heroBusy ? (
                  <span role="status" className="text-xs text-zinc-500">
                    Uploading…
                  </span>
                ) : null}
              </div>
              <div>
                <label htmlFor="bulletin-hero-alt" className="mb-1 block text-[12.5px] font-medium text-zinc-700">
                  Alt text <span className="font-normal text-zinc-500">(required)</span>
                </label>
                <input
                  id="bulletin-hero-alt"
                  value={heroAlt}
                  maxLength={HERO_ALT_MAX_LENGTH}
                  onChange={(event) => setHeroAlt(event.target.value)}
                  aria-invalid={issueFor("hero_alt").length > 0 ? true : undefined}
                  placeholder="Describe the image for screen readers."
                  className={cx(fieldClass, issueFor("hero_alt").length > 0 && "border-red-300")}
                  disabled={busy}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => heroInputRef.current?.click()}
              disabled={busy || heroBusy}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-zinc-300/70 bg-white px-3 text-[12.5px] font-medium text-zinc-600 transition-colors hover:border-[#5F6E00]/40 hover:text-[#5F6E00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImagePlus size={14} strokeWidth={1.75} aria-hidden="true" />
              {heroBusy ? "Uploading…" : "Add hero image"}
            </button>
          )}
          {heroError ? (
            <p role="alert" className="mt-1.5 text-xs text-red-700">
              {heroError}
            </p>
          ) : null}
          {issueFor("hero_alt").map((issue) => (
            <p key={issue.code} role="alert" className="mt-1.5 text-xs text-red-700">
              {issue.message}
            </p>
          ))}
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">
            A full-width banner below the title card. Stored on the bulletin, never in the body.
          </p>
          <input
            ref={heroInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            data-testid="bulletin-hero-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadHeroImage(file);
            }}
          />
        </div>

        {/* Attachments — reference files the notice carries, listed below the body. */}
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-800">
            Attachments <span className="font-normal text-zinc-500">(optional)</span>
          </span>

          <div className="space-y-2">
            {attachments.length > 0 ? (
              <ul className="space-y-1.5" data-testid="bulletin-attachment-list">
                {attachments.map((item) => {
                  // A staged file belongs to no notice yet: it is discarded on the
                  // spot, because there is nothing to save it against.
                  const staged = item.bulletin_id === null;
                  const marked = removedIds.includes(item.id);
                  return (
                    <li
                      key={item.id}
                      className={cx(
                        "flex items-center gap-2.5 rounded-lg border px-3 py-2",
                        marked ? "border-zinc-200 bg-zinc-50" : "border-zinc-300/70 bg-white",
                      )}
                    >
                      <AttachmentTypeIcon
                        mimeType={item.mime_type}
                        className={cx("shrink-0", marked ? "text-zinc-300" : "text-zinc-500")}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cx(
                            "block truncate text-[13px] font-medium",
                            marked ? "text-zinc-400 line-through" : "text-zinc-800",
                          )}
                        >
                          {item.file_name}
                        </span>
                        <span className={cx("block text-xs", marked ? "text-zinc-400" : "text-zinc-500")}>
                          {attachmentTypeLabel(item.mime_type, item.file_name)} · {formatBytes(item.size_bytes)}
                          {staged ? <span className="text-zinc-400"> · attaches on save</span> : null}
                        </span>
                      </span>

                      {marked ? (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="text-xs text-zinc-400">Removed on save</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRemovedIds((current) => current.filter((entry) => entry !== item.id))}
                            className="flex h-7 items-center rounded-lg border border-zinc-300/70 bg-white px-2 text-[12.5px] font-medium text-zinc-700 transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Undo
                          </button>
                        </span>
                      ) : confirmRemoveId === item.id ? (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="text-xs text-zinc-500">
                            {staged ? "Discard this file?" : "Remove on save?"}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const target = item;
                              setConfirmRemoveId(null);
                              if (staged) void discardStaged(target);
                              else setRemovedIds((current) => (current.includes(target.id) ? current : [...current, target.id]));
                            }}
                            className="flex h-7 items-center rounded-lg border border-red-200 bg-white px-2 text-[12.5px] font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {staged ? "Discard" : "Remove"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmRemoveId(null)}
                            className="flex h-7 items-center rounded-lg border border-zinc-300/70 bg-white px-2 text-[12.5px] font-medium text-zinc-700 transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`${staged ? "Discard" : "Remove"} ${item.file_name}`}
                          onClick={() => setConfirmRemoveId(item.id)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-300/70 bg-white text-zinc-500 transition-colors hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-zinc-500" role="status">
                {attachmentsLoading ? "Loading attachments…" : "No files attached yet."}
              </p>
            )}

            <button
              type="button"
              onClick={() => setAttachOpen(true)}
              disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-zinc-300/70 bg-white px-3 text-[12.5px] font-medium text-zinc-600 transition-colors hover:border-[#5F6E00]/40 hover:text-[#5F6E00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
              Attach file
            </button>
          </div>

          {attachError ? (
            <p role="alert" className="mt-1.5 text-xs text-red-700">
              {attachError}
            </p>
          ) : null}
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">
            PDF, Word, Excel, PowerPoint, text, or CSV — up to 25 MB each. A file uploads as soon as you pick it and lands
            on the notice when you save; it is listed below the post as a download, never rendered inline. Discarding a file
            before you post deletes it straight away — on a posted notice, removing one deletes it when you save.
          </p>
        </div>

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
              <div onKeyDownCapture={onFindKeyDownCapture} onDragOver={drop.onDragOver} onDrop={drop.onDrop}>
                {/* One scroll area: the formatting toolbar and the INSERT row are
                    sticky at its top, so the body text scrolls beneath them. */}
                <div className="max-h-[42vh] overflow-y-auto">
                  {editor ? (
                    <div className="sticky top-0 z-20 bg-white">
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
                      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400">Insert</span>
                        <button
                          type="button"
                          onClick={() =>
                            editor.chain().focus().insertContent({ type: "ctaButton", attrs: { label: "Read more", href: "https://" } }).run()
                          }
                          className="h-7 rounded-md border border-zinc-300/60 bg-white px-2 text-[12px] font-medium text-zinc-700 transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                        >
                          Insert link
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            editor.chain().focus().insertContent({ type: "steps", attrs: { steps: [{ title: "", description: "" }] } }).run()
                          }
                          className="h-7 rounded-md border border-zinc-300/60 bg-white px-2 text-[12px] font-medium text-zinc-700 transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                        >
                          Steps
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            editor.chain().focus().insertContent({ type: "spotlight", attrs: { entries: [{ initials: "", name: "", label: "" }] } }).run()
                          }
                          className="h-7 rounded-md border border-zinc-300/60 bg-white px-2 text-[12px] font-medium text-zinc-700 transition-colors hover:border-teal-600/40 hover:text-[#0F766E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
                        >
                          Spotlight
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-11 border-b border-zinc-200" />
                  )}
                  {editor && findOpen ? <FindReplaceBar editor={editor} onClose={() => setFindOpen(false)} /> : null}
                  <div className="px-5 py-5">
                    {editor ? (
                      <>
                        <EditorBubbleMenu editor={editor} linkDialogOpen={linkDialogOpen} onLink={() => setLinkDialogOpen(true)} />
                        <EditorContent editor={editor} />
                      </>
                    ) : (
                      <p className="text-[13px] text-zinc-500" role="status">
                        Loading editor…
                      </p>
                    )}
                  </div>
                </div>
                {editor && drop.pending ? (
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

        {/* Departments — optional filter tags, in an enclosed dropdown. */}
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape") setDeptOpen(false);
          }}
        >
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-800">
            Departments <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={deptOpen}
            aria-controls="bulletin-departments"
            disabled={busy}
            onClick={() => setDeptOpen((current) => !current)}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-zinc-300/70 bg-white px-3 text-[13.5px] text-zinc-900 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="truncate">{departmentSummary(departments)}</span>
            <ChevronDown
              size={15}
              strokeWidth={1.75}
              aria-hidden="true"
              className={cx("shrink-0 text-zinc-400 transition-transform", deptOpen && "rotate-180")}
            />
          </button>
          {deptOpen ? (
            <div
              id="bulletin-departments"
              role="group"
              aria-label="Departments"
              className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-lg border border-zinc-300/70 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)] sm:grid-cols-3"
            >
              {CLINICAL_DEPARTMENTS.map((department) => (
                <label key={department} className="flex items-center gap-2 text-[13px] text-zinc-700">
                  <input
                    type="checkbox"
                    checked={departments.includes(department)}
                    onChange={() =>
                      setDepartments((current) =>
                        current.includes(department)
                          ? current.filter((entry) => entry !== department)
                          : [...current, department],
                      )
                    }
                    disabled={busy}
                    className={checkboxClass}
                  />
                  <span className="truncate">{DEPARTMENT_LABELS[department]}</span>
                </label>
              ))}
            </div>
          ) : null}
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">
            Optional — leave empty for an all-staff post. Departments are filter tags, not a visibility boundary:
            everyone sees every bulletin.
          </p>
          {issueFor("departments").map((issue) => (
            <p key={issue.code} role="alert" className="mt-1.5 text-xs text-red-700">
              {issue.message}
            </p>
          ))}
        </div>

        {/* Options — the two flags and the opt-in expiry, grouped. */}
        <fieldset className="rounded-xl border border-zinc-300/70 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          <legend className="px-1 text-[13px] font-medium text-zinc-800">Options</legend>
          <div className="space-y-3">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setPinned(checked);
                  // Unticking clears the expiry; a fresh tick starts with none.
                  if (!checked) setExpiryDate(null);
                }}
                disabled={busy}
                className={checkboxClass}
              />
              <span>
                <span className="block text-[13px] font-medium text-zinc-800">Pinned</span>
                <span className="block text-xs leading-5 text-zinc-500">
                  Floats to the top of the board and gets the dark calling-card treatment.
                </span>
              </span>
            </label>

            {pinned ? (
              <div role="group" aria-label="Expiry date and time" className="border-l border-zinc-200 pl-3.5">
                <span className="mb-1 block text-[12.5px] font-medium text-zinc-700">
                  Expires <span className="font-normal text-zinc-500">(required for a pinned post)</span>
                </span>
                <div role="group" aria-label="Expiry presets" className="flex flex-wrap items-center gap-1.5">
                  {EXPIRY_PRESETS.map((preset) => {
                    const presetDate = expiryPresetDate(preset.days);
                    const selected = expiryDate !== null && presetDate.getTime() === expiryDate.getTime();
                    return (
                      <button
                        key={preset.days}
                        type="button"
                        aria-pressed={selected}
                        disabled={busy}
                        onClick={() => applyExpiryPreset(preset.days)}
                        className={cx(
                          "flex h-7 items-center rounded-full border px-3 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/30 disabled:cursor-not-allowed disabled:opacity-50",
                          selected
                            ? "border-[#5F6E00] bg-[#E6EBA5] text-[#5F6E00]"
                            : "border-zinc-300/60 bg-white text-zinc-600 hover:border-[#5F6E00]/40 hover:text-[#5F6E00]",
                        )}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                {issueFor("expiry").map((issue) => (
                  <p key={issue.code} role="alert" className="mt-1 text-xs text-red-700">
                    {issue.message}
                  </p>
                ))}
              </div>
            ) : null}

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(event) => setUrgent(event.target.checked)}
                disabled={busy}
                className={checkboxClass}
              />
              <span>
                <span className="block text-[13px] font-medium text-zinc-800">Urgent</span>
                <span className="block text-xs leading-5 text-zinc-500">
                  A red flag on the post only. Editing an urgent notice clears its acknowledgements.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

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
            <OctagonAlert size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" />
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

      {attachOpen ? (
        <BulletinAttachmentDialog
          bulletinId={bulletinId}
          onClose={() => setAttachOpen(false)}
          onUploaded={(record) => {
            setAttachments((current) => [...current, record]);
            setAttachError(null);
            setAttachOpen(false);
          }}
        />
      ) : null}
    </Modal>
  );
}
