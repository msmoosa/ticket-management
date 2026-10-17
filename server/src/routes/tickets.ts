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

const updateTicketSchema = z.object({
  // A user id from GET /api/tickets/assignees, or null to unassign.
  assignedToId: z.string().min(1).nullable(),
});

// Any signed-in user can assign a ticket to any active user, or unassign it.
ticketsRouter.patch<{ id: string }>("/:id", requireAuth, async (req, res) => {
  const parsed = updateTicketSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  const { assignedToId } = parsed.data;

  if (assignedToId !== null) {
    const assignee = await prisma.user.findFirst({
      where: { id: assignedToId, ...activeUserWhere },
      select: { id: true },
    });
    if (!assignee) throw new HttpError(400, "Assignee must be an active user");
  }

  const { count } = await prisma.ticket.updateMany({
    where: { id: req.params.id },
    data: { assignedToId },
  });
  if (count === 0) throw new HttpError(404, "Ticket not found");

  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: req.params.id },
    select: ticketDetailSelect,
  });
  res.json({ ticket });
});
