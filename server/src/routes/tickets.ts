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
