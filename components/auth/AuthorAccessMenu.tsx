"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Check, ChevronDown, Clock, LogOut, ShieldCheck, UserRoundPlus, X } from "lucide-react";
import type { Role } from "@/lib/roles";
import { ROLE_LABELS } from "@/lib/roles";
import {
  canRequestAuthorAccess,
  canReviewRoleRequests,
  type RoleRequestSummary,
} from "@/lib/role-requests";
import { cx, formatDate, initials } from "@/lib/utils";

/**
 * Account menu — the portal's profile area.
 *
 * It is where the author-access flow surfaces for the two roles that have a
 * stake in it:
 *
 *  - a `staff` member sees "Request author access" (or the state of the request
 *    they already have);
 *  - a `clinical_lead` or `admin` sees the pending queue with approve/decline
 *    controls.
 *
 * A `readonly` session sees neither — the menu is just identity and sign-out,
 * which is the whole point of the role.
 *
 * Every action is a call to an API that decides the outcome; the buttons here
 * only propose. Approving promotes the requester (server-side), and the page
 * re-fetches so the change is visible immediately.
 */

export interface AuthorAccessMenuProps {
  viewerRole: Role;
  viewer: { name: string; email: string } | null;
  /** The viewer's own latest request — present for `staff` only. */
  authorRequest: RoleRequestSummary | null;
  /** The open queue — present for `clinical_lead`+ only (empty otherwise). */
  roleRequests: readonly RoleRequestSummary[];
}

export function AuthorAccessMenu({ viewerRole, viewer, authorRequest, roleRequests }: AuthorAccessMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");

  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const canRequest = canRequestAuthorAccess(viewerRole);
  const canReview = canReviewRoleRequests(viewerRole);
  const name = viewer?.name?.trim() || "Signed in";
  const email = viewer?.email ?? "";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setDecliningId(null);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const call = useCallback(
    async (key: string, url: string, init: RequestInit) => {
      setError(null);
      setBusy(key);
      try {
        const response = await fetch(url, init);
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(payload?.error ?? `The server refused the request (${response.status}).`);
          return false;
        }
        // The decision changed server data; pull it back into the page.
        router.refresh();
        return true;
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const requestAccess = useCallback(async () => {
    const ok = await call("request", "/api/role-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (ok) setDecliningId(null);
  }, [call]);

  const decide = useCallback(
    async (id: string, status: "approved" | "declined", note?: string) => {
      const ok = await call(`decide:${id}`, `/api/role-requests/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(note && note.trim() ? { note: note.trim() } : {}) }),
      });
      if (ok) {
        setDecliningId(null);
        setDeclineNote("");
      }
    },
    [call],
  );

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${name}${canReview && roleRequests.length > 0 ? `, ${roleRequests.length} pending request${roleRequests.length === 1 ? "" : "s"}` : ""}`}
        className={cx(
          "relative flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] font-medium text-zinc-800 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F766E]/40 focus-visible:ring-offset-1",
          open ? "bg-zinc-900/[0.06]" : "hover:bg-zinc-900/[0.04] active:bg-zinc-900/[0.07]",
        )}
      >
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#F0FDFA_0%,#CCFBF1_55%,#99F6E4_140%)] text-[11px] font-semibold text-teal-800 ring-1 ring-inset ring-teal-600/20">
          {initials(name)}
        </span>
        <span className="hidden max-w-[9rem] truncate sm:inline">{name.split(",")[0]}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          className={cx("text-zinc-400 transition-transform duration-200", open && "rotate-180")}
        />
        {canReview && roleRequests.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0F766E] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
            {roleRequests.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={menuId}
          role="dialog"
          aria-label="Account"
          className="animate-popover-in absolute right-0 top-[calc(100%+6px)] z-40 w-80 rounded-xl border border-zinc-200/80 bg-white/95 p-3 shadow-[0_12px_40px_-12px_rgba(24,24,27,0.22),0_2px_6px_rgba(24,24,27,0.06)] backdrop-blur-xl"
        >
          {/* Identity */}
          <div className="flex items-start gap-3 border-b border-zinc-200 pb-3">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(145deg,#F0FDFA_0%,#CCFBF1_55%,#99F6E4_140%)] text-[13px] font-semibold text-teal-800 ring-1 ring-inset ring-teal-600/20">
              {initials(name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-zinc-900">{name}</p>
              {email ? <p className="truncate text-[12px] text-zinc-500">{email}</p> : null}
              <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#0F766E]">
                <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
                {ROLE_LABELS[viewerRole]}
              </p>
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[12.5px] leading-5 text-red-900">
              {error}
            </p>
          ) : null}

          {/* Request author access — staff only */}
          {canRequest ? (
            <div className="mt-3 border-b border-zinc-200 pb-3">
              {authorRequest?.status === "pending" ? (
                <p className="flex items-start gap-2 text-[12.5px] leading-5 text-zinc-600" role="status">
                  <Clock size={14} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600" />
                  Author access request pending — a clinical lead will review it.
                </p>
              ) : (
                <>
                  {authorRequest?.status === "declined" ? (
                    <p className="mb-2 text-[12.5px] leading-5 text-zinc-600">
                      Your last request was declined
                      {authorRequest.decided_by_name ? ` by ${authorRequest.decided_by_name}` : ""}
                      {authorRequest.note ? `: “${authorRequest.note}”` : "."}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void requestAccess()}
                    disabled={busy !== null}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[#0F766E] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#0c635c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <UserRoundPlus size={14} strokeWidth={1.9} aria-hidden="true" />
                    {busy === "request" ? "Requesting…" : "Request author access"}
                  </button>
                </>
              )}
            </div>
          ) : null}

          {/* Queue — clinical_lead+ only */}
          {canReview ? (
            <div className="mt-3 border-b border-zinc-200 pb-3">
              <p className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Author access requests
              </p>
              {roleRequests.length === 0 ? (
                <p className="mt-2 px-0.5 text-[12.5px] leading-5 text-zinc-500">
                  No pending requests.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {roleRequests.map((request) => (
                    <li key={request.id} className="rounded-[10px] border border-zinc-300/60 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
                      <p className="truncate text-[13px] font-semibold text-zinc-900">{request.user_name}</p>
                      <p className="truncate text-[12px] text-zinc-500">{request.user_email}</p>
                      <p className="mt-0.5 text-[11.5px] text-zinc-500">
                        Requests {ROLE_LABELS[request.requested_role].toLowerCase()} · {formatDate(request.created_at)}
                      </p>

                      {decliningId === request.id ? (
                        <div className="mt-2 space-y-2">
                          <input
                            type="text"
                            value={declineNote}
                            onChange={(event) => setDeclineNote(event.target.value)}
                            placeholder="Optional note to the requester"
                            aria-label={`Note to ${request.user_name}`}
                            className="h-8 w-full rounded-lg border border-zinc-300/70 bg-white px-2.5 text-[12.5px] text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15"
                          />
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void decide(request.id, "declined", declineNote)}
                              disabled={busy !== null}
                              className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-[12px] font-medium text-red-800 transition-colors hover:bg-red-100 disabled:opacity-60"
                            >
                              {busy === `decide:${request.id}` ? "Declining…" : "Confirm decline"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDecliningId(null);
                                setDeclineNote("");
                              }}
                              className="flex h-7 items-center justify-center rounded-md border border-zinc-200 bg-white px-2 text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void decide(request.id, "approved")}
                            disabled={busy !== null}
                            className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-teal-600/30 bg-teal-50 px-2 text-[12px] font-medium text-teal-800 transition-colors hover:bg-teal-100 disabled:opacity-60"
                          >
                            <Check size={13} strokeWidth={2.25} aria-hidden="true" />
                            {busy === `decide:${request.id}` ? "Working…" : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDecliningId(request.id);
                              setDeclineNote("");
                            }}
                            disabled={busy !== null}
                            className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
                          >
                            <X size={13} strokeWidth={2.25} aria-hidden="true" />
                            Decline
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35"
          >
            <LogOut size={14} strokeWidth={1.9} aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default AuthorAccessMenu;
