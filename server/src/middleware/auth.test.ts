import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../auth.ts";
import { prisma } from "../db.ts";
import { Role } from "../generated/prisma/enums.ts";
import { requireAdmin } from "./auth.ts";
import { errorHandler } from "./error-handler.ts";

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl: string;

const id = crypto.randomUUID();
const adminEmail = `require-admin-${id}-admin@example.com`;
const agentEmail = `require-admin-${id}-agent@example.com`;
const password = "correct-horse-battery";

beforeAll(async () => {
  const app = express();
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.get("/admin-only", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;

  await auth.api.createUser({
    body: { name: "Admin", email: adminEmail, password, role: Role.admin },
  });
  await auth.api.createUser({
    body: { name: "Agent", email: agentEmail, password, role: Role.agent },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [adminEmail, agentEmail] } } });
  server.close();
});

async function signIn(email: string) {
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.includes("better-auth.session_token="));
  expect(cookie).toBeDefined();
  return cookie!.split(";")[0]!;
}

test("requireAdmin returns 401 without a session", async () => {
  const res = await fetch(`${baseUrl}/admin-only`);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("requireAdmin returns 403 for an agent", async () => {
  const cookie = await signIn(agentEmail);
  const res = await fetch(`${baseUrl}/admin-only`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Forbidden" });
});

test("requireAdmin allows an admin", async () => {
  const cookie = await signIn(adminEmail);
  const res = await fetch(`${baseUrl}/admin-only`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
