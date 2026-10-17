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
const password = "correct-horse-battery";

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

  await auth.api.createUser({ body: { ...admin, password, role: Role.admin } });
  await auth.api.createUser({ body: { ...agent, password } });
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
  await prisma.user.deleteMany({ where: { email: { in: [admin.email, agent.email] } } });
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
