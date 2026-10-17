-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "awaitingReplySince" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;


-- Backfill: waiting since the earliest customer message after the last agent reply (the ticket
-- itself counts as the first customer message); null when an agent spoke last.
UPDATE "ticket" t
SET "awaitingReplySince" = CASE
  WHEN last_agent.at IS NULL THEN t."createdAt"
  ELSE (
    SELECT min(r."createdAt") FROM "ticket_reply" r
    WHERE r."ticketId" = t.id AND r."sender" = 'customer' AND r."createdAt" > last_agent.at
  )
END
FROM (
  SELECT t2.id, (
    SELECT max(r."createdAt") FROM "ticket_reply" r
    WHERE r."ticketId" = t2.id AND r."sender" = 'agent'
  ) AS at
  FROM "ticket" t2
) last_agent
WHERE last_agent.id = t.id;
