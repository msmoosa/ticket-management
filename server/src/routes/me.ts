import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";

export const meRouter = Router();

meRouter.get("/", requireAuth, (_req, res) => {
  res.json({ user: res.locals.user });
});
