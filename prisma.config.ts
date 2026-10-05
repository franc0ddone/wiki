// Prisma ORM 7 CLI configuration.
//
// Prisma 7 no longer reads `.env` automatically and no longer takes the
// connection string from schema.prisma — both live here.
//
// `dotenv/config` must be the first import so DATABASE_URL is populated before
// the config object is evaluated.
import "dotenv/config";
import { defineConfig } from "prisma/config";

// Deliberately read through `process.env` rather than Prisma's `env()` helper:
// `env()` throws when the variable is absent, which would make `prisma
// generate` (and therefore `npm run build`) impossible on a machine that has
// not created a `.env` yet. `generate` never opens a connection, so an empty
// string is harmless there; `migrate`/`db` commands fail loudly on their own.
const databaseUrl = process.env["DATABASE_URL"] ?? "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Run with `npx prisma db seed` (Prisma 7 does not auto-seed after migrate).
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl,
  },
});
