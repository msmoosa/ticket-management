-- CreateEnum
CREATE TYPE "TicketReplySender" AS ENUM ('agent', 'customer');

-- AlterTable
ALTER TABLE "ticket_reply" ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "sender" "TicketReplySender" NOT NULL DEFAULT 'agent';

-- CreateIndex
CREATE UNIQUE INDEX "ticket_reply_messageId_key" ON "ticket_reply"("messageId");

