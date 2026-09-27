// Usage: bun run make-admin <email>
import { prisma } from "../src/db.ts";

const email = process.argv[2];
if (!email) {
  console.error("Usage: bun run make-admin <email>");
  process.exit(1);
}

const user = await prisma.user.update({
  where: { email },
  data: { role: "admin" },
});
console.log(`${user.email} is now an admin`);
await prisma.$disconnect();
