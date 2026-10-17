import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
const created = { email: `users-created-${id}@example.com`, name: "Created Agent" };
const editable = { email: `users-editable-${id}@example.com`, name: "Editable Agent" };
const renamed = { email: `users-renamed-${id}@example.com`, name: "Renamed Agent" };
let editableId: string;
const doomedAgent = { email: `users-doomed-agent-${id}@example.com`, name: "Doomed Agent" };
const doomedAdmin = { email: `users-doomed-admin-${id}@example.com`, name: "Doomed Admin" };
const selfDeleter = { email: `users-self-deleter-${id}@example.com`, name: "Self Deleter" };

beforeAll(async () => {
  server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;

  await auth.api.createUser({ body: { ...admin, password, role: Role.admin } });
  await auth.api.createUser({ body: { ...agent, password } });
  ({
    user: { id: editableId },
  } = await auth.api.createUser({ body: { ...editable, password } }));
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { contains: id } } });
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          admin.email,
          agent.email,
          created.email,
          editable.email,
          renamed.email,
          doomedAgent.email,
          doomedAdmin.email,
          selfDeleter.email,
        ],
      },
    },
  });
  server.close();
});

function signInRequest(email: string, pw = password) {
  return fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    },
    body: JSON.stringify({ email, password: pw }),
  });
}

async function signIn(email: string, pw = password) {
  const res = await signInRequest(email, pw);
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

function postUser(body: unknown, cookie?: string) {
  return fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

test("POST /api/users without a session returns 401", async () => {
  const res = await postUser({ ...created, password });
  expect(res.status).toBe(401);
});

test("POST /api/users as an agent returns 403", async () => {
  const cookie = await signIn(agent.email);
  const res = await postUser({ ...created, password }, cookie);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Forbidden" });
});

test.each([
  [{ ...created, name: "Al", password }, "Name must be at least 3 characters"],
  [{ ...created, password: "short" }, "Password must be at least 8 characters"],
  [{ ...created, email: "not-an-email", password }, "Enter a valid email address"],
])("POST /api/users rejects invalid input with 400 (%#)", async (body, error) => {
  const cookie = await signIn(admin.email);
  const res = await postUser(body, cookie);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error });
  expect(await prisma.user.findUnique({ where: { email: created.email } })).toBeNull();
});

test("POST /api/users as an admin creates an agent who can sign in", async () => {
  const cookie = await signIn(admin.email);
  const res = await postUser({ ...created, password }, cookie);
  expect(res.status).toBe(201);

  const { user } = (await res.json()) as { user: Record<string, unknown> };
  expect(user).toEqual(
    expect.objectContaining({ ...created, role: Role.agent, banned: false }),
  );
  expect(Object.keys(user).sort()).toEqual(
    ["banned", "createdAt", "email", "id", "name", "role"].sort(),
  );
  await signIn(created.email);
});

test("POST /api/users with an existing email returns 409", async () => {
  const cookie = await signIn(admin.email);
  const res = await postUser({ ...created, email: created.email.toUpperCase(), password }, cookie);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "A user with this email already exists" });
});

function patchUser(userId: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}/api/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

test("PATCH /api/users/:id without a session returns 401", async () => {
  const res = await patchUser(editableId, editable);
  expect(res.status).toBe(401);
});

test("PATCH /api/users/:id as an agent returns 403", async () => {
  const cookie = await signIn(agent.email);
  const res = await patchUser(editableId, { ...editable, name: "Hijacked" }, cookie);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Forbidden" });
});

test.each([
  [{ ...editable, name: "Al" }, "Name must be at least 3 characters"],
  [{ ...editable, email: "not-an-email" }, "Enter a valid email address"],
  [{ ...editable, password: "short" }, "Password must be at least 8 characters"],
])("PATCH /api/users/:id rejects invalid input with 400 (%#)", async (body, error) => {
  const cookie = await signIn(admin.email);
  const res = await patchUser(editableId, body, cookie);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error });
});

test("PATCH /api/users/:id for an unknown user returns 404", async () => {
  const cookie = await signIn(admin.email);
  const res = await patchUser("no-such-user", editable, cookie);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "User not found" });
});

test("PATCH /api/users/:id with another user's email returns 409", async () => {
  const cookie = await signIn(admin.email);
  const res = await patchUser(editableId, { ...editable, email: agent.email.toUpperCase() }, cookie);
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "A user with this email already exists" });
});

test("PATCH /api/users/:id without a password keeps the current one", async () => {
  const cookie = await signIn(admin.email);
  // Saving the user's own email unchanged is not a conflict.
  const res = await patchUser(editableId, { ...editable, name: "Kept Password" }, cookie);
  expect(res.status).toBe(200);

  const { user } = (await res.json()) as { user: Record<string, unknown> };
  expect(user).toEqual(
    expect.objectContaining({ id: editableId, ...editable, name: "Kept Password", role: Role.agent }),
  );
  await signIn(editable.email);
});

test("PATCH /api/users/:id updates name, email and password", async () => {
  const cookie = await signIn(admin.email);
  const newPassword = "brand-new-password";
  const res = await patchUser(
    editableId,
    { name: renamed.name, email: renamed.email.toUpperCase(), password: newPassword },
    cookie,
  );
  expect(res.status).toBe(200);

  const { user } = (await res.json()) as { user: Record<string, unknown> };
  expect(Object.keys(user).sort()).toEqual(
    ["banned", "createdAt", "email", "id", "name", "role"].sort(),
  );
  expect(user).toEqual(expect.objectContaining({ id: editableId, ...renamed, role: Role.agent }));

  expect((await signInRequest(renamed.email, password)).status).toBe(401);
  await signIn(renamed.email, newPassword);
});

async function createUserId(body: { email: string; name: string }, role: Role = Role.agent) {
  const { user } = await auth.api.createUser({ body: { ...body, password, role } });
  return user.id;
}

function deleteUser(userId: string, cookie?: string) {
  return fetch(`${baseUrl}/api/users/${userId}`, {
    method: "DELETE",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function listedEmails(cookie: string) {
  const res = await fetch(`${baseUrl}/api/users`, { headers: { Cookie: cookie } });
  const { users } = (await res.json()) as { users: { email: string }[] };
  return users.map((u) => u.email);
}

test("DELETE /api/users/:id without a session returns 401", async () => {
  const res = await deleteUser(editableId);
  expect(res.status).toBe(401);
});

test("DELETE /api/users/:id as an agent returns 403 and deletes nothing", async () => {
  const cookie = await signIn(agent.email);
  const res = await deleteUser(editableId, cookie);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "Forbidden" });
  const row = await prisma.user.findUniqueOrThrow({ where: { id: editableId } });
  expect(row.deletedAt).toBeNull();
});

test("DELETE /api/users/:id for an unknown user returns 404", async () => {
  const cookie = await signIn(admin.email);
  const res = await deleteUser("no-such-user", cookie);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "User not found" });
});

describe("after an admin deletes an agent", () => {
  let doomedId: string;
  let adminCookie: string;
  let doomedCookie: string;

  let ticketId: string;

  beforeAll(async () => {
    doomedId = await createUserId(doomedAgent);
    ({ id: ticketId } = await prisma.ticket.create({
      data: {
        subject: `Assigned [${id}]`,
        body: "Body",
        fromEmail: "student@example.com",
        assignedToId: doomedId,
      },
    }));
    doomedCookie = await signIn(doomedAgent.email);
    adminCookie = await signIn(admin.email);
    const res = await deleteUser(doomedId, adminCookie);
    expect(res.status).toBe(204);
  });

  test("the row is kept with deletedAt set (soft delete)", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: doomedId } });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.email).toBe(doomedAgent.email);
  });

  test("the user is left out of GET /api/users", async () => {
    const emails = await listedEmails(adminCookie);
    expect(emails).not.toContain(doomedAgent.email);
    expect(emails).toContain(agent.email);
  });

  test("their existing sessions stop working", async () => {
    expect(await prisma.session.count({ where: { userId: doomedId } })).toBe(0);
    const res = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: doomedCookie } });
    expect(res.status).toBe(401);
  });

  test("they can no longer sign in", async () => {
    const res = await signInRequest(doomedAgent.email);
    expect(res.status).toBe(401);
    // Same answer as a wrong password, so deleted accounts aren't revealed.
    expect(await res.json()).toMatchObject({ message: "Invalid email or password" });
  });

  test("deleting or editing them again returns 404", async () => {
    expect((await deleteUser(doomedId, adminCookie)).status).toBe(404);
    expect((await patchUser(doomedId, doomedAgent, adminCookie)).status).toBe(404);
  });

  test("their tickets go back to unassigned", async () => {
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.assignedToId).toBeNull();
  });

  test("their email stays reserved", async () => {
    const res = await postUser({ ...doomedAgent, password }, adminCookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This email belongs to a deleted user" });
  });
});

test("DELETE /api/users/:id lets an admin delete another admin", async () => {
  const doomedAdminId = await createUserId(doomedAdmin, Role.admin);
  const cookie = await signIn(admin.email);
  const res = await deleteUser(doomedAdminId, cookie);
  expect(res.status).toBe(204);
  expect((await signInRequest(doomedAdmin.email)).status).toBe(401);
});

test("DELETE /api/users/:id lets an admin delete themselves, ending their session", async () => {
  const selfId = await createUserId(selfDeleter, Role.admin);
  const cookie = await signIn(selfDeleter.email);
  const res = await deleteUser(selfId, cookie);
  expect(res.status).toBe(204);

  const me = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
  expect(me.status).toBe(401);
});

test("malformed JSON on an app route returns 400, not 500", async () => {
  const cookie = await signIn(admin.email);
  const res = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: '{"name": oops',
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON body" });
});
