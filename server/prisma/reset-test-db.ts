// Run with `bun run db:test:reset` (loads .env.test). Applies pending migrations to the
// test database (creating it if needed), empties every table, and seeds the admin.
// Refuses to touch any database whose name doesn't end in `_test`.
const url = process.env.DATABASE_URL;
const dbName = url ? new URL(url).pathname.slice(1) : "";

if (!dbName.endsWith("_test")) {
  console.error(`Refusing to reset "${dbName || "(DATABASE_URL unset)"}": database name must end in _test`);
  process.exit(1);
}

function prismaCli(...args: string[]) {
  const { exitCode } = Bun.spawnSync(["bun", "--bun", "prisma", ...args], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (exitCode !== 0) process.exit(exitCode);
}

prismaCli("migrate", "deploy");

// Imported after migrating so the client connects to an up-to-date schema.
const { prisma } = await import("../src/db.ts");
const tables = await prisma.$queryRaw<{ tablename: string }[]>`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
if (tables.length > 0) {
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
await prisma.$disconnect();
console.log(`Truncated ${tables.length} tables in ${dbName}`);

prismaCli("db", "seed");
