import { handlers } from "@/lib/auth";

/**
 * Auth.js endpoints (`/api/auth/signin`, `/api/auth/callback/*`, …).
 *
 * Exempted from the proxy policy — guarding these would make signing in
 * impossible.
 */
export const { GET, POST } = handlers;
