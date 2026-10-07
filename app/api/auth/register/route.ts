import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { ApiError, errorResponse, readJsonBody, requireString } from "@/lib/api";
import { getDb } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  DOMAIN_REJECTION_MESSAGE,
  HOSPITAL_EMAIL_DOMAIN,
  PASSWORD_MAX_LENGTH,
  isHospitalEmail,
  normalizeEmail,
  passwordProblem,
} from "@/lib/registration";
import { ROLE_LABELS } from "@/lib/roles";

/**
 * `POST /api/auth/register` — domain-gated self-registration.
 *
 * Public by design (it lives under `/api/auth/*`, the one public API prefix),
 * which is exactly why it carries its own guards:
 *
 *  - **Per-IP rate limiting.** The only unauthenticated write in the app; a
 *    scripted loop would otherwise mint accounts freely.
 *  - **Hospital domain only.** Anything not on `HOSPITAL_EMAIL_DOMAIN` is
 *    refused with a message a person can act on, never a silent no-op.
 *  - **Role is always `staff`.** The client cannot influence it — there is no
 *    role field, and elevation goes through the request/approval flow.
 *
 * The password is hashed with the same bcrypt cost as `prisma/seed.ts`, so a
 * self-registered account and a seeded one are indistinguishable downstream.
 */

/** Matches `bcrypt.hash(password, 10)` in the seed. */
const BCRYPT_COST = 10;

const REGISTER_LIMIT = 8;
const REGISTER_WINDOW_MS = 15 * 60 * 1000;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const limiter = consumeRateLimit(
      `register:${clientIp(request)}`,
      REGISTER_LIMIT,
      REGISTER_WINDOW_MS,
    );
    if (!limiter.allowed) {
      throw new ApiError(
        429,
        `Too many sign-up attempts. Try again in ${limiter.retryAfterSeconds} second${limiter.retryAfterSeconds === 1 ? "" : "s"}.`,
        {
          code: "rate_limited",
          details: { retryAfterSeconds: limiter.retryAfterSeconds },
        },
      );
    }

    const body = await readJsonBody(request);
    const name = requireString(body, "name", { maxLength: 200 });
    const email = normalizeEmail(requireString(body, "email", { maxLength: 320 }));

    // Passwords are not trimmed: leading/trailing spaces are legitimate
    // characters, so this field is read raw rather than through `requireString`.
    const rawPassword = body.password;
    const password = typeof rawPassword === "string" ? rawPassword : "";

    if (!isHospitalEmail(email)) {
      throw new ApiError(422, DOMAIN_REJECTION_MESSAGE, {
        code: "email_domain_not_allowed",
        details: { field: "email", domain: HOSPITAL_EMAIL_DOMAIN },
      });
    }

    if (password.length === 0) {
      throw new ApiError(422, "Choose a password.", { details: { field: "password" } });
    }
    const weak = passwordProblem(password);
    if (weak) {
      throw new ApiError(422, weak, { code: "password_too_weak", details: { field: "password" } });
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      throw new ApiError(422, `Keep the password under ${PASSWORD_MAX_LENGTH} characters.`, {
        details: { field: "password" },
      });
    }

    const db = getDb();
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new ApiError(409, "An account already exists for that email. Sign in instead.", {
        code: "email_taken",
        details: { field: "email" },
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await db.user.create({
      // No role from the request. New accounts are staff, full stop.
      data: { email, name, role: "staff", passwordHash },
      select: { id: true, email: true, name: true, role: true },
    });

    return Response.json(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        role_label: ROLE_LABELS[user.role],
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
