import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isRole, roleAtLeast, type Role } from "@/lib/roles";

/**
 * Request boundary for `/api/*`.
 *
 * Next.js 16 renamed the `middleware.js` convention to `proxy.js` (the
 * `middleware` name is deprecated); this is the same thing under its current
 * name. It runs on the Node.js runtime, which is the default in v16.
 *
 * It enforces the *coarse* policy — is the caller signed in, and does their
 * role clear the floor for this method and path. It deliberately does not try
 * to enforce the fine-grained rules (whether a publish has a valid clinical
 * lead reviewer, for instance): those need the request body and the database,
 * and the Next.js docs point out that a matcher change can silently remove
 * proxy coverage. Every route handler re-checks with `requireRole()`. The proxy
 * is a cheap early rejection, not the security boundary.
 *
 * Only `authConfig` is imported here — the DB-touching half of the auth setup
 * stays out of the proxy bundle.
 */

const { auth } = NextAuth(authConfig);

/**
 * Paths a plain `staff` member may write to.
 *
 * Acknowledgements and search telemetry are staff actions: a read-only policy
 * on them would mean no one's searches were ever logged (defeating the
 * dead-search review) and no one could acknowledge an urgent alert. Content
 * writes still need `author`+.
 */
function isStaffWritable(pathname: string): boolean {
  if (pathname === "/api/search-log") return true;
  return /^\/api\/bulletins\/[^/]+\/ack$/.test(pathname);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function minimumRoleFor(method: string, pathname: string): Role {
  if (SAFE_METHODS.has(method)) return "readonly";
  if (isStaffWritable(pathname)) return "staff";
  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) return "admin";
  return "author";
}

export default auth((request: NextRequest & { auth: unknown }) => {
  const { pathname } = request.nextUrl;

  // Auth.js owns its own endpoints; guarding them would make sign-in impossible.
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const session = request.auth as { user?: { role?: unknown } } | null;
  const role = session?.user?.role;

  if (!session?.user || !isRole(role)) {
    return Response.json(
      { error: "Authentication required.", code: "unauthenticated" },
      { status: 401 },
    );
  }

  const minimum = minimumRoleFor(request.method, pathname);
  if (!roleAtLeast(role, minimum)) {
    return Response.json(
      {
        error: `This endpoint requires the ${minimum} role or higher.`,
        code: "forbidden",
        details: { requiredRole: minimum, actualRole: role },
      },
      { status: 403 },
    );
  }

  return NextResponse.next();
});

export const config = {
  // Everything under /api. Auth.js's own routes are exempted in the handler
  // rather than the matcher, so the exemption is visible where the policy is
  // written.
  matcher: ["/api/:path*"],
};
