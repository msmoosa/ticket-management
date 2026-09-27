// Run Prisma CLI commands through the `db:*` scripts, which pass `--env-file=.env` so DATABASE_URL is set.
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
