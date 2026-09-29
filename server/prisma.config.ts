// Run Prisma CLI commands through the `db:*` scripts, which pass `--env-file=.env` (or `.env.test`
// for `db:test:reset`) so DATABASE_URL is set.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "bun prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
