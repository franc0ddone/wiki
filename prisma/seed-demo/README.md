# Demo reset

Nothing here is real. No real patient, no real staff member, no real medical
data — the roster, the case details, and every note are invented for demos. 

## Commands

```bash
npm run seed:demo:clear   # phase 1 — wipe content (accounts, roles, auth untouched)
npm run seed:demo         # phase 2 — load the demo content
npm run seed:demo:reset   # both, in order
```

The npm scripts are wrappers; the underlying commands are:

```bash
npx tsx prisma/seed-demo/run.ts --clear
npx tsx prisma/seed-demo/run.ts --seed
npx tsx prisma/seed-demo/run.ts --reset
```

Both phases are idempotent. Phase 1 deletes content rows only; phase 2 upserts on
a natural key (`email`, `systemId`, `slug`, `bulletin.id`, attachment `fileKey`),
so running the pair twice leaves exactly one of everything.

### What phase 1 clears

Articles (+ versions, reads, attachments), bulletins (+ acks, reactions,
attachments), staged bulletin attachments, and staff directory entries. **User
accounts, roles, password hashes, auth data, and role requests are never
touched** — the demo login keeps working throughout.

### What phase 2 writes

- **15 SOPs** (`sops/*.md`) — each published with an initial version.
- **15 bulletins** (`bulletins/*.md`) — pinned, urgent, celebratory, and regular.
- **20 staff** (`staff.json`) — including a record for `foddone@dovelewis.org`,
  which is what links the demo login to a directory entry so the "I'm here
  today" check-in can be demonstrated.
- **User accounts for the demo staff** — an `Article`/`Bulletin` author must be a
  `User`, so each staff record gets an account. These are created only: an email
  that already has an account (the demo user) is reused exactly as it is. New
  accounts carry no password hash and therefore cannot sign in — the demo's login
  path is unchanged.

## Layout

```
run.ts           the CLI (--clear / --seed / --reset)
clear.ts         phase 1, as a library
seed.ts          phase 2, as a library
content.ts       loads and validates the files below
frontmatter.ts   the tiny `---` header reader
client.ts        the Prisma client + script runner
bulletins/*.md   one file per bulletin, metadata in front matter
sops/*.md        one file per SOP, metadata in front matter
staff.json       the 20 directory records
attachments/     source files the seed uploads and attaches to bulletins
```

Hero images live in `public/demo/heroes/` as SVG (text, so they review in the
diff like everything else).

## Adding or changing content

Add a Markdown file to `sops/` or `bulletins/`. The front matter keys are read by
`content.ts`, which validates them and throws, naming the file, when something is
missing or malformed. Two rules worth knowing up front:

- An SOP's `slug` must match its file name (`slug.md`).
- Every `author` must be an email present in `staff.json`, and every `linked_sop`
  must name a seeded SOP.

Bulletin `id` is a fixed UUID in the front matter — it is the bulletin's stable
identity, so leave it alone once a notice exists.

## Limits worth knowing

- **"Here today" is not seeded.** Presence is per-browser `localStorage` (see
  `lib/directory/roster.ts`), not a column, so the directory draws its own
  deterministic on-shift subset (~40% of the roster, rotating with the day). The
  seed cannot set it, and the check-in that *can* be seeded — the demo user's
  staff record — is the one thing that makes the toggle demonstrable.
- **Attachments need object storage.** The seed uploads each attachment through
  the real pipeline (magic-byte check, deterministic `attachments/demo/<name>`
  key) and only writes the row if the upload succeeds, so a demo run without
  MinIO/S3 simply skips them and says so.
- **Dates are fixed**, around the demo build window (early October 2026), matching
  how the phase-1 fixtures work. A pinned notice with an expiry will unpin
  itself once that date passes — that is the expiry behaviour, working.
- **`npm run verify:backend` expects the phase-1 fixtures** in `lib/mock-data.ts`
  and will not pass against a demo-reset database. That is expected: this reset
  deliberately replaces that content. `npx tsc --noEmit` and `npx next build`
  are unaffected.
