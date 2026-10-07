/**
 * Self-registration policy.
 *
 * The hospital's email domain is defined **once**, here. Every consumer —
 * the register endpoint, the landing page's client-side feedback — reads this
 * module rather than re-deriving the rule, so there is exactly one place to
 * change when the domain does.
 *
 * `HOSPITAL_EMAIL_DOMAIN` (env) overrides the compiled default. A leading `@`
 * or surrounding whitespace is tolerated and normalised away, because that is
 * the shape a person types into an env file.
 *
 * Framework-free and dependency-free on purpose: the landing page (a client
 * component) imports it, so it must not pull in Prisma, `next/headers`, or the
 * database.
 */

const DEFAULT_HOSPITAL_EMAIL_DOMAIN = "dovelewis.org";

/** The one configurable constant. Lower-cased, no leading `@`. */
export const HOSPITAL_EMAIL_DOMAIN = normalizeDomain(
  process.env.HOSPITAL_EMAIL_DOMAIN ?? DEFAULT_HOSPITAL_EMAIL_DOMAIN,
);

/** Shown whenever an address is not on the hospital domain. */
export const DOMAIN_REJECTION_MESSAGE = "Use your Dove Lewis email to create an account.";

/** Password rules. Kept explicit so the API and the UI agree on the wording. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
export const PASSWORD_REJECTION_MESSAGE = `Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`;

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

/** Lower-cased, trimmed email — the exact form stored in `User.email`. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The domain part of an email, or `null` when it is not a well-formed address. */
export function emailDomain(email: string): string | null {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1);
}

/**
 * True only for addresses on the hospital domain.
 *
 * Deliberately strict: the local part may contain no `@`, and the domain must
 * match exactly (`...@dovelewis.org`), not merely end with the hospital's name
 * (`...@notdovelewis.org.evil.com`).
 */
export function isHospitalEmail(email: string): boolean {
  return emailDomain(email) === HOSPITAL_EMAIL_DOMAIN;
}

/**
 * A human message when the password is unacceptable, or `null` when it is fine.
 *
 * Length only — this is an internal hospital tool where the account is bound to
 * a verified domain, and an over-specified composition rule pushes people
 * toward a sticky note. The floor is high enough to justify bcrypt.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_REJECTION_MESSAGE;
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Keep the password under ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}
