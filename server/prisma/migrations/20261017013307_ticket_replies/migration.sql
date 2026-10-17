-- CreateTable
CREATE TABLE "ticket_reply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_reply_ticketId_createdAt_idx" ON "ticket_reply"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_reply_authorId_idx" ON "ticket_reply"("authorId");

-- AddForeignKey
ALTER TABLE "ticket_reply" ADD CONSTRAINT "ticket_reply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_reply" ADD CONSTRAINT "ticket_reply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
