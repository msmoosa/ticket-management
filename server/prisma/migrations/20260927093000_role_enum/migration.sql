-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'agent');

-- Convert the existing text column in place so current roles are kept.
UPDATE "user" SET "role" = 'agent' WHERE "role" IS NULL OR "role" NOT IN ('admin', 'agent');
ALTER TABLE "user"
  ALTER COLUMN "role" TYPE "Role" USING "role"::"Role",
  ALTER COLUMN "role" SET DEFAULT 'agent',
  ALTER COLUMN "role" SET NOT NULL;
