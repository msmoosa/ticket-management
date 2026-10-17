import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Ticket } from "@/lib/tickets";
import TicketDetail from "./TicketDetail.tsx";

const ticket: Ticket = {
  id: "t1",
  subject: "Course video won't play",
  body: "Hi,\n\nThe lesson 3 video shows a black screen.",
  fromEmail: "sam@example.com",
  fromName: "Sam Student",
  status: "open",
  category: null,
  assignedTo: null,
  createdAt: "2026-05-02T09:15:00.000Z",
  updatedAt: "2026-05-02T10:00:00.000Z",
};

describe("TicketDetail", () => {
  test("shows the subject, sender, received date and message", () => {
    render(<TicketDetail ticket={ticket} />);

    expect(screen.getByRole("heading", { name: "Course video won't play" })).toBeInTheDocument();
    expect(screen.getByText("Sam Student")).toBeInTheDocument();
    expect(screen.getByText("<sam@example.com>")).toBeInTheDocument();
    const received = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ticket.createdAt));
    expect(screen.getByText(received)).toBeInTheDocument();
    expect(screen.getByText(/The lesson 3 video shows a black screen/)).toBeInTheDocument();
  });

  test("shows just the email for a sender without a name", () => {
    render(<TicketDetail ticket={{ ...ticket, fromName: null }} />);
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
  });

  test("renders its children between the sender details and the message", () => {
    render(
      <TicketDetail ticket={ticket}>
        <p>Properties panel</p>
      </TicketDetail>,
    );
    const panel = screen.getByText("Properties panel");
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByText("Received"), panel)).toBe(true);
    expect(follows(panel, screen.getByText(/The lesson 3 video/))).toBe(true);
  });
});
