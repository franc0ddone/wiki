/**
 * The Prisma client the demo scripts run on.
 *
 * `prisma/seed.ts` builds its own client rather than importing `lib/db.ts`,
 * whose singleton is cached on `globalThis` and meant for a long-lived server
 * process. These scripts are short-lived, so they get a plain client they close
 * when they are done — and, like the existing seed, they load `.env` first so
 * they work under plain `tsx` (Next.js is not in the picture here).
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export function createSeedClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export type SeedClient = PrismaClient;

/**
 * Run an async script body against a fresh client and always disconnect.
 *
 * Every demo entry point ends the same way: report success, close the pool, and
 * turn an unhandled failure into a non-zero exit so `npm run` is usable in a
 * shell pipeline or a CI step.
 */
export async function runScript(
  name: string,
  body: (prisma: SeedClient) => Promise<void>,
): Promise<void> {
  const prisma = createSeedClient();
  try {
    await body(prisma);
  } catch (error) {
    console.error(`[${name}] failed:`, error);
    await prisma.$disconnect();
    process.exit(1);
  }
  await prisma.$disconnect();
}
