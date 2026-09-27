import { Router } from "express";
import { prisma } from "../db.ts";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "ok" });
  } catch (err) {
    console.error(err);
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});
