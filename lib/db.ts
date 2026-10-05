import { config as loadEnv } from "dotenv";

// Next.js loads .env for the app, but the seed/import scripts run under plain
// Node (`tsx`), where nothing populates process.env. Loading here — once, at
// the top of the module every backend entry point imports — keeps a single
// behaviour for both.
if (!process.env.DATABASE_URL) {
  loadEnv({ path: ".env", quiet: true });
  loadEnv({ path: ".env.local", override: true, quiet: true });
}

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma Client singleton.
 *
 * Prisma 7 removed the bundled query engine: the client is constructed with a
 * driver adapter, which is what `@prisma/adapter-pg` supplies.
 *
 * The client is created lazily rather than at module scope. Route handlers are
 * bundled during `next build`, and a module-scope constructor would make the
 * build require a reachable DATABASE_URL — it does not need one.
 */

const globalForPrisma = globalThis as unknown as { __doveWikiPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalForPrisma.__doveWikiPrisma) return globalForPrisma.__doveWikiPrisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a PostgreSQL database.",
    );
  }

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  // A dev-server hot reload re-evaluates modules; without the cache each reload
  // would open another pool and eventually exhaust Postgres connections.
  globalForPrisma.__doveWikiPrisma = client;
  return client;
}

export type Database = ReturnType<typeof getDb>;
