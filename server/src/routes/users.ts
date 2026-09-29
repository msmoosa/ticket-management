import { Router } from "express";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "../auth.ts";
import { prisma } from "../db.ts";
import { Role } from "../generated/prisma/enums.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { HttpError } from "../middleware/error-handler.ts";

export const usersRouter = Router();

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  banned: true,
  createdAt: true,
} as const;

const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

usersRouter.get("/", requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: userSelect,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

usersRouter.post("/", requireAdmin, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  const { name, email, password } = parsed.data;

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new HttpError(409, "A user with this email already exists");
  }

  let id: string;
  try {
    // No headers: requireAdmin already checked the session, so skip Better Auth's own check.
    const { user } = await auth.api.createUser({
      body: { name, email, password, role: Role.agent },
    });
    id = user.id;
  } catch (err) {
    if (err instanceof APIError && err.statusCode < 500) {
      throw new HttpError(err.statusCode, err.message);
    }
    throw err;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: userSelect });
  res.status(201).json({ user });
});
