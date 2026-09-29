import { Router } from "express";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
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

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  password,
});

// Omit `password` to keep the current one.
const updateUserSchema = createUserSchema.extend({ password: password.optional() });

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  return parsed.data;
}

// Soft-deleted users keep their row (and email), so emails stay reserved after deletion.
async function assertEmailAvailable(email: string, exceptId?: string) {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });
  if (!existing || existing.id === exceptId) return;
  throw new HttpError(
    409,
    existing.deletedAt
      ? "This email belongs to a deleted user"
      : "A user with this email already exists",
  );
}

async function assertActiveUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!user || user.deletedAt) throw new HttpError(404, "User not found");
}

// Better Auth throws APIError; surface its 4xx responses in the app's `{ error }` shape.
async function callAuth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof APIError && err.statusCode < 500) {
      throw new HttpError(err.statusCode, err.message);
    }
    throw err;
  }
}

usersRouter.get("/", requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: userSelect,
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

usersRouter.post("/", requireAdmin, async (req, res) => {
  const { name, email, password } = parseBody(createUserSchema, req.body);
  await assertEmailAvailable(email);

  // No headers: requireAdmin already checked the session, so skip Better Auth's own check.
  const { user: created } = await callAuth(() =>
    auth.api.createUser({ body: { name, email, password, role: Role.agent } }),
  );

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: created.id },
    select: userSelect,
  });
  res.status(201).json({ user });
});

usersRouter.patch<{ id: string }>("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, password } = parseBody(updateUserSchema, req.body);

  await assertActiveUser(id);
  await assertEmailAvailable(email, id);

  // These admin endpoints act as the signed-in admin, so they need the request's session.
  const headers = fromNodeHeaders(req.headers);
  await callAuth(() =>
    auth.api.adminUpdateUser({ body: { userId: id, data: { name, email } }, headers }),
  );
  if (password) {
    await callAuth(() =>
      auth.api.setUserPassword({ body: { userId: id, newPassword: password }, headers }),
    );
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id }, select: userSelect });
  res.json({ user });
});

// Soft delete: the row stays (with its email reserved) but the user disappears from the list,
// is signed out everywhere, and can't sign in again (see the session hook in auth.ts).
// Any admin may delete any user, including another admin or themselves.
usersRouter.delete<{ id: string }>("/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  await assertActiveUser(id);

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: id } }),
  ]);
  res.status(204).end();
});
