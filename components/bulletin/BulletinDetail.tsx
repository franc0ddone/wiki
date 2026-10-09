"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  FileText,
  Info,
  Megaphone,
  PenLine,
  Pencil,
  Pin,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { MarkdownReader } from "@/components/MarkdownReader";
import { BulletinHeadline } from "@/components/bulletin/BulletinHeadline";
import { BulletinHero } from "@/components/bulletin/BulletinHero";
import { Modal, primaryButton, secondaryButton } from "@/components/editor/Modal";
import {
  acknowledgeBulletin,
  getBulletinAcks,
  getBulletinReactions,
  toggleBulletinReaction,
  type AckEntry,
  type ReactionSummaryEntry,
} from "@/lib/bulletin/api";
import { BULLETIN_REACTION_EMOJIS } from "@/lib/bulletin/reactions";
import { formatUsesAck } from "@/lib/bulletin/format";
import { roleAtLeast, type Role } from "@/lib/roles";
import { cx, formatDateTime } from "@/lib/utils";
import {
  DEPARTMENT_LABELS,
  type Bulletin,
  type BulletinPriority,
  type ClinicalDepartment,
  type KnowledgeArticle,
} from "@/types/portal";

/**
 * Bulletin reader.
 *
 * Two presentation tiers share this component:
 *
 *  - the **notice** layout (also used for `announcement` until prompt 6) — the
 *    badges, the headline with its petroleum-teal rule, the body, the ack row
 *    and the linked-SOP card;
 *  - the **featured** layout — a flat `#0f766e` hero band with a kicker pill,
 *    the headline and deck in white, then the same body / linked-SOP card.
 *
 * Both carry the bounded ❤️🎉👍 reaction row (celebratory posts get reactions,
 * not formal acks — the ack button is hidden for `announcement` and `featured`,
 * though existing ack records are never deleted). Articles get no reactions.
 */

const PRIORITY_META: Record<BulletinPriority, { label: string; className: string; icon: ReactNode }> = {
  urgent: {
    label: "Urgent",
    className: "border-red-200 bg-red-50 text-red-700",
    icon: <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />,
  },
  pinned: {
    label: "Pinned",
    className: "border-teal-200 bg-teal-50 text-teal-800",
    icon: <Pin size={12} strokeWidth={2} aria-hidden="true" />,
  },
  normal: {
    label: "Notice",
    className: "border-zinc-200 bg-zinc-50 text-zinc-600",
    icon: <Info size={12} strokeWidth={2} aria-hidden="true" />,
  },
};

function PriorityBadge({ priority }: { priority: BulletinPriority }) {
  const meta = PRIORITY_META[priority];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-px text-xs font-semibold", meta.className)}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function DepartmentTags({ departments }: { departments: readonly ClinicalDepartment[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {departments.map((department) => (
        <span
          key={department}
          className="whitespace-nowrap rounded-full border border-teal-600/30 bg-teal-50/50 px-2 py-px text-xs font-medium text-teal-700"
        >
          {DEPARTMENT_LABELS[department]}
        </span>
      ))}
    </span>
  );
}

function MetaItem({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[13px] text-zinc-500">
      <span className="text-zinc-400">{icon}</span>
      <span className="sr-only">{label}</span>
      <span className="text-zinc-500">{children}</span>
    </span>
  );
}

/**
 * The headline treatment lives in `components/bulletin/BulletinHeadline.tsx`
 * (owner's "Option C"): 34px, 700, letter-spacing -0.02em, line-height 1.1,
 * with a 64px × 3px petroleum-teal rule 14px below.
 */

export interface BulletinDetailProps {
  bulletin: Bulletin;
  articles: readonly KnowledgeArticle[];
  viewerRole: Role;
  viewerId: string;
  /** True when the viewer may edit/delete this notice (author of it, or a lead). */
  canEdit: boolean;
  onOpenArticle: (articleId: string) => void;
  onOpenArticleBySlug: (slug: string, anchor?: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function BulletinDetail({
  bulletin,
  articles,
  viewerRole,
  viewerId,
  canEdit,
  onOpenArticle,
  onOpenArticleBySlug,
  onEdit,
  onDelete,
}: BulletinDetailProps) {
  const linkedArticle = bulletin.linked_sop_id
    ? articles.find((article) => article.id === bulletin.linked_sop_id) ?? null
    : null;

  const canAck = roleAtLeast(viewerRole, "staff");
  const showRoster = roleAtLeast(viewerRole, "clinical_lead");
  const canReact = roleAtLeast(viewerRole, "staff");
  const format = bulletin.format ?? "notice";
  const featured = format === "featured";
  const showAck = formatUsesAck(format);

  const [acks, setAcks] = useState<AckEntry[] | null>(null);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mounted = useRef(true);

  const [reactions, setReactions] = useState<ReactionSummaryEntry[] | null>(null);
  const [reactionBusy, setReactionBusy] = useState<string | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The pane is keyed by bulletin id upstream, so switching notices is a fresh
  // mount with `acks === null` already. The fetch is inline + abortable (the
  // pattern the backlinks panel uses) so it never setStates after unmount.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const roster = await getBulletinAcks(bulletin.id);
        if (!controller.signal.aborted) setAcks(roster);
      } catch {
        if (!controller.signal.aborted) setAcks([]);
      }
    })();
    return () => controller.abort();
  }, [bulletin.id]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const summary = await getBulletinReactions(bulletin.id);
        if (!controller.signal.aborted) setReactions(summary);
      } catch {
        if (!controller.signal.aborted) setReactions([]);
      }
    })();
    return () => controller.abort();
  }, [bulletin.id]);

  const myAck = acks?.find((entry) => entry.user_id === viewerId) ?? null;

  const handleAck = async () => {
    if (ackBusy) return;
    setAckBusy(true);
    setAckError(null);
    try {
      await acknowledgeBulletin(bulletin.id);
      const roster = await getBulletinAcks(bulletin.id);
      if (mounted.current) setAcks(roster);
    } catch (caught) {
      if (mounted.current) {
        setAckError(caught instanceof Error ? caught.message : "Could not record the acknowledgement.");
      }
    } finally {
      if (mounted.current) setAckBusy(false);
    }
  };

  // Optimistic toggle with rollback on failure. The server returns the
  // authoritative summary, which replaces the optimistic guess on success.
  const handleReact = async (emoji: string) => {
    if (reactionBusy) return;
    const previous = reactions ?? [];
    setReactionError(null);
    setReactionBusy(emoji);
    setReactions(
      previous.map((entry) =>
        entry.emoji === emoji
          ? {
              ...entry,
              count: Math.max(0, entry.count + (entry.viewer_reacted ? -1 : 1)),
              viewer_reacted: !entry.viewer_reacted,
            }
          : entry,
      ),
    );
    try {
      const result = await toggleBulletinReaction(bulletin.id, emoji);
      if (mounted.current) setReactions(result.summary);
    } catch (caught) {
      if (mounted.current) {
        setReactions(previous);
        setReactionError(caught instanceof Error ? caught.message : "Could not save your reaction.");
      }
    } finally {
      if (mounted.current) setReactionBusy(null);
    }
  };

  const reactionOrder: ReactionSummaryEntry[] =
    reactions ??
    BULLETIN_REACTION_EMOJIS.map((emoji) => ({ emoji, count: 0, viewer_reacted: false }));

  const reactionsRow = (
    <div>
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Reactions</p>
      <div className="flex flex-wrap items-center gap-2">
        {reactionOrder.map((entry) => {
          const muted = entry.count === 0 && !entry.viewer_reacted;
          return (
            <button
              key={entry.emoji}
              type="button"
              aria-pressed={entry.viewer_reacted}
              aria-label={`React with ${entry.emoji}`}
              disabled={!canReact || reactionBusy === entry.emoji}
              onClick={() => void handleReact(entry.emoji)}
              className={cx(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35 disabled:cursor-not-allowed",
                entry.viewer_reacted
                  ? "border-teal-600/40 bg-teal-50 text-teal-800"
                  : muted
                    ? "border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300"
                    : "border-zinc-300/60 bg-white text-zinc-700 hover:border-teal-600/40 hover:text-teal-800",
              )}
            >
              <span aria-hidden="true">{entry.emoji}</span>
              <span>{entry.count}</span>
            </button>
          );
        })}
      </div>
      {reactionError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {reactionError}
        </p>
      ) : null}
    </div>
  );

  const linkedCard = (
    <div className="border-t border-zinc-200 pt-6">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
        Referenced procedure
      </p>
      {linkedArticle ? (
        <button
          type="button"
          onClick={() => onOpenArticle(linkedArticle.id)}
          className="group flex w-full items-center gap-3 rounded-[10px] border border-zinc-300/60 bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors duration-150 hover:border-teal-600/40 hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-[#0F766E]">
            <FileText size={14} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-zinc-900">{linkedArticle.title}</span>
            <span className="block text-xs text-zinc-500">Open in Knowledge Base</span>
          </span>
          <ArrowUpRight
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-zinc-400 transition-colors group-hover:text-[#0F766E]"
          />
        </button>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-zinc-500">
          <Megaphone size={14} strokeWidth={1.75} aria-hidden="true" className="text-zinc-400" />
          No linked procedure for this notice.
        </p>
      )}
    </div>
  );

  const actionRow = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={bulletin.priority} />
        <DepartmentTags departments={bulletin.departments} />
      </div>
      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1.5 print:hidden">
          <button
            type="button"
            onClick={onEdit}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300/60 bg-white px-2.5 text-[13px] font-medium text-zinc-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-zinc-400 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 text-[13px] font-medium text-red-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
          >
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );

  const metaRow = (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <MetaItem icon={<PenLine size={14} strokeWidth={1.75} aria-hidden="true" />} label="Posted by">
        {bulletin.author_name}
      </MetaItem>
      <MetaItem icon={<CalendarDays size={14} strokeWidth={1.75} aria-hidden="true" />} label="Posted">
        {formatDateTime(bulletin.created_at)}
      </MetaItem>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[72rem] px-4 py-6 sm:px-6 md:px-8 md:py-10">
      <MarkdownReader
        source={bulletin.body_markdown}
        onOpenArticle={onOpenArticleBySlug}
        header={
          <>
            {actionRow}
            {featured ? (
              <>
                <BulletinHero title={bulletin.title} kicker={bulletin.kicker} deck={bulletin.deck} />
                <div className="mt-3">{metaRow}</div>
              </>
            ) : (
              <>
                <div className="mt-4">
                  <BulletinHeadline title={bulletin.title} />
                </div>
                {metaRow}
              </>
            )}
          </>
        }
        footer={
          <div className="space-y-6">
            {reactionsRow}

            {/* Acknowledge — only for the formal `notice` tier. */}
            {showAck ? (
              <div className="rounded-[10px] border border-zinc-300/60 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px] text-zinc-600">
                    <Users size={15} strokeWidth={1.75} aria-hidden="true" className="text-zinc-400" />
                    <span>
                      {acks === null
                        ? "Loading acknowledgements…"
                        : acks.length === 0
                          ? "No one has acknowledged this yet."
                          : `${acks.length} ${acks.length === 1 ? "person has" : "people have"} acknowledged this.`}
                    </span>
                  </div>
                  {canAck ? (
                    myAck ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[13px] font-medium text-teal-800">
                        <Check size={14} strokeWidth={2} aria-hidden="true" />
                        Acknowledged {formatDateTime(myAck.acked_at)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleAck()}
                        disabled={ackBusy}
                        className={cx(primaryButton, "h-8 px-3 text-[13px]")}
                      >
                        <Check size={14} strokeWidth={2} aria-hidden="true" />
                        {ackBusy ? "Recording…" : "Acknowledge"}
                      </button>
                    )
                  ) : null}
                </div>
                {ackError ? (
                  <p role="alert" className="mt-2 text-xs text-red-700">
                    {ackError}
                  </p>
                ) : null}

                {showRoster && acks && acks.length > 0 ? (
                  <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-3">
                    {acks.map((entry) => (
                      <li key={entry.user_id} className="flex items-center justify-between gap-3 text-[13px] text-zinc-700">
                        <span className="truncate font-medium text-zinc-800">{entry.name}</span>
                        <time dateTime={entry.acked_at} className="shrink-0 tabular-nums text-xs text-zinc-500">
                          {formatDateTime(entry.acked_at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {linkedCard}
          </div>
        }
      />

      {confirmDelete ? (
        <Modal title="Delete this bulletin?" onClose={() => setConfirmDelete(false)} widthClass="max-w-md">
          <p className="text-[13.5px] leading-6 text-zinc-700">
            “{bulletin.title}” will be removed from the board for everyone. This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={cx(primaryButton, "bg-red-600 hover:bg-red-700")}
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
              Delete bulletin
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export default BulletinDetail;
