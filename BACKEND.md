# Dove Wiki — backend

Persistence, API, versioning, auth scaffolding, uploads, and import tooling for
Dove Wiki. **This pass is backend-only:** `lib/mock-data.ts` still
works exactly as it did, and no component was changed other than the one
permitted export in `components/MarkdownReader.tsx`.

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
PostgreSQL 17 · Prisma ORM 7 · Auth.js (NextAuth v5) · `sharp` · S3-compatible
object storage.

---

## 1. Running it

```bash
cp .env.example .env          # then fill in DATABASE_URL, AUTH_SECRET, S3_*
npm install
npm run db:migrate            # prisma migrate dev — creates/updates the schema
npm run db:seed               # loads lib/mock-data.ts into the database
npm run dev
```

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run db:migrate` | `prisma migrate dev` — apply migrations to the dev database |
| `npm run db:deploy` | `prisma migrate deploy` — apply migrations in an environment (no prompts) |
| `npm run db:generate` | Regenerate the Prisma client into `generated/prisma` |
| `npm run db:seed` | Load the phase-1 fixtures (idempotent) |
| `npm run db:studio` | Prisma Studio |
| `npm run import:mediawiki -- <dump.xml>` | Import a MediaWiki XML export |
| `npm run verify:backend` | Assert the acceptance criteria against a seeded dev database |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `npm run build` | as expected; `prebuild` regenerates the client |

### Prisma 7 notes (these will bite if you assume Prisma 6 behaviour)

- **The connection string lives in `prisma.config.ts`, not in `schema.prisma`.**
- **Prisma no longer loads `.env` itself.** `prisma.config.ts` does
  `import "dotenv/config"` first.
- **There is no bundled query engine.** The client is constructed with a driver
  adapter — `@prisma/adapter-pg` over `pg` (see `lib/db.ts`).
- **`migrate dev` no longer auto-generates the client and no longer auto-seeds.**
  Run `db:generate` and `db:seed` explicitly (`npm run build` does the generate
  for you via `prebuild`).
- The generated client is TypeScript in `generated/prisma` and is git-ignored.

### Database

Two migrations:

1. `…_init` — all tables, enums, indexes.
2. `…_article_version_immutability` — a PL/pgSQL trigger that raises on `UPDATE`
   or `DELETE` against `article_versions`. Immutability is a database guarantee,
   not a code convention: no future endpoint, script, or hand-run SQL can quietly
   rewrite a published version. If a retention policy is ever introduced,
   `ALTER TABLE article_versions DISABLE TRIGGER article_versions_no_delete;` is
   the deliberate, reviewable step — don't drop the function silently.

`updateArticle` therefore *inserts* versions only, and `GET …/versions` is the
only reader.

### Environment variables

All documented in `.env.example`. Summary:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string (read by `prisma.config.ts`) |
| `DIRECT_DATABASE_URL` | Optional non-pooled URL for migrations |
| `AUTH_SECRET` | Auth.js signing secret (`npx auth secret`) |
| `AUTH_URL` | Canonical origin |
| `AUTH_TRUST_HOST` | Trust `X-Forwarded-*` from the reverse proxy (default on) |
| `DEV_CREDENTIALS_ENABLED` | Dev email+password sign-in; turn **off** once an IdP is live |
| `SEED_DEFAULT_PASSWORD` | Password given to every seeded account (dev only) |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_DISPLAY_NAME` | Hospital IdP; the provider activates only when all three required values are set |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY` `S3_SECRET_KEY` `S3_PUBLIC_BASE_URL` `S3_FORCE_PATH_STYLE` `S3_KEY_PREFIX` | Upload storage |
| `UPLOAD_MAX_BYTES` | Per-file ceiling, default 10 MB |
| `ANNOUNCEMENTS_POLL_INTERVAL_MS` | SSE poll interval, default 5000 ms |

No secret is read from source anywhere. Uploads are written **only** to the
bucket; nothing in the upload path can write into the repository.

---

## 2. API routes

All JSON, all timestamps UTC (ISO-8601 on the wire; the portal formats them in
`FACILITY_TIME_ZONE`). Field names are snake_case, matching `types/portal.ts`.

| Method | Route | Minimum role |
| --- | --- | --- |
| `GET` | `/api/articles` (`?status=`, `?department=`, `?q=`) | any authenticated |
| `POST` | `/api/articles` | `author` |
| `GET` | `/api/articles/[slug]` | any authenticated |
| `PATCH` | `/api/articles/[slug]` | `author`; **`clinical_lead` to publish** |
| `GET` | `/api/articles/[slug]/versions` | any authenticated |
| `GET` | `/api/articles/[slug]/backlinks` | any authenticated |
| `GET` | `/api/bulletins` (`?priority=`, `?department=`, `?q=`, `?includeExpired=true`) | any authenticated |
| `POST` | `/api/bulletins` | `author`; **`clinical_lead` for `urgent`/`pinned`** |
| `POST` | `/api/bulletins/[id]/ack` | `staff` |
| `GET` | `/api/bulletins/[id]/ack` | any authenticated |
| `GET` | `/api/staff` (`?department=`, `?q=`) | any authenticated |
| `POST` | `/api/search-log` | `staff` |
| `GET` | `/api/announcements/stream` | any authenticated |
| `POST` | `/api/uploads` | `author` |
| `GET` | `/api/users` | `admin` |
| `PATCH` | `/api/users/[id]` | `admin` |
| `*` | `/api/auth/[...nextauth]` | public (Auth.js's own endpoints) |

Errors are uniform: `{ "error": "…", "code": "…", "details": { … } }`.

### Rules the API enforces (not just the UI)

- **Publishing requires a reviewer who is `clinical_lead` or `admin`.**
  Enforced inside `updateArticle`, so it holds for every caller. A refused
  publish leaves the article untouched — the check runs before the transaction.
- **Publishing writes an `ArticleVersion`** with the content that is about to go
  live, *before* the article row is updated, in one transaction. A version is
  written when an article becomes published, or when an already-published
  article's title or body changes (a republication). A no-op patch doesn't
  manufacture one. `change_summary` is taken from the request, defaulting to a
  timestamped note.
- **Publishing defaults `effective_date` to now** when none is supplied — a
  future date is how a protocol is staged.
- **`urgent` bulletins always expire**: 72 hours by default, and an explicit
  `expires_at: null` is refused. `pinned` defaults to 30 days; `normal` may be
  posted with no expiry. (Constants: `BULLETIN_EXPIRY_DEFAULTS` in
  `lib/data/bulletins.ts`.)
- **Acknowledgements are idempotent.** A second `ack` returns the original
  timestamp and `created: false`.
- **Uploads are sniffed by magic bytes**, not by filename or the client's
  `Content-Type`, and re-encoded without metadata.
- **`admin` cannot demote themselves, and the last admin cannot be demoted.**

### `GET /api/announcements/stream`

Server-Sent Events carrying newly published bulletins. Push-on-change over a
poll: the handler records the connect time and queries the `bulletins` table
every `ANNOUNCEMENTS_POLL_INTERVAL_MS` (**default 5000 ms**), emitting only rows
published since the last tick. There is no LISTEN/NOTIFY or CDC in this phase —
the poll *is* the mechanism, so expect up to one interval of latency.

Events: `ready` once, `bulletin` per new notice (same JSON as `GET
/api/bulletins`), and `: keep-alive` comments on quiet ticks so proxies don't
close the connection. The stream self-terminates after 30 minutes and the client
reconnects (EventSource does this automatically), which bounds the damage from a
client that vanishes without closing its socket.

---

## 3. Auth and RBAC

Roles, least to most privileged: `readonly` → `staff` → `author` →
`clinical_lead` → `admin`. Authorization is **rank-based**
(`lib/roles.ts`): a route asks for the least role it will admit and everything
above passes.

- `lib/auth.ts` — full Auth.js setup (providers, `requireRole`, OIDC).
- `lib/auth.config.ts` — the DB-free half of the config, plus the `Session` type
  augmentation.
- `proxy.ts` — the `/api/*` request boundary.

**Two things about the proxy, both deliberate:**

1. **It is `proxy.ts`, not `middleware.ts`.** Next.js 16 deprecated the
   `middleware` file convention and renamed it to `proxy` (same behaviour,
   `export function proxy`/default export). Following the deprecated name would
   have produced build warnings for no benefit.
2. **It is a cheap early rejection, not the security boundary.** It enforces
   authentication and the role floor for the HTTP method and path. It cannot
   enforce the fine-grained rules (a valid clinical-lead reviewer is a property
   of the request body and the database), and the Next.js docs are explicit that
   a matcher change can silently remove proxy coverage. **Every route handler
   re-checks with `requireRole()`.**

Path-specific policy in the proxy:

- `GET`/`HEAD`/`OPTIONS` on anything → any authenticated user.
- Other methods → `author`+, with two documented exceptions:
  - `POST /api/search-log` → `staff`+. Telemetry comes from every search box; a
    write-only-for-authors rule would mean nobody's searches were ever logged
    and the dead-search review would have no data.
  - `POST /api/bulletins/[id]/ack` → `staff`+. Acknowledging an urgent alert is
    a staff action, not a content-authoring one.
- `/api/users*` → `admin`.

### The credentials provider, and swapping in the hospital IdP

`DEV_CREDENTIALS_ENABLED` (default on) registers an email + password provider
that authenticates against the `User` table with bcrypt. Seeded accounts get
`SEED_DEFAULT_PASSWORD`, or a known development fallback with a warning.

To move to the hospital IdP, set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and
`OIDC_CLIENT_SECRET`; the OIDC provider registers itself and
`DEV_CREDENTIALS_ENABLED=false` retires the password path. **One caveat, stated
plainly:** an OIDC deployment wants Auth.js's database adapter (`Account`,
`Session`, `VerificationToken` models) for account linking and provider-initiated
logout. Those models are **not** in this phase's schema because the schema was
specified explicitly and the JWT strategy needs none of them. Adding them is a
normal `prisma migrate` change plus `@auth/prisma-adapter`; the `jwt`/`session`
callbacks in `lib/auth.config.ts` and the role-rank machinery do not change.
Role assignment from an IdP claim belongs in the `signIn` callback.

---

## 4. Data-access layer — `lib/data/`

The drop-in replacement for `lib/mock-data.ts`. Function names and return shapes
mirror the fixtures:

| `lib/mock-data.ts` | `lib/data/` |
| --- | --- |
| `KNOWLEDGE_ARTICLES` | `getArticles(filters?)`, `getArticleBySlug(slug)`, `getArticleById(id)` |
| `BULLETINS` | `getBulletins(filters?)`, `getBulletinById(id)` |
| `STAFF_DIRECTORY` | `getStaff(filters?)` |
| `findLinkedArticle(bulletin)` | `findLinkedArticle(bulletin)` — now `async` |
| `matchesQuery` / `matchesDepartment` | same, from `@/lib/data/filters` |

Extras: `getArticleVersions`, `getBacklinks`, `createArticle`, `updateArticle`,
`createBulletin`, `acknowledgeBulletin`, `getBulletinAcks`.

### What the frontend pass must do

1. **Swap the import:** `from "@/lib/mock-data"` → `from "@/lib/data"`. The
   return shapes are identical — `scripts/verify-backend.ts` asserts that field
   by field against the fixtures, and it is the reason `User.name` + `User.title`
   reproduce the fixture's `"Name, Role"` `author_name` byte for byte.

2. **`lib/data/*` is server-side.** These functions open a database connection,
   so they cannot be imported by a `"use client"` component.
   `app/page.tsx` is a client component today; the surfaces it renders must move
   to server components (or fetch `/api/*`). The shapes guarantee is about
   *data*, not about where the call runs. This is the one integration decision
   the frontend pass cannot avoid.

3. **`matchesQuery` / `matchesDepartment`** are pure and client-safe, but import
   them from `@/lib/data/filters`, not the `@/lib/data` barrel — the barrel
   pulls the database modules in with it.

4. **Ordering changed, unavoidably.** Reads are sorted (articles by
   `updated_at` desc, bulletins by `published_at` desc, staff alphabetically);
   the fixtures had no meaningful order. Any UI that assumed fixture order needs
   a look.

Decisions worth knowing:

- **`User.name` + `User.title`** exist as two fields rather than one string so
  that `author_name` can be composed to match the fixtures exactly. `title` is
  nullable: service accounts (the importer) have none.
- **`User.passwordHash`** is nullable — an IdP account never has a local
  password. It is an addition to the specified `User` shape, required for the
  credentials provider to work at all.
- **`Article.sourceTitle` / `Article.importedAt`** carry import provenance.
- **Seeded bulletins have `expires_at = NULL`.** They are historical fixtures;
  giving them a real window would silently empty the board. Expiry applies to
  notices posted through the API.

---

## 5. Internal links — `lib/links.ts`

`extractInternalLinks(markdown)` → `{ slugLinks, anchors }`.
`validateLinks(markdown, registry)` → broken references, each with a stable
`reason` (`unknown_article` / `unknown_anchor`) the editor can turn into copy.
`extractHeadingIds(markdown)` and `buildLinkRegistry(articles)` build the
registry.

`slugify` is imported **from `components/MarkdownReader.tsx`** (the one permitted
change to that file was adding `export` to it), so link validation can never
disagree with the ids the reader actually renders — including the `-2` suffix
repeated headings get.

**Consequence to respect:** that makes `lib/links.ts` a client module —
`MarkdownReader.tsx` is `"use client"`, and calling a non-component export of a
client module from server code is a runtime error in the App Router. Import it
from client components (the future editor), never from a route handler.
Server-side slug generation uses `lib/slug.ts` instead, and
`scripts/verify-backend.ts` asserts the two implementations agree
character-for-character.

---

## 6. Uploads — `POST /api/uploads`

Multipart, field name `file`. JPEG/PNG/WebP/GIF, 10 MB default.

- **Type is checked by magic bytes** (`lib/image.ts`). A `.png` whose bytes are
  not a PNG is refused with `415`. SVG is deliberately not accepted: it is XML
  and script-capable.
- **EXIF is stripped by re-encoding through `sharp`.** `.rotate()` runs first, so
  the EXIF orientation is baked into the pixels and dropping the tag cannot
  rotate the image. Phone photos lose GPS, device make/model, and timestamps —
  the verification suite builds a real EXIF APP1 with a GPS sub-IFD and asserts
  nothing of it survives.
- Stored via `lib/storage.ts` with key `uploads/YYYY/MM/<uuid>.<ext>`, purely
  from env. The response is `{ url, key, mime_type, bytes, original_bytes,
  width, height }`; `url` is what the editor writes into markdown.
- If the `S3_*` variables are incomplete the route answers `503` naming the
  missing variables rather than failing obscurely.

---

## 7. MediaWiki import — `scripts/import-mediawiki/`

```bash
npm run import:mediawiki -- path/to/dump.xml [--dry-run] [--limit N]
```

Reads a MediaWiki XML export, converts each main-namespace page with
`pandoc -f mediawiki -t gfm`, and inserts it as an **`Article` with
`status: "draft"`** plus `sourceTitle` / `importedAt`. Everything lands as a
draft for a clinical lead to review; nothing is published automatically.

- **`pandoc` is required and the script says so.** A hand-written wikitext
  parser was explicitly not an option: templates, parser functions, and dialect
  quirks mean an approximate converter produces silently wrong clinical content.
  If `pandoc` is missing the run stops with install instructions rather than
  importing something mangled.
- **Idempotent via slugs.** A page whose slug already exists is skipped, so a
  second run against the same dump imports nothing and never duplicates.
- XML is parsed with `fast-xml-parser`. Redirects and non-main namespaces are
  skipped and reported.
- Prints a summary: imported / skipped / failed, with page titles and reasons.
  A fixture dump lives at `scripts/import-mediawiki/__fixtures__/sample-dump.xml`.
- Imported drafts are owned by a `mediawiki-import@dove-wiki.local` service
  account (role `author`, no password), created on first run. `departments` is
  left empty — that is a clinical judgement, not something an import guesses.

---

## 8. Verification

```bash
npm run verify:backend     # needs a seeded dev database
npm run typecheck
npm run lint
npm run build
```

`verify:backend` asserts the acceptance criteria against the live database and
cleans up after itself. It covers: fixture-shape parity for articles, bulletins,
and staff; the `q`/`department` filters agreeing with the mock predicates;
expired-notice exclusion; publishing refused without a reviewer and refused when
the reviewer is not a clinical lead; publishing creating an `ArticleVersion` and
republication creating the next; the trigger blocking `UPDATE` and `DELETE` on
`article_versions`; backlinks finding real links and ignoring near-miss slugs;
the urgent-expiry default; idempotent acknowledgements; EXIF (with GPS) removal
and magic-byte type refusal; link extraction/validation; and `lib/slug.ts`
agreeing with the reader's `slugify`.

Its cleanup disables the append-only trigger for the two statements that delete
its own fixtures — which is itself a demonstration that the trigger is present.

---

## 9. Deliberate deviations from the brief

| Brief | Here | Why |
| --- | --- | --- |
| `middleware.ts` | `proxy.ts` | Next.js 16 deprecated and renamed the convention; `middleware.ts` only warns. |
| `GET /api/users` etc. were not listed | added `GET /api/users`, `PATCH /api/users/[id]` | "user admin: `admin`" needs a surface to be true against, and the last-admin/self-demotion guards need somewhere to live. |
| `User`: `id, email, name, role, createdAt` | added nullable `title`, nullable `passwordHash` | `title` is needed to compose the fixture-accurate `author_name`; `passwordHash` is needed for the credentials provider. |
| `Article`: no import fields | added `sourceTitle`, `importedAt` | §8 requires the importer to record them. |
| `Article.updatedAt` via Prisma `@updatedAt` | set explicitly on every write | `@updatedAt` overwrites a provided value on update, so re-seeding could not preserve the fixture timestamps. |
| §2 listed `updatedAt` in the schema | kept it; it is simply not Prisma-managed | Same column, same semantics, deterministic seeding. |
