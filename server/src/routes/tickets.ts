import { Router } from "express";
import { prisma } from "../db.ts";
import { requireAuth } from "../middleware/auth.ts";

export const ticketsRouter = Router();

// Every signed-in user (agents and admins) works tickets. Newest first; `id` breaks ties
// between tickets created in the same millisecond so the order is stable.
ticketsRouter.get("/", requireAuth, async (_req, res) => {
  const tickets = await prisma.ticket.findMany({
    select: {
      id: true,
      subject: true,
      fromEmail: true,
      fromName: true,
      status: true,
      category: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  res.json({ tickets });
});
