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

const ticketDetailSelect = {
  id: true,
  subject: true,
  body: true,
  fromEmail: true,
  fromName: true,
  status: true,
  category: true,
  assignedTo: { select: { id: true, name: true } },
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

  const reply = await prisma.ticketReply.create({
    data: { ticketId: req.params.id, authorId: res.locals.user.id, body: parsed.data.body },
    select: replySelect,
  });
  res.status(201).json({ reply });
});
