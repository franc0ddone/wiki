/**
 * `npx tsx scripts/make-admin.ts --email you@hospital.org --name "Your Name" [--title "Your Title"] [--password secret]`
 *
 * Creates (or promotes) a login for a real person and grants the `admin` role,
 * so you can sign in, use the editor, and hand out `author` / `clinical_lead`
 * roles to the team. Idempotent: re-running it for the same email just updates
 * the name/title/role and resets the password.
 *
 * The password comes from `--password`, or the `MAKE_ADMIN_PASSWORD` env var.
 * Never commit a real password; this is a local provisioning script.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const title = arg("title")?.trim() || null;
  const password = arg("password") ?? process.env.MAKE_ADMIN_PASSWORD;

  if (!email || !name) {
    console.error('Usage: npx tsx scripts/make-admin.ts --email you@hospital.org --name "Your Name" [--title "Your Title"] [--password secret]');
    process.exit(1);
  }
  if (!password) {
    console.error("Set the password with --password or the MAKE_ADMIN_PASSWORD env var.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, title, role: "admin", passwordHash },
      create: { email, name, title, role: "admin", passwordHash },
      select: { email: true, name: true, role: true },
    });
    console.log(`Done: ${user.name} <${user.email}> is now '${user.role}'. Sign in with these credentials.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
