import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { TicketCategory, TicketStatus } from "../generated/prisma/enums.ts";
import { requireAuth } from "../middleware/auth.ts";
import { HttpError } from "../middleware/error-handler.ts";

export const ticketsRouter = Router();

// Columns the list can be sorted by. Enums (`status`, `category`) sort in declaration order.
export const ticketSortFields = ["subject", "fromEmail", "category", "status", "createdAt"] as const;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

const listQuerySchema = z.object({
  sortBy: z.enum(ticketSortFields).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(TicketStatus).optional(),
  // `uncategorized` matches tickets that haven't been classified yet (null category).
  category: z.enum({ ...TicketCategory, uncategorized: "uncategorized" }).optional(),
  // Case-insensitive substring match on subject, sender email and sender name.
  search: z
    .string()
    .trim()
    .max(200, "Search must be at most 200 characters")
    .optional()
    .transform((value) => value || undefined),
  // 1-based. A page past the end returns no tickets (with the real `total`), not an error.
  page: z.coerce.number().int().min(1, "Page must be at least 1").default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, "Page size must be at least 1")
    .max(MAX_PAGE_SIZE, `Page size must be at most ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
});

function parseListQuery(query: unknown) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid query");
  }
  return parsed.data;
}

function listWhere({
  status,
  category,
  search,
}: ReturnType<typeof parseListQuery>): Prisma.TicketWhereInput {
  return {
    status,
    category: category === "uncategorized" ? null : category,
    OR: search
      ? [
          { subject: { contains: search, mode: "insensitive" } },
          { fromEmail: { contains: search, mode: "insensitive" } },
          { fromName: { contains: search, mode: "insensitive" } },
        ]
      : undefined,
  };
}

// Every signed-in user (agents and admins) works tickets. Filters combine with AND.
// Defaults to newest first; ties fall back to newest first, then `id`, so the order is stable
// and pages don't overlap. `total` counts every ticket matching the filters, across all pages.
ticketsRouter.get("/", requireAuth, async (req, res) => {
  const query = parseListQuery(req.query);
  const { sortBy, sortOrder, page, pageSize } = query;
  const where = listWhere(query);

  const orderBy: Prisma.TicketOrderByWithRelationInput[] = [
    // Uncategorized tickets go last in either direction.
    sortBy === "category"
      ? { category: { sort: sortOrder, nulls: "last" } }
      : { [sortBy]: sortOrder },
  ];
  if (sortBy !== "createdAt") orderBy.push({ createdAt: "desc" });
  orderBy.push({ id: "desc" });

  const [tickets, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      select: {
        id: true,
        subject: true,
        fromEmail: true,
        fromName: true,
        status: true,
        category: true,
        awaitingReplySince: true,
        createdAt: true,
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);
  res.json({ tickets, total, page, pageSize });
});

// People a ticket can be assigned to: every active user (agents and admins both work tickets).
const activeUserWhere: Prisma.UserWhereInput = { deletedAt: null, banned: { not: true } };

// Declared before `/:id` so "assignees" isn't read as a ticket id.
ticketsRouter.get("/assignees", requireAuth, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: activeUserWhere,
    select: { id: true, name: true, email: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  res.json({ users });
});

export const DEFAULT_STATS_DAYS = 30;
export const MAX_STATS_DAYS = 90;

const statsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1, "Days must be at least 1")
    .max(MAX_STATS_DAYS, `Days must be at most ${MAX_STATS_DAYS}`)
    .default(DEFAULT_STATS_DAYS),
  // IANA time zone the per-day counts are bucketed in (the viewer's), so "today" is their today.
  tz: z
    .string()
    .default("UTC")
    .refine(isTimeZone, "Unknown time zone"),
});

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of the calendar date `days` before the YYYY-MM-DD `day`. */
function daysBefore(day: string, days: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - days)).toISOString().slice(0, 10);
}

// Tickets received per day in `tz` for the last `days` days, oldest first, ending today. Days
// are bucketed here with `Intl` rather than in SQL: Postgres doesn't know every zone name a
// browser reports (e.g. the legacy "Asia/Calcutta").
async function ticketsPerDay(days: number, tz: string) {
  // en-CA formats dates as YYYY-MM-DD.
  const dayOf = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const now = new Date();
  const today = dayOf.format(now);
  const counts = new Map(
    Array.from({ length: days }, (_, i) => [daysBefore(today, days - 1 - i), 0]),
  );

  // The first day started less than `days` days (plus a DST hour) ago in any zone.
  const tickets = await prisma.ticket.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - (days + 1) * DAY_MS) } },
    select: { createdAt: true },
  });
  for (const { createdAt } of tickets) {
    const day = dayOf.format(createdAt);
    const count = counts.get(day);
    if (count !== undefined) counts.set(day, count + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count }));
}

// Numbers for the dashboard: tickets per status and category, open tickets whose sender has
// waited a day or more, and tickets received per day for the last `days` days (oldest first,
// including days with none). Declared before `/:id`.
ticketsRouter.get("/stats", requireAuth, async (req, res) => {
  const parsed = statsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid query");
  }
  const { days, tz } = parsed.data;

  const [byStatus, byCategory, waitingOverDay, perDay] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.ticket.count({
      where: {
        status: TicketStatus.open,
        awaitingReplySince: { lte: new Date(Date.now() - DAY_MS) },
      },
    }),
    ticketsPerDay(days, tz),
  ]);

  const status = Object.fromEntries(Object.values(TicketStatus).map((s) => [s, 0])) as Record<
    TicketStatus,
    number
  >;
  for (const row of byStatus) status[row.status] = row._count._all;

  const category = Object.fromEntries(
    [...Object.values(TicketCategory), "uncategorized"].map((c) => [c, 0]),
  ) as Record<TicketCategory | "uncategorized", number>;
  for (const row of byCategory) category[row.category ?? "uncategorized"] = row._count._all;

  res.json({ status, category, waitingOverDay, perDay, days, tz });
});

const ticketDetailSelect = {
  id: true,
  subject: true,
  body: true,
  fromEmail: true,
  fromName: true,
  status: true,
  category: true,
  assignedTo: { select: { id: true, name: true } },
  awaitingReplySince: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TicketSelect;

// One ticket with its full body, for the detail page. Any signed-in user.
ticketsRouter.get<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    select: ticketDetailSelect,
  });
  if (!ticket) throw new HttpError(404, "Ticket not found");
  res.json({ ticket });
});

const updateTicketSchema = z
  .object({
    // A user id from GET /api/tickets/assignees, or null to unassign.
    assignedToId: z.string().min(1).nullable().optional(),
    status: z.enum(TicketStatus).optional(),
    // Null puts the ticket back to uncategorized.
    category: z.enum(TicketCategory).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Nothing to update",
  });

// Any signed-in user can change a ticket's status, category or assignee (any active user, or
// unassigned). Fields left out are kept.
ticketsRouter.patch<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const parsed = updateTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  const { assignedToId, status, category } = parsed.data;

  if (assignedToId) {
    const assignee = await prisma.user.findFirst({
      where: { id: assignedToId, ...activeUserWhere },
      select: { id: true },
    });
    if (!assignee) throw new HttpError(400, "Assignee must be an active user");
  }

  const { count } = await prisma.ticket.updateMany({
    where: { id: req.params.id },
    data: { assignedToId, status, category },
  });
  if (count === 0) throw new HttpError(404, "Ticket not found");

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: req.params.id },
    select: ticketDetailSelect,
  });
  res.json({ ticket });
});

const replySelect = {
  id: true,
  // `customer` replies were emailed in by the ticket's sender and have no author.
  sender: true,
  body: true,
  author: { select: { id: true, name: true } },
  createdAt: true,
} satisfies Prisma.TicketReplySelect;

async function assertTicketExists(id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true } });
  if (!ticket) throw new HttpError(404, "Ticket not found");
}

// A ticket's reply thread, oldest first. Any signed-in user.
ticketsRouter.get<{ id: string }>("/:id/replies", requireAuth, async (req, res) => {
  await assertTicketExists(req.params.id);
  const replies = await prisma.ticketReply.findMany({
    where: { ticketId: req.params.id },
    select: replySelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  res.json({ replies });
});

export const MAX_REPLY_LENGTH = 10_000;

const createReplySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Reply can't be empty")
    .max(MAX_REPLY_LENGTH, `Reply must be at most ${MAX_REPLY_LENGTH} characters`),
});

// Any signed-in user can reply to any ticket; the reply is authored by them. Replies are only
// stored for now: they aren't emailed to the sender until outbound email lands.
ticketsRouter.post<{ id: string }>("/:id/replies", requireAuth, async (req, res) => {
  const parsed = createReplySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  await assertTicketExists(req.params.id);

  const [reply] = await prisma.$transaction([
    prisma.ticketReply.create({
      data: { ticketId: req.params.id, authorId: res.locals.user.id, body: parsed.data.body },
      select: replySelect,
    }),
    // The sender has an answer, so they're no longer waiting.
    prisma.ticket.update({ where: { id: req.params.id }, data: { awaitingReplySince: null } }),
  ]);
  res.status(201).json({ reply });
});
