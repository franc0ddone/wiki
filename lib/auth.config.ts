import type { NextAuthConfig } from "next-auth";
import type { Role } from "@/lib/roles";

/**
 * Transport-level Auth.js configuration.
 *
 * This half of the config deliberately imports nothing that talks to the
 * database. Next.js compiles `proxy.ts` (formerly `middleware.ts`) separately
 * from the route code, and the Next.js docs are explicit that the proxy
 * "should not attempt relying on shared modules or globals" — so the proxy gets
 * this file only, which is enough to verify the signed session cookie and read
 * the caller's role. `lib/auth.ts` spreads this object and adds the providers.
 *
 * Callbacks here only move data that is already inside the JWT: no lookup is
 * needed, which is also why the session stays valid without a round trip.
 *
 * **The session carries identity and role, and nothing about the sign-in
 * method.** `proxy.ts`, `requireRole()`, and the editor's role checks all read
 * `session.user.id` and `session.user.role`; none of them inspects how the user
 * authenticated. Keeping that true is what lets a later hospital SSO be added
 * without touching any downstream code.
 */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSessionUser;
  }

  interface User {
    role: Role;
  }
}

type DefaultSessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export const authConfig = {
  secret: process.env.AUTH_SECRET,
  // Behind a reverse proxy the request host is forwarded; without this Auth.js
  // refuses to build callback URLs. Set AUTH_TRUST_HOST=false to opt out.
  trustHost: process.env.AUTH_TRUST_HOST !== "false",
  session: { strategy: "jwt" },
  // The landing page IS the sign-in page: point every Auth.js redirect
  // (sign-in, sign-out, access denied) at `/`.
  pages: { signIn: "/" },
  // Providers are attached in lib/auth.ts.
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // `user` is only present on the sign-in request; on every later request
      // the role rides along in the token instead of hitting the database.
      if (user) {
        token.sub = user.id;
        token.role = (user as { role?: Role }).role;
        // Name and email are copied here too so the account menu and the
        // editor viewer can render an identity without a database round trip.
        token.name = user.name ?? null;
        token.email = user.email ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      if (typeof token.role === "string") session.user.role = token.role as Role;
      if (typeof token.name === "string") session.user.name = token.name;
      if (typeof token.email === "string") session.user.email = token.email;
      return session;
    },
  },
} satisfies NextAuthConfig;
