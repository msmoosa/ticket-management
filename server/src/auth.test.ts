import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.ts";
import { auth } from "./auth.ts";
import { prisma } from "./db.ts";
import { Role } from "./generated/prisma/enums.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

const email = `auth-test-${crypto.randomUUID()}@example.com`;
const password = "correct-horse-battery";

beforeAll(() => {
  server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } });
  server.close();
});

function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function sessionCookie(res: Response) {
  const cookie = res.headers
    .getSetCookie()
    .find((c) => c.includes("better-auth.session_token="));
  expect(cookie).toBeDefined();
  return cookie!.split(";")[0]!;
}

test("GET /api/me without a session returns 401", async () => {
  const res = await fetch(`${baseUrl}/api/me`);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("public sign-up is disabled", async () => {
  const res = await post("/api/auth/sign-up/email", {
    name: "Should Not Exist",
    email,
    password,
  });
  expect(res.status).toBe(400);
  expect(await prisma.user.count({ where: { email } })).toBe(0);
});

test("sign in and sign out with database sessions", async () => {
  // Users are created server-side (admin plugin), not via public sign-up.
  const { user } = await auth.api.createUser({
    body: { name: "Test Agent", email, password },
  });
  expect(user.role).toBe(Role.agent);

  const badSignIn = await post("/api/auth/sign-in/email", {
    email,
    password: "wrong-password",
  });
  expect(badSignIn.status).toBe(401);

  const signIn = await post("/api/auth/sign-in/email", { email, password });
  expect(signIn.status).toBe(200);
  const cookie = sessionCookie(signIn);
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);

  const me = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
  expect(me.status).toBe(200);
  expect(await me.json()).toMatchObject({ user: { email, role: Role.agent } });

  const signOut = await post("/api/auth/sign-out", {}, cookie);
  expect(signOut.status).toBe(200);

  const meAfter = await fetch(`${baseUrl}/api/me`, {
    headers: { Cookie: cookie },
  });
  expect(meAfter.status).toBe(401);
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
});
