-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('general_question', 'technical_question', 'refund_request');

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "category" "TicketCategory";

-- CreateIndex
CREATE INDEX "ticket_category_idx" ON "ticket"("category");
