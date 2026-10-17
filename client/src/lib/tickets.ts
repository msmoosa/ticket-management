export type TicketStatus = "open" | "resolved" | "closed";

export type TicketCategory = "general_question" | "technical_question" | "refund_request";

// A ticket as returned by GET /api/tickets.
export type TicketSummary = {
  id: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  status: TicketStatus;
  /** Null until the ticket is classified. */
  category: TicketCategory | null;
  /** When the sender started waiting for an answer; null once an agent has replied. */
  awaitingReplySince: string | null;
  createdAt: string;
};

// A user a ticket can be assigned to, as returned by GET /api/tickets/assignees.
export type Assignee = { id: string; name: string; email: string };

// A ticket as returned by GET /api/tickets/:id (and PATCH): the summary plus its plain-text body.
export type Ticket = TicketSummary & {
  body: string;
  /** Null while unassigned. */
  assignedTo: { id: string; name: string } | null;
  updatedAt: string;
};

// Body of PATCH /api/tickets/:id: any of these (fields left out are kept).
// `assignedToId: null` unassigns; `category: null` makes the ticket uncategorized.
export type TicketUpdate = {
  assignedToId?: string | null;
  status?: TicketStatus;
  category?: TicketCategory | null;
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  closed: "Closed",
};

export const ticketCategoryLabel: Record<TicketCategory, string> = {
  general_question: "General question",
  technical_question: "Technical",
  refund_request: "Refund",
};

export const ticketStatuses = Object.keys(ticketStatusLabel) as TicketStatus[];
export const ticketCategories = Object.keys(ticketCategoryLabel) as TicketCategory[];

/** Category filter value; `uncategorized` matches tickets with a null category. */
export type TicketCategoryFilter = TicketCategory | "uncategorized";

// Query params accepted by GET /api/tickets.
export type TicketListParams = {
  sortBy: "waiting" | "subject" | "fromEmail" | "category" | "status" | "createdAt";
  sortOrder: "asc" | "desc";
  status?: TicketStatus;
  category?: TicketCategoryFilter;
  search?: string;
  /** 1-based. */
  page: number;
  pageSize: number;
};

export const ticketPageSizes = [10, 25, 50, 100] as const;
export const defaultTicketPageSize = 25;

// Response of GET /api/tickets: one page, plus the number of tickets matching the filters.
export type TicketListResponse = {
  tickets: TicketSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// A message in a ticket's thread, as returned by GET /api/tickets/:id/replies (oldest first)
// and POST /api/tickets/:id/replies (always an agent reply).
export type TicketReply = {
  id: string;
  /** `customer` replies were emailed in by the ticket's sender (`fromName` / `fromEmail`). */
  sender: "agent" | "customer";
  body: string;
  /** The agent who wrote it: null for customer replies, or if the agent's account was removed. */
  author: { id: string; name: string } | null;
  createdAt: string;
};

/** Longest reply the server accepts. */
export const maxReplyLength = 10_000;

// Response of GET /api/tickets/stats, for the dashboard.
export type TicketStats = {
  status: Record<TicketStatus, number>;
  category: Record<TicketCategoryFilter, number>;
  /** Open tickets whose sender has waited a day or more. */
  waitingOverDay: number;
  /** Tickets received per day in `tz`, oldest first, ending today; days with none included. */
  perDay: { date: string; count: number }[];
  days: number;
  tz: string;
};
