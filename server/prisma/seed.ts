// Run with `bun run db:seed` (also runs on `prisma migrate reset`). Safe to re-run: an existing
// admin is left as is (its password isn't changed). With `--if-configured` (used by `db:deploy` on
// every production deploy) it does nothing when SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are unset.
import { auth } from "../src/auth.ts";
import { prisma } from "../src/db.ts";
import { Role } from "../src/generated/prisma/enums.ts";

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const name = process.env.SEED_ADMIN_NAME ?? "Admin";

if (!email || !password) {
  if (process.argv.includes("--if-configured")) {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set; skipping the admin seed");
    process.exit(0);
  }
  console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in server/.env");
  process.exit(1);
}

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  if (existing.role !== Role.admin) {
    await prisma.user.update({ where: { email }, data: { role: Role.admin } });
  }
  console.log(`Admin ${email} already exists`);
} else {
  // Called server-side without headers, so the admin plugin allows it without a session.
  await auth.api.createUser({ body: { email, password, name, role: Role.admin } });
  console.log(`Created admin ${email}`);
}

await prisma.$disconnect();
