import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { auth } from "../auth.ts";
import { prisma } from "../db.ts";
import { TicketCategory, TicketStatus } from "../generated/prisma/enums.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;
let cookie: string;

const run = crypto.randomUUID();
const agent = { email: `stats-agent-${run}@example.com`, name: "Stats Agent" };
const password = "correct-horse-battery";

const HOUR = 60 * 60 * 1000;

type Stats = {
  status: Record<string, number>;
  category: Record<string, number>;
  waitingOverDay: number;
  perDay: { date: string; count: number }[];
  days: number;
  tz: string;
};

// Other tests' tickets share the database, so tests compare the stats before and after adding
// this run's tickets.
async function stats(query = "") {
  const res = await fetch(`${baseUrl}/api/tickets/stats${query}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as Stats;
}

type NewTicket = {
  createdAt?: Date;
  status?: TicketStatus;
  category?: TicketCategory;
  awaitingReplySince?: Date | null;
};

async function addTickets(tickets: NewTicket[]) {
  await prisma.ticket.createMany({
    data: tickets.map((t, i) => ({
      subject: `Stats ${i} [${run}]`,
      body: "Body",
      fromEmail: "student@example.com",
      ...t,
    })),
  });
}

/** `date` as YYYY-MM-DD in `timeZone`. */
function localDay(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

function countOn(s: Stats, day: string) {
  return s.perDay.find((d) => d.date === day)?.count;
}

beforeAll(async () => {
  server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;

  await auth.api.createUser({ body: { ...agent, password } });
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    },
    body: JSON.stringify({ email: agent.email, password }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers
    .getSetCookie()
    .find((c) => c.includes("better-auth.session_token="))!
    .split(";")[0]!;
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { subject: { contains: run } } });
  await prisma.user.deleteMany({ where: { email: agent.email } });
  server.close();
});

test("GET /api/tickets/stats without a session returns 401", async () => {
  const res = await fetch(`${baseUrl}/api/tickets/stats`);
  expect(res.status).toBe(401);
});

test("GET /api/tickets/stats returns one entry per day, oldest first, ending today", async () => {
  const s = await stats();
  expect(s.days).toBe(30);
  expect(s.tz).toBe("UTC");
  expect(s.perDay).toHaveLength(30);
  expect(s.perDay.at(-1)!.date).toBe(localDay(new Date(), "UTC"));
  const dates = s.perDay.map((d) => d.date);
  expect(dates).toEqual([...dates].sort());

  expect((await stats("?days=7")).perDay).toHaveLength(7);
});

test("GET /api/tickets/stats counts tickets by status, category and day", async () => {
  const before = await stats();
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * HOUR);
  await addTickets([
    { createdAt: now, category: TicketCategory.refund_request },
    { createdAt: now, status: TicketStatus.resolved, awaitingReplySince: null },
    { createdAt: twoDaysAgo, status: TicketStatus.closed, category: TicketCategory.refund_request },
  ]);
  const after = await stats();

  expect(after.status.open! - before.status.open!).toBe(1);
  expect(after.status.resolved! - before.status.resolved!).toBe(1);
  expect(after.status.closed! - before.status.closed!).toBe(1);
  expect(after.category.refund_request! - before.category.refund_request!).toBe(2);
  expect(after.category.uncategorized! - before.category.uncategorized!).toBe(1);

  const today = localDay(now, "UTC");
  const earlier = localDay(twoDaysAgo, "UTC");
  expect(countOn(after, today)! - countOn(before, today)!).toBe(2);
  expect(countOn(after, earlier)! - countOn(before, earlier)!).toBe(1);
});

test("GET /api/tickets/stats counts open tickets waiting a day or more", async () => {
  const before = await stats();
  const longAgo = new Date(Date.now() - 30 * HOUR);
  await addTickets([
    { createdAt: longAgo, awaitingReplySince: longAgo },
    // Waiting just as long, but no longer open, or answered.
    { createdAt: longAgo, awaitingReplySince: longAgo, status: TicketStatus.resolved },
    { createdAt: longAgo, awaitingReplySince: null },
    // Open, but waiting under a day.
    { awaitingReplySince: new Date(Date.now() - 2 * HOUR) },
  ]);
  const after = await stats();
  expect(after.waitingOverDay - before.waitingOverDay).toBe(1);
});

test("GET /api/tickets/stats buckets days in the requested time zone", async () => {
  // Just before midnight UTC: still yesterday in UTC, already the next day at UTC+14.
  const midnight = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const lateEvening = new Date(midnight.getTime() - 30 * 60 * 1000);
  const tz = "Pacific/Kiritimati";
  const query = `?tz=${encodeURIComponent(tz)}`;

  const [beforeUtc, beforeTz] = [await stats(), await stats(query)];
  await addTickets([{ createdAt: lateEvening }]);
  const [afterUtc, afterTz] = [await stats(), await stats(query)];

  const utcDay = localDay(lateEvening, "UTC");
  const tzDay = localDay(lateEvening, tz);
  expect(tzDay).not.toBe(utcDay);
  expect(afterTz.tz).toBe(tz);
  expect(afterTz.perDay.at(-1)!.date).toBe(localDay(new Date(), tz));
  expect(countOn(afterUtc, utcDay)! - countOn(beforeUtc, utcDay)!).toBe(1);
  expect(countOn(afterTz, tzDay)! - countOn(beforeTz, tzDay)!).toBe(1);
});

test("GET /api/tickets/stats accepts legacy zone names that browsers still report", async () => {
  // Some Postgres builds don't know "Asia/Calcutta" (now "Asia/Kolkata"); this once failed with
  // a 500 in production.
  const s = await stats(`?tz=${encodeURIComponent("Asia/Calcutta")}`);
  expect(s.perDay.at(-1)!.date).toBe(localDay(new Date(), "Asia/Kolkata"));
});

test("GET /api/tickets/stats rejects an invalid range or time zone", async () => {
  for (const query of ["?days=0", "?days=91", "?days=abc", "?tz=Mars/Olympus"]) {
    const res = await fetch(`${baseUrl}/api/tickets/stats${query}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });
  }
});
