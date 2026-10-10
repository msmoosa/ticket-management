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
