import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { auth } from "../auth.ts";
import { prisma } from "../db.ts";
import { Role, TicketCategory, TicketStatus } from "../generated/prisma/enums.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

const run = crypto.randomUUID();
const admin = { email: `tickets-admin-${run}@example.com`, name: "Tickets Admin" };
const agent = { email: `tickets-agent-${run}@example.com`, name: "Tickets Agent" };
const banned = { email: `tickets-banned-${run}@example.com`, name: "Tickets Banned" };
const deleted = { email: `tickets-deleted-${run}@example.com`, name: "Tickets Deleted" };
const password = "correct-horse-battery";
const userIds: Record<"admin" | "agent" | "banned" | "deleted", string> = {
  admin: "",
  agent: "",
  banned: "",
  deleted: "",
};

// Created out of order on purpose; `createdAt` decides the expected order.
const seeded = [
  {
    subject: `Middle [${run}]`,
    createdAt: new Date("2026-05-02T10:00:00Z"),
    category: TicketCategory.general_question,
  },
  {
    subject: `Oldest [${run}]`,
    createdAt: new Date("2026-05-01T10:00:00Z"),
    status: TicketStatus.closed,
    // A different sender, to test searching by name and email.
    fromEmail: `olive-${run}@example.com`,
    fromName: `Olive Older-${run}`,
  },
  {
    subject: `Newest [${run}]`,
    createdAt: new Date("2026-05-03T10:00:00Z"),
    category: TicketCategory.refund_request,
  },
];

beforeAll(async () => {
  server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;

  userIds.admin = (await auth.api.createUser({ body: { ...admin, password, role: Role.admin } })).user.id;
  userIds.agent = (await auth.api.createUser({ body: { ...agent, password } })).user.id;
  userIds.banned = (await auth.api.createUser({ body: { ...banned, password } })).user.id;
  userIds.deleted = (await auth.api.createUser({ body: { ...deleted, password } })).user.id;
  await prisma.user.update({ where: { id: userIds.banned }, data: { banned: true } });
  await prisma.user.update({ where: { id: userIds.deleted }, data: { deletedAt: new Date() } });
  await prisma.ticket.createMany({
    data: seeded.map((t) => ({
      body: "Body",
      fromEmail: "student@example.com",
      fromName: "Sam Student",
      ...t,
    })),
  });
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { contains: run } } });
  await prisma.user.deleteMany({
    where: { email: { in: [admin.email, agent.email, banned.email, deleted.email] } },
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

type ListedTicket = Record<string, unknown> & { subject: string; createdAt: string };

type ListResponse = { tickets: ListedTicket[]; total: number; page: number; pageSize: number };

async function listPage(cookie: string, query = "") {
  const res = await fetch(`${baseUrl}/api/tickets${query}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as ListResponse;
}

async function listTickets(cookie: string, query = "") {
  return (await listPage(cookie, query)).tickets;
}

// Other tests' tickets share the database, so scope to this run's tickets to keep them on page 1.
const ours = `?search=${run}`;

test("GET /api/tickets without a session returns 401", async () => {
  const res = await fetch(`${baseUrl}/api/tickets`);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("GET /api/tickets lists tickets newest first", async () => {
  const cookie = await signIn(agent.email);
  const subjects = (await listTickets(cookie, ours)).map((t) => t.subject);
  expect(subjects).toEqual([`Newest [${run}]`, `Middle [${run}]`, `Oldest [${run}]`]);

  // The whole list is ordered, not just these tickets.
  const times = (await listTickets(cookie)).map((t) => Date.parse(t.createdAt));
  expect(times).toEqual([...times].sort((a, b) => b - a));
});

test("GET /api/tickets returns list fields only (no body)", async () => {
  const tickets = await listTickets(await signIn(agent.email), ours);
  const newest = tickets.find((t) => t.subject === `Newest [${run}]`)!;

  expect(newest).toEqual({
    id: expect.any(String),
    subject: `Newest [${run}]`,
    fromEmail: "student@example.com",
    fromName: "Sam Student",
    status: "open",
    category: "refund_request",
    createdAt: "2026-05-03T10:00:00.000Z",
  });
});

test("GET /api/tickets returns a null category for unclassified tickets", async () => {
  const tickets = await listTickets(await signIn(agent.email), ours);
  const oldest = tickets.find((t) => t.subject === `Oldest [${run}]`)!;
  expect(oldest.category).toBeNull();
});

test("GET /api/tickets is available to admins too", async () => {
  const tickets = await listTickets(await signIn(admin.email), ours);
  expect(tickets.some((t) => t.subject === `Oldest [${run}]`)).toBe(true);
});

// Subjects of this run's tickets, in the order the server returned them. Adds the run's
// search unless the query has its own.
async function ourOrder(query: string) {
  const params = new URLSearchParams(query);
  if (!params.has("search")) params.set("search", run);
  const tickets = await listTickets(await signIn(agent.email), `?${params}`);
  return tickets.filter((t) => t.subject.includes(run)).map((t) => t.subject.split(" ")[0]);
}

test("GET /api/tickets sorts by the requested column and direction", async () => {
  expect(await ourOrder("?sortBy=createdAt&sortOrder=asc")).toEqual(["Oldest", "Middle", "Newest"]);
  expect(await ourOrder("?sortBy=subject&sortOrder=asc")).toEqual(["Middle", "Newest", "Oldest"]);
  expect(await ourOrder("?sortBy=subject&sortOrder=desc")).toEqual(["Oldest", "Newest", "Middle"]);
});

test("GET /api/tickets defaults the direction to descending", async () => {
  expect(await ourOrder("?sortBy=subject")).toEqual(["Oldest", "Newest", "Middle"]);
});

test("GET /api/tickets breaks sort ties newest first", async () => {
  // Middle and Newest are both open; Oldest is closed.
  expect(await ourOrder("?sortBy=status&sortOrder=asc")).toEqual(["Newest", "Middle", "Oldest"]);
  expect(await ourOrder("?sortBy=status&sortOrder=desc")).toEqual(["Oldest", "Newest", "Middle"]);
});

test("GET /api/tickets keeps uncategorized tickets last in both directions", async () => {
  expect(await ourOrder("?sortBy=category&sortOrder=asc")).toEqual(["Middle", "Newest", "Oldest"]);
  expect(await ourOrder("?sortBy=category&sortOrder=desc")).toEqual(["Newest", "Middle", "Oldest"]);
});

test("GET /api/tickets rejects an unknown sort column or direction", async () => {
  const cookie = await signIn(agent.email);
  for (const query of ["?sortBy=body", "?sortOrder=sideways", "?sortBy=id"]) {
    const res = await fetch(`${baseUrl}/api/tickets${query}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  }
});

const enc = encodeURIComponent;

test("GET /api/tickets filters by status", async () => {
  expect(await ourOrder(`?search=${run}&status=open`)).toEqual(["Newest", "Middle"]);
  expect(await ourOrder(`?search=${run}&status=closed`)).toEqual(["Oldest"]);
  expect(await ourOrder(`?search=${run}&status=resolved`)).toEqual([]);
});

test("GET /api/tickets filters by category, including uncategorized", async () => {
  expect(await ourOrder(`?search=${run}&category=refund_request`)).toEqual(["Newest"]);
  expect(await ourOrder(`?search=${run}&category=general_question`)).toEqual(["Middle"]);
  expect(await ourOrder(`?search=${run}&category=uncategorized`)).toEqual(["Oldest"]);

  const uncategorized = await listTickets(await signIn(agent.email), "?category=uncategorized");
  expect(uncategorized.every((t) => t.category === null)).toBe(true);
});

test("GET /api/tickets searches subject, sender email and sender name, ignoring case", async () => {
  expect(await ourOrder(`?search=${enc(`NEWEST [${run}`)}`)).toEqual(["Newest"]);
  expect(await ourOrder(`?search=${enc(`olive-${run}@example`)}`)).toEqual(["Oldest"]);
  expect(await ourOrder(`?search=${enc(`older-${run.toUpperCase()}`)}`)).toEqual(["Oldest"]);
  // Surrounding whitespace is ignored; a blank search matches everything.
  expect(await ourOrder(`?search=${enc(`  newest [${run}  `)}`)).toEqual(["Newest"]);
  const cookie = await signIn(agent.email);
  expect((await listPage(cookie, "?search=%20%20")).total).toBe((await listPage(cookie)).total);
});

test("GET /api/tickets combines filters with sorting", async () => {
  expect(await ourOrder(`?search=${run}&status=open&sortBy=subject&sortOrder=asc`)).toEqual([
    "Middle",
    "Newest",
  ]);
  expect(await ourOrder(`?search=${run}&status=open&category=uncategorized`)).toEqual([]);
});

test("GET /api/tickets rejects an unknown status or category, or an overlong search", async () => {
  const cookie = await signIn(agent.email);
  for (const query of ["?status=pending", "?category=billing", `?search=${"x".repeat(201)}`]) {
    const res = await fetch(`${baseUrl}/api/tickets${query}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  }
});

test("GET /api/tickets returns the first 25 tickets and the total by default", async () => {
  const cookie = await signIn(agent.email);
  const { tickets, total, page, pageSize } = await listPage(cookie, ours);
  expect({ total, page, pageSize }).toEqual({ total: 3, page: 1, pageSize: 25 });
  expect(tickets).toHaveLength(3);

  const all = await listPage(cookie);
  expect(all.tickets.length).toBe(Math.min(all.total, 25));
});

test("GET /api/tickets pages through the sorted, filtered list", async () => {
  const cookie = await signIn(agent.email);
  const subjects = async (query: string) => {
    const { tickets, total, page, pageSize } = await listPage(cookie, `${ours}&${query}`);
    return { subjects: tickets.map((t) => t.subject.split(" ")[0]), total, page, pageSize };
  };

  expect(await subjects("pageSize=2")).toEqual({
    subjects: ["Newest", "Middle"],
    total: 3,
    page: 1,
    pageSize: 2,
  });
  expect(await subjects("pageSize=2&page=2")).toEqual({
    subjects: ["Oldest"],
    total: 3,
    page: 2,
    pageSize: 2,
  });
  // Past the end: no tickets, but the real total so the client can step back.
  expect(await subjects("pageSize=2&page=3")).toEqual({
    subjects: [],
    total: 3,
    page: 3,
    pageSize: 2,
  });

  // Pages follow the requested sort and filters.
  expect((await subjects("pageSize=1&page=1&sortBy=subject&sortOrder=asc")).subjects).toEqual([
    "Middle",
  ]);
  expect((await subjects("pageSize=1&page=2&status=open")).subjects).toEqual(["Middle"]);
  expect((await subjects("pageSize=1&status=open")).total).toBe(2);
});

test("GET /api/tickets rejects an invalid page or page size", async () => {
  const cookie = await signIn(agent.email);
  for (const query of [
    "?page=0",
    "?page=-1",
    "?page=1.5",
    "?page=abc",
    "?pageSize=0",
    "?pageSize=101",
    "?pageSize=ten",
  ]) {
    const res = await fetch(`${baseUrl}/api/tickets${query}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  }
});

test("GET /api/tickets/:id without a session returns 401", async () => {
  const res = await fetch(`${baseUrl}/api/tickets/anything`);
  expect(res.status).toBe(401);
});

test("GET /api/tickets/:id returns the ticket with its body", async () => {
  const cookie = await signIn(agent.email);
  const stored = await prisma.ticket.findFirstOrThrow({ where: { subject: `Oldest [${run}]` } });
  const res = await fetch(`${baseUrl}/api/tickets/${stored.id}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ticket: {
      id: stored.id,
      subject: `Oldest [${run}]`,
      body: "Body",
      fromEmail: `olive-${run}@example.com`,
      fromName: `Olive Older-${run}`,
      status: TicketStatus.closed,
      category: null,
      assignedTo: null,
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: stored.updatedAt.toISOString(),
    },
  });
});

test("GET /api/tickets/:id returns 404 for an unknown ticket", async () => {
  const res = await fetch(`${baseUrl}/api/tickets/no-such-ticket`, {
    headers: { Cookie: await signIn(admin.email) },
  });
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Ticket not found" });
});

test("GET /api/tickets/assignees lists active users only, by name", async () => {
  const res = await fetch(`${baseUrl}/api/tickets/assignees`, {
    headers: { Cookie: await signIn(agent.email) },
  });
  expect(res.status).toBe(200);
  const { users } = (await res.json()) as { users: { id: string; name: string; email: string }[] };
  const ours = users.filter((u) => u.email.includes(run));
  expect(ours).toEqual([
    { id: userIds.admin, name: admin.name, email: admin.email },
    { id: userIds.agent, name: agent.name, email: agent.email },
  ]);
});

test("GET /api/tickets/assignees without a session returns 401", async () => {
  expect((await fetch(`${baseUrl}/api/tickets/assignees`)).status).toBe(401);
});

function patchTicket(ticketId: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function middleTicket() {
  return prisma.ticket.findFirstOrThrow({ where: { subject: `Middle [${run}]` } });
}

test("PATCH /api/tickets/:id without a session returns 401", async () => {
  const ticket = await middleTicket();
  expect((await patchTicket(ticket.id, { assignedToId: null })).status).toBe(401);
});

test("PATCH /api/tickets/:id lets an agent assign and unassign a ticket", async () => {
  const cookie = await signIn(agent.email);
  const ticket = await middleTicket();

  const assigned = await patchTicket(ticket.id, { assignedToId: userIds.admin }, cookie);
  expect(assigned.status).toBe(200);
  expect(((await assigned.json()) as { ticket: unknown }).ticket).toMatchObject({
    id: ticket.id,
    body: "Body",
    assignedTo: { id: userIds.admin, name: admin.name },
  });
  const detail = await fetch(`${baseUrl}/api/tickets/${ticket.id}`, { headers: { Cookie: cookie } });
  expect(((await detail.json()) as { ticket: unknown }).ticket).toMatchObject({
    assignedTo: { id: userIds.admin, name: admin.name },
  });

  const unassigned = await patchTicket(ticket.id, { assignedToId: null }, cookie);
  expect(unassigned.status).toBe(200);
  expect(((await unassigned.json()) as { ticket: unknown }).ticket).toMatchObject({
    assignedTo: null,
  });
  expect((await middleTicket()).assignedToId).toBeNull();
});

test("PATCH /api/tickets/:id rejects a banned, deleted or unknown assignee", async () => {
  const cookie = await signIn(agent.email);
  const ticket = await middleTicket();
  for (const assignedToId of [userIds.banned, userIds.deleted, "no-such-user"]) {
    const res = await patchTicket(ticket.id, { assignedToId }, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Assignee must be an active user" });
  }
  expect((await middleTicket()).assignedToId).toBeNull();
});

test("PATCH /api/tickets/:id rejects an invalid body", async () => {
  const cookie = await signIn(agent.email);
  const ticket = await middleTicket();
  for (const body of [{}, { assignedToId: 42 }, { assignedToId: "" }]) {
    const res = await patchTicket(ticket.id, body, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  }
});

test("PATCH /api/tickets/:id returns 404 for an unknown ticket", async () => {
  const res = await patchTicket(
    "no-such-ticket",
    { assignedToId: userIds.agent },
    await signIn(agent.email),
  );
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Ticket not found" });
});

test("PATCH /api/tickets/:id lets an admin assign, and changes nothing but the assignee", async () => {
  const cookie = await signIn(admin.email);
  const before = await prisma.ticket.findFirstOrThrow({ where: { subject: `Newest [${run}]` } });

  // Fields other than `assignedToId` are ignored.
  const res = await patchTicket(
    before.id,
    { assignedToId: userIds.agent, status: TicketStatus.closed, subject: "Changed" },
    cookie,
  );
  expect(res.status).toBe(200);

  const after = await prisma.ticket.findUniqueOrThrow({ where: { id: before.id } });
  expect(after).toEqual({ ...before, assignedToId: userIds.agent, updatedAt: after.updatedAt });

  await patchTicket(before.id, { assignedToId: null }, cookie);
});
