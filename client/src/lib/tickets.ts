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

// Body of PATCH /api/tickets/:id; `assignedToId: null` unassigns.
export type TicketUpdate = { assignedToId: string | null };

export const ticketStatusLabel: Record<TicketStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  closed: "Closed",
};

// Badge variant for each status, shared by the list and detail pages.
export const ticketStatusVariant: Record<TicketStatus, "default" | "secondary" | "outline"> = {
  open: "default",
  resolved: "secondary",
  closed: "outline",
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
  sortBy: "subject" | "fromEmail" | "category" | "status" | "createdAt";
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
