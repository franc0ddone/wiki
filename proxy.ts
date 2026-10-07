import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { isRole, roleAtLeast, type Role } from "@/lib/roles";

/**
 * Request boundary. This is the front door for **both** page routes and
 * `/api/*`.
 *
 * Next.js 16 renamed the `middleware.js` convention to `proxy.js` (the
 * `middleware` name is deprecated); this is the same thing under its current
 * name. It runs on the Node.js runtime, which is the default in v16.
 *
 * Policy:
 *
 *  - **Public:** `/` (the sign-in / sign-up landing), Auth.js's own
 *    `/api/auth/*` endpoints, and static assets (excluded by the matcher).
 *  - **Requires a session:** everything else — `/portal`, `/articles/*`,
 *    `/procedures/*`, and every `/api/*` route other than `/api/auth/*`.
 *    A page request without a session is redirected to the landing with a
 *    `callbackUrl`; an API request gets a 401 JSON body.
 *  - **Role floors** apply to the API, exactly as before.
 *
 * **This is a cheap early rejection, not the security boundary.** It enforces
 * the coarse policy — signed in, and (for API writes) the role floor for the
 * method and path. It deliberately does not try to enforce the fine-grained
 * rules (whether a publish has a valid clinical lead reviewer, whether a caller
 * may decide a given role request): those need the request body and the
 * database, and the Next.js docs point out that a matcher change can silently
 * remove proxy coverage. Every route handler re-checks with `requireRole()`.
 *
 * Only `authConfig` is imported here — the DB-touching half of the auth setup
 * stays out of the proxy bundle.
 */

const { auth } = NextAuth(authConfig);

/**
 * Paths a plain `staff` member may write to.
 *
 * Acknowledgements, search telemetry, and raising an author-access request are
 * staff actions: a read-only policy on them would mean no one's searches were
 * ever logged (defeating the dead-search review), no one could acknowledge an
 * urgent alert, and no staff member could ever ask for the author role. Content
 * writes still need `author`+, and *deciding* a request needs `clinical_lead`+
 * (enforced in the route, which is the real lock).
 */
function isStaffWritable(pathname: string): boolean {
  if (pathname === "/api/search-log") return true;
  if (pathname === "/api/role-requests") return true;
  return /^\/api\/bulletins\/[^/]+\/ack$/.test(pathname);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function minimumRoleFor(method: string, pathname: string): Role {
  if (SAFE_METHODS.has(method)) return "readonly";
  if (isStaffWritable(pathname)) return "staff";
  if (pathname === "/api/users" || pathname.startsWith("/api/users/")) return "admin";
  return "author";
}

/** The landing page and Auth.js's endpoints are reachable without a session. */
function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  return false;
}

export default auth((request: NextRequest & { auth: unknown }) => {
  const { pathname, search } = request.nextUrl;

  // The landing, and the endpoints that make signing in possible.
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const session = request.auth as { user?: { role?: unknown } } | null;
  const role = session?.user?.role;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  if (!session?.user || !isRole(role)) {
    if (isApi) {
      return Response.json(
        { error: "Authentication required.", code: "unauthenticated" },
        { status: 401 },
      );
    }

    // A page: send them to the landing, remembering where they were headed so
    // the sign-in form can return them there.
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  // Pages only need a session; their own components enforce the role.
  if (!isApi) {
    return NextResponse.next();
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
  // Run on every route except Next.js's static/image assets and files with an
  // extension in `public/`. The public/protected decision is made inside the
  // handler rather than the matcher, so the policy is visible where it is
  // written — and a matcher change cannot silently make a route public.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf|otf)$).*)",
  ],
};
