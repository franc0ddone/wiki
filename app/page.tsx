import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLanding } from "@/components/auth/AuthLanding";
import { auth } from "@/lib/auth";

/**
 * Root `/` — the public sign-in / sign-up landing page.
 *
 * Branded, unauthenticated, and the only page that renders without a session.
 * A signed-in visitor is sent straight to the portal, so `/` is never a dead
 * end for a live session (the `callbackUrl` they came with is preserved when
 * one is present, so a deep link still lands where it was aimed).
 *
 * `force-dynamic` because the redirect depends on the request's session cookie.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · Dove Wiki",
  description: "Sign in to Dove Wiki — the operations hub for Dove Lewis Emergency Animal Hospital.",
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const fromParam = Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl;
  // Only same-origin, absolute-path targets are honoured — an open redirect is
  // not worth the convenience.
  const callbackUrl = fromParam && fromParam.startsWith("/") && !fromParam.startsWith("//") ? fromParam : "/portal";

  if (session?.user?.id) {
    redirect(callbackUrl);
  }

  return <AuthLanding callbackUrl={callbackUrl} />;
}
