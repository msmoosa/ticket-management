import { Router } from "express";
import { prisma } from "../db.ts";
import { requireAdmin } from "../middleware/auth.ts";

export const usersRouter = Router();

usersRouter.get("/", requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      banned: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});
