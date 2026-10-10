import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { auth } from "../auth.ts";
import { prisma } from "../db.ts";
import { Role, TicketCategory } from "../generated/prisma/enums.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

const run = crypto.randomUUID();
const admin = { email: `tickets-admin-${run}@example.com`, name: "Tickets Admin" };
const agent = { email: `tickets-agent-${run}@example.com`, name: "Tickets Agent" };
const password = "correct-horse-battery";

// Created out of order on purpose; `createdAt` decides the expected order.
const seeded = [
  { subject: `Middle [${run}]`, createdAt: new Date("2026-05-02T10:00:00Z") },
  { subject: `Oldest [${run}]`, createdAt: new Date("2026-05-01T10:00:00Z") },
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
      ...t,
      body: "Body",
      fromEmail: "student@example.com",
      fromName: "Sam Student",
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

async function listTickets(cookie: string) {
  const res = await fetch(`${baseUrl}/api/tickets`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const { tickets } = (await res.json()) as { tickets: ListedTicket[] };
  return tickets;
}

test("GET /api/tickets without a session returns 401", async () => {
  const res = await fetch(`${baseUrl}/api/tickets`);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("GET /api/tickets lists tickets newest first", async () => {
  const tickets = await listTickets(await signIn(agent.email));

  const ours = tickets.filter((t) => t.subject.includes(run)).map((t) => t.subject);
  expect(ours).toEqual([`Newest [${run}]`, `Middle [${run}]`, `Oldest [${run}]`]);

  // The whole list is ordered, not just these tickets.
  const times = tickets.map((t) => Date.parse(t.createdAt));
  expect(times).toEqual([...times].sort((a, b) => b - a));
});

test("GET /api/tickets returns list fields only (no body)", async () => {
  const tickets = await listTickets(await signIn(agent.email));
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
  const tickets = await listTickets(await signIn(agent.email));
  const oldest = tickets.find((t) => t.subject === `Oldest [${run}]`)!;
  expect(oldest.category).toBeNull();
});

test("GET /api/tickets is available to admins too", async () => {
  const tickets = await listTickets(await signIn(admin.email));
  expect(tickets.some((t) => t.subject === `Oldest [${run}]`)).toBe(true);
});
