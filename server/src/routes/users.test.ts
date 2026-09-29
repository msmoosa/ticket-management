import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { auth } from "../auth.ts";
import { prisma } from "../db.ts";
import { Role } from "../generated/prisma/enums.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

const id = crypto.randomUUID();
const admin = { email: `users-admin-${id}@example.com`, name: "Users Admin" };
const agent = { email: `users-agent-${id}@example.com`, name: "Users Agent" };
const password = "correct-horse-battery";

beforeAll(async () => {
  server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;

  await auth.api.createUser({ body: { ...admin, password, role: Role.admin } });
  await auth.api.createUser({ body: { ...agent, password } });
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: [admin.email, agent.email] } },
  });
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
  return cookie!.split(";")[0]!;
}

test("GET /api/users without a session returns 401", async () => {
  const res = await fetch(`${baseUrl}/api/users`);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("GET /api/users as an agent returns 403", async () => {
  const cookie = await signIn(agent.email);
  const res = await fetch(`${baseUrl}/api/users`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Forbidden" });
});

test("GET /api/users as an admin lists users without sensitive fields", async () => {
  const cookie = await signIn(admin.email);
  const res = await fetch(`${baseUrl}/api/users`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);

  const { users } = (await res.json()) as { users: Record<string, unknown>[] };
  expect(users).toContainEqual(
    expect.objectContaining({ ...admin, role: Role.admin, banned: false }),
  );
  expect(users).toContainEqual(
    expect.objectContaining({ ...agent, role: Role.agent, banned: false }),
  );
  for (const user of users) {
    expect(Object.keys(user).sort()).toEqual(
      ["banned", "createdAt", "email", "id", "name", "role"].sort(),
    );
  }
});
