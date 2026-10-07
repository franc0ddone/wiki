import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import bcrypt from "bcryptjs";
import { authConfig } from "@/lib/auth.config";
import { getDb } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { ROLES, ROLE_LABELS, isRole, lowestRole, roleAtLeast, type Role } from "@/lib/roles";

/**
 * Authentication and authorization.
 *
 * Auth.js (NextAuth v5) with a JWT session. Two providers are possible:
 *
 *  1. **Credentials** — email + password against the `User` table. This exists
 *     so the stack runs end to end on a developer machine (`DEV_CREDENTIALS_ENABLED`).
 *  2. **Hospital IdP (OIDC)** — configured purely from env. Uncomment the env
 *     block in `.env.example` and the provider below activates itself. It is
 *     inert while `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` are unset.
 *
 * Authorization is role-rank based (`lib/roles.ts`): a route asks for the
 * *least* role it will admit and everything above it passes.
 */

const devCredentialsEnabled = process.env.DEV_CREDENTIALS_ENABLED !== "false";

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (devCredentialsEnabled) {
    providers.push(
      Credentials({
        id: "credentials",
        name: "Staff email",
        credentials: {
          email: { label: "Work email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials) {
          const email = typeof credentials?.email === "string" ? credentials.email.trim().toLowerCase() : "";
          const password = typeof credentials?.password === "string" ? credentials.password : "";
          if (!email || !password) return null;

          const user = await getDb().user.findUnique({ where: { email } });
          // Compare against a dummy hash when the account is missing so a
          // failed lookup takes the same time as a wrong password.
          const hash = user?.passwordHash ?? DUMMY_HASH;
          const passwordMatches = await bcrypt.compare(password, hash);
          if (!user || !user.passwordHash || !passwordMatches) return null;

          return { id: user.id, email: user.email, name: user.name, role: user.role };
        },
      }),
    );
  }

  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_DISPLAY_NAME } = process.env;
  if (OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET) {
    providers.push({
      id: "hospital-idp",
      name: OIDC_DISPLAY_NAME ?? "Hospital SSO",
      type: "oidc",
      issuer: OIDC_ISSUER,
      clientId: OIDC_CLIENT_ID,
      clientSecret: OIDC_CLIENT_SECRET,
      // A role claim mapping is deployment-specific; the `signIn` callback
      // below is the place to resolve an IdP group into a portal `Role`.
      authorization: { params: { scope: "openid email profile" } },
    });
  }

  return providers;
}

/** bcrypt hash of a value nobody can supply, used only to equalize timing. */
const DUMMY_HASH = "$2b$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpLp0eQ2h9O0n3n6Z1qQO0h0k1W1u";

/* ---------------------------------------------------------- SSO link-by-email */

/**
 * Link-by-email: the one SSO requirement that must hold *now*.
 *
 * When hospital IT turns on OIDC, a sign-in arrives with an email that may
 * already have a local `User` row — every account in this portal was created by
 * the credentials provider, by an admin, or by the domain-gated registration
 * flow. Auth.js must **link to that row instead of creating a duplicate**, so a
 * person has one identity, one role, and one audit trail no matter how they
 * signed in.
 *
 * There is no database adapter in this phase (the JWT strategy needs none), so
 * "linking" lives in the two callbacks below rather than in adapter plumbing:
 *
 *  1. `signIn` refuses an SSO email with no local account. IT provisions the
 *     `User` row first; roles are granted by admins only and an SSO login must
 *     not conjure one. **← This is the marked adapter stub: when the IdP is
 *     configured, replace the refusal with auto-provisioning and map an IdP
 *     group to a portal `Role` here.**
 *  2. `jwt` swaps the token subject for the *local* user id and copies the local
 *     role, so `proxy.ts` and `requireRole()` see exactly the id + role a
 *     password sign-in would have produced.
 *
 * The invariant this preserves: **nothing downstream branches on auth method.**
 * The session carries id + role only; `proxy.ts`, `requireRole()`, and the
 * editor's checks never inspect how the user signed in.
 */
async function resolveSsoIdentity(email: string): Promise<{ id: string; role: Role } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const row = await getDb().user.findUnique({
    where: { email: normalized },
    select: { id: true, role: true },
  });
  return row ? { id: row.id, role: row.role as Role } : null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: buildProviders(),
  callbacks: {
    ...authConfig.callbacks,

    // Guard for the external provider. Credentials authenticate against the
    // `User` row already, so they are exempt.
    async signIn({ user, account }) {
      if (account && account.provider !== "credentials") {
        const email = typeof user.email === "string" ? user.email : "";
        const identity = await resolveSsoIdentity(email);
        if (!identity) return false;
      }
      return true;
    },

    // The link itself: an SSO sign-in adopts the existing local identity.
    async jwt(params) {
      const { token, user, account } = params;

      if (user && account && account.provider !== "credentials") {
        const email = typeof user.email === "string" ? user.email : "";
        const identity = await resolveSsoIdentity(email);
        if (identity) {
          token.sub = identity.id;
          token.role = identity.role;
          token.name = user.name ?? token.name ?? null;
          token.email = email.trim().toLowerCase();
          return token;
        }
      }

      return authConfig.callbacks.jwt(params);
    },
  },
});

/** The authenticated principal, as the API layer needs it. */
export interface Actor {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * Require an authenticated session, optionally at a minimum role.
 *
 * Throws `ApiError` (401 without a session, 403 below the role) so route
 * handlers can hand it straight to `errorResponse()`. Every route calls this
 * itself rather than trusting the proxy: the Next.js docs are explicit that a
 * matcher change can silently remove proxy coverage, so authorization is
 * re-checked where the data actually is.
 */
export async function requireRole(...roles: Role[]): Promise<Actor> {
  const session = await auth();
  const user = session?.user;

  if (!user?.id) {
    throw new ApiError(401, "Authentication required.", { code: "unauthenticated" });
  }

  const role: Role = isRole(user.role) ? user.role : "readonly";

  if (roles.length > 0) {
    const minimum = lowestRole(roles);
    if (!roleAtLeast(role, minimum)) {
      throw new ApiError(
        403,
        `This action requires the ${ROLE_LABELS[minimum]} role or higher. Your role is ${ROLE_LABELS[role]}.`,
        { code: "forbidden", details: { requiredRole: minimum, actualRole: role } },
      );
    }
  }

  return {
    id: user.id,
    email: user.email ?? "",
    name: user.name ?? "",
    role,
  };
}

/** Every role the portal knows, exposed for the admin surface. */
export const ALL_ROLES = ROLES;

export type { Role };
