"use client";

import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, Loader2, OctagonAlert, ShieldCheck } from "lucide-react";
import { HOSPITAL_EMAIL_DOMAIN, isHospitalEmail } from "@/lib/registration";
import { useSearchShortcutLabel } from "@/lib/platform";
import { cx } from "@/lib/utils";

/**
 * Public sign-in / sign-up landing.
 *
 * Two tabs over one card. Sign-in goes through the existing Auth.js credentials
 * provider (`signIn("credentials", …)`), so the session cookie and JWT the rest
 * of the app already trusts are exactly what a portal visit gets. Create-account
 * posts to the public, rate-limited, domain-gated registration endpoint and then
 * signs the new account straight in.
 *
 * The domain rule is shown, never guessed: the create-account form refuses a
 * non-`@dovelewis.org` address locally with the same message the API would send,
 * and the API re-checks it regardless — the client copy is a courtesy, not the
 * control.
 *
 * Platform note: every shortcut hint routes through `useSearchShortcutLabel()`,
 * which defaults to the Windows 11 form (`Ctrl K`) and only becomes `⌘K` on an
 * Apple client. No glyph is hardcoded.
 */

export interface AuthLandingProps {
  /** Where to go after a successful sign-in. Always a same-origin absolute path. */
  callbackUrl: string;
}

type Tab = "signin" | "register";

const INPUT_CLASS =
  "h-10 w-full rounded-lg border border-zinc-300/70 bg-white px-3 text-[14px] text-zinc-900 shadow-[0_1px_2px_rgba(16,24,40,0.04)] placeholder:text-zinc-400 transition-colors focus:border-teal-600/40 focus:outline-none focus:ring-2 focus:ring-teal-600/15";

const LABEL_CLASS = "mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500";

const PRIMARY_BUTTON =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#0F766E] px-4 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)] transition-colors hover:bg-[#0c635c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

export function AuthLanding({ callbackUrl }: AuthLandingProps) {
  const router = useRouter();
  const shortcut = useSearchShortcutLabel();

  const [tab, setTab] = useState<Tab>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sign in
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  // Create account
  const [name, setName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");

  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    setError(null);
  }, []);

  const finishSignIn = useCallback(async () => {
    router.replace(callbackUrl);
    // Re-fetch the destination's server data so the session is reflected.
    router.refresh();
  }, [router, callbackUrl]);

  const handleSignIn = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      setError(null);
      setBusy(true);
      try {
        const result = await signIn("credentials", {
          email: signInEmail.trim(),
          password: signInPassword,
          redirect: false,
        });
        if (!result || result.error) {
          setError("That email and password combination was not recognised.");
          return;
        }
        await finishSignIn();
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, signInEmail, signInPassword, finishSignIn],
  );

  const handleRegister = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      setError(null);

      const email = registerEmail.trim().toLowerCase();
      if (!isHospitalEmail(email)) {
        setError(`Use your Dove Lewis email (@${HOSPITAL_EMAIL_DOMAIN}) to create an account.`);
        return;
      }

      setBusy(true);
      try {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), email, password: registerPassword }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as unknown;
          setError(errorMessage(payload, `Could not create the account (${response.status}).`));
          return;
        }

        // Account created: sign in with the same credentials, so the new member
        // lands in the portal rather than back at a login form.
        const result = await signIn("credentials", {
          email,
          password: registerPassword,
          redirect: false,
        });
        if (!result || result.error) {
          // The account exists; only the automatic sign-in failed. Send them to
          // the sign-in tab rather than implying the registration was lost.
          switchTab("signin");
          setSignInEmail(email);
          setError("Your account was created. Sign in to continue.");
          return;
        }
        await finishSignIn();
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, registerEmail, name, registerPassword, finishSignIn, switchTab],
  );

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#F4F4F5] px-4 py-10">
      <div className="w-full max-w-[26rem]">
        {/* Brand */}
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden="true" className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F766E] shadow-[0_1px_2px_rgba(16,24,40,0.12),0_10px_24px_-12px_rgba(15,118,110,0.7)]">
            <ShieldCheck size={19} strokeWidth={1.9} className="text-white" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold uppercase leading-4 tracking-[0.06em] text-zinc-900">
              Dove Wiki
            </h1>
            <p className="text-[12.5px] text-zinc-500">Dove Lewis Emergency Animal Hospital</p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-300/70 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_32px_-16px_rgba(16,24,40,0.18)] ring-1 ring-black/[0.04]">
          {/* Tabs */}
          <div role="tablist" aria-label="Sign in or create an account" className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-zinc-200/80 bg-zinc-100/70 p-1">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "signin"}
              onClick={() => switchTab("signin")}
              className={cx(
                "h-8 rounded-md text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
                tab === "signin" ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "register"}
              onClick={() => switchTab("register")}
              className={cx(
                "h-8 rounded-md text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/35",
                tab === "register" ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgba(16,24,40,0.08)]" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              Create account
            </button>
          </div>

          {error ? (
            <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-5 text-red-900">
              <OctagonAlert size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600" />
              <span>{error}</span>
            </p>
          ) : null}

          {tab === "signin" ? (
            <form onSubmit={handleSignIn} noValidate className="space-y-4">
              <div>
                <label htmlFor="signin-email" className={LABEL_CLASS}>
                  Work email
                </label>
                <input
                  id="signin-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={signInEmail}
                  onChange={(event) => setSignInEmail(event.target.value)}
                  placeholder={`you@${HOSPITAL_EMAIL_DOMAIN}`}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="signin-password" className={LABEL_CLASS}>
                  Password
                </label>
                <input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={signInPassword}
                  onChange={(event) => setSignInPassword(event.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                {busy ? <Loader2 size={15} strokeWidth={2} aria-hidden="true" className="animate-spin" /> : null}
                {busy ? "Signing in…" : "Sign in"}
                {!busy ? <ArrowRight size={15} strokeWidth={1.9} aria-hidden="true" /> : null}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} noValidate className="space-y-4">
              <div>
                <label htmlFor="register-name" className={LABEL_CLASS}>
                  Full name
                </label>
                <input
                  id="register-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Jordan Avery"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="register-email" className={LABEL_CLASS}>
                  Hospital email
                </label>
                <input
                  id="register-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={registerEmail}
                  onChange={(event) => setRegisterEmail(event.target.value)}
                  placeholder={`you@${HOSPITAL_EMAIL_DOMAIN}`}
                  aria-describedby="register-email-help"
                  className={INPUT_CLASS}
                />
                <p id="register-email-help" className="mt-1.5 text-[12px] leading-4 text-zinc-500">
                  Only @{HOSPITAL_EMAIL_DOMAIN} addresses can create an account.
                </p>
              </div>
              <div>
                <label htmlFor="register-password" className={LABEL_CLASS}>
                  Password
                </label>
                <input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  aria-describedby="register-password-help"
                  className={INPUT_CLASS}
                />
                <p id="register-password-help" className="mt-1.5 text-[12px] leading-4 text-zinc-500">
                  At least 8 characters. New accounts start with read and standard staff access; you can request author access once you are in.
                </p>
              </div>
              <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
                {busy ? <Loader2 size={15} strokeWidth={2} aria-hidden="true" className="animate-spin" /> : null}
                {busy ? "Creating account…" : "Create account"}
                {!busy ? <ArrowRight size={15} strokeWidth={1.9} aria-hidden="true" /> : null}
              </button>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-[12px] leading-5 text-zinc-500">
          Staff sign in with their Dove Lewis account. Once you are in, press{" "}
          <kbd className="rounded-[5px] border border-zinc-300 bg-white px-1.5 py-px font-sans text-[11px] font-medium text-zinc-600">
            {shortcut}
          </kbd>{" "}
          to search everything.
        </p>
      </div>
    </main>
  );
}

export default AuthLanding;
