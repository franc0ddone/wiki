# Dove Wiki

Internal operations hub for Dove Lewis Emergency Animal Hospital — a bulletin
board, a knowledge base of standard operating procedures, and a staff directory.

## Platform target

- **OS / browser: Windows 11 on Chromium (Edge or Chrome).** That is the
  hospital's desktop standard, and it is what the UI is designed and verified
  against. The design language is "Clinical Light" (see `app/globals.css`).
- **Shortcut hints.** Every keyboard-shortcut hint is rendered through the
  platform-aware hook in `components/MasterDetailShell.tsx`
  (`useIsApplePlatform`). The server default is **non-Apple**, so a Windows
  client sees `Ctrl K` in the server HTML with no hydration flicker; an Apple
  client re-renders once with `⌘K`. Never hardcode `⌘` / `Cmd` in a UI string —
  route it through the hook.
- **Displays.** Hospital machines are frequently 1080p and non-retina, where
  hairline borders and sub-12px text degrade badly. The polish spec's contrast
  minimums and visible card edges are therefore mandatory, not optional.

## Getting started

```bash
cp .env.example .env   # then fill in DATABASE_URL, AUTH_SECRET, S3_*
npm install
npm run db:migrate     # prisma migrate dev
npm run db:seed        # loads the phase-1 fixtures
npm run dev
```

Open http://localhost:3000.

## Documentation

- `BACKEND.md` — the Prisma/PostgreSQL schema, API routes, auth/RBAC, uploads,
  and the `lib/data/*` server-side data layer the UI reads from.
- `AGENTS.md` — the agent briefing (Next.js version notes).