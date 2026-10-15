"use client";

import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, Loader2, OctagonAlert } from "lucide-react";
import { HOSPITAL_EMAIL_DOMAIN, isHospitalEmail } from "@/lib/registration";
import { useSearchShortcutLabel } from "@/lib/platform";
import { cx } from "@/lib/utils";

/**
 * Public sign-in / sign-up landing — the branded Dove Hub login.
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
 * Presentation follows the graphic-design spec locked 2026-10-08 and the
 * authoritative mockup: a 5px #AFBE23 viewport frame over a warm Clinical Light
 * canvas, the official DoveLewis lockup (rendered, never redrawn), a Domine
 * "Dove Hub" wordmark, and one white auth card. The one intentional owner
 * override is the submit button, which is the dark dove-green #5F6E00 rather
 * than the mockup's navy. Every binding below — modes, field ids, credential
 * handlers, redirect, and error states — is the auth build's, unchanged.
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
  "h-10 w-full rounded-md border border-[#D5D8D2] bg-[#F9FAF8] px-3 text-[14px] text-[#20241E] placeholder:text-[#9AA094] transition-colors focus-visible:border-[#5F6E00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]";

const LABEL_CLASS = "mb-1.5 block text-[13px] font-semibold text-[#20241E]";

const HELP_CLASS = "mt-1.5 text-[12px] leading-4 text-[#6B7268]";

const PRIMARY_BUTTON =
  "inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#5F6E00] px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#4D5900] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const TAB_CLASS =
  "rounded-md py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F6E00]/40";

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
    <>
      {/* The locked 5px brand frame: a fixed, inert overlay so it hugs every
          viewport edge and never clips or scrolls when the card grows. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-50 border-[5px] border-[#AFBE23]"
      />

      <main className="dw-auth flex min-h-dvh flex-col items-center justify-center bg-[#F3F4F3] px-4 py-8">
        <div className="flex w-full max-w-[400px] flex-col items-center">
          {/* Official DoveLewis institutional signature — the supplied PNG,
              rendered unmodified at its intrinsic aspect ratio. */}
          <Image
            src="/brand/dovelewis-logo.png"
            alt="DoveLewis Veterinary Emergency & Specialty Hospital"
            width={1184}
            height={851}
            priority
            className="h-auto w-[185px] sm:w-[195px]"
          />

          {/* Program wordmark and tagline, given their own isolation space. */}
          <h1 className="dw-display mt-6 text-center text-[34px] font-normal leading-tight text-[#1E2A4A]">
            Dove Hub
          </h1>
          <p className="mt-1.5 text-center text-[13.5px] text-[#6B7268]">institutional knowledge</p>

          <div className="mt-6 w-full rounded-xl border border-black/5 bg-white p-6 shadow-sm sm:p-7">
            {/* Tabs */}
            <div
              role="tablist"
              aria-label="Sign in or create an account"
              className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-[#F1F2F0] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "signin"}
                onClick={() => switchTab("signin")}
                className={cx(
                  TAB_CLASS,
                  tab === "signin"
                    ? "bg-white font-semibold text-[#20241E] shadow-xs"
                    : "font-medium text-[#6B7268] hover:text-[#20241E]",
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
                  TAB_CLASS,
                  tab === "register"
                    ? "bg-white font-semibold text-[#20241E] shadow-xs"
                    : "font-medium text-[#6B7268] hover:text-[#20241E]",
                )}
              >
                Create account
              </button>
            </div>

            {error ? (
              <p
                role="alert"
                className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-5 text-red-900"
              >
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
                  <p id="register-email-help" className={HELP_CLASS}>
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
                  <p id="register-password-help" className={HELP_CLASS}>
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

          <p className="mt-5 text-center text-[12px] leading-5 text-[#6B7268]">
            Staff sign in with their Dove Lewis account. Once you are in, press{" "}
            <kbd className="rounded-[5px] border border-[#D5D8D2] bg-white px-1.5 py-px font-sans text-[11px] font-medium text-[#6B7268]">
              {shortcut}
            </kbd>{" "}
            to search everything.
          </p>
        </div>
      </main>
    </>
  );
}

export default AuthLanding;
