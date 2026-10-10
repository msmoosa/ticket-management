import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import type { TicketSummary } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import TicketsPage from "./TicketsPage.tsx";

// Newest first, as the server sends them.
const tickets: TicketSummary[] = [
  {
    id: "t3",
    subject: "Refund for double charge",
    fromEmail: "parent@example.com",
    fromName: null,
    status: "open",
    category: "refund_request",
    createdAt: "2026-05-03T14:30:00.000Z",
  },
  {
    id: "t2",
    subject: "Course video won't play",
    fromEmail: "sam@example.com",
    fromName: "Sam Student",
    status: "resolved",
    category: "technical_question",
    createdAt: "2026-05-02T09:15:00.000Z",
  },
  {
    id: "t1",
    subject: "Old question",
    fromEmail: "old@example.com",
    fromName: "Olivia Old",
    status: "closed",
    category: null,
    createdAt: "2026-05-01T08:00:00.000Z",
  },
];

function mockTickets(response: Parameters<typeof HttpResponse.json>[0], status = 200) {
  server.use(http.get("/api/tickets", () => HttpResponse.json(response, { status })));
}

const formatReceived = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]!).getAllByRole("row");

describe("TicketsPage", () => {
  test("shows skeleton rows while loading", async () => {
    mockTickets({ tickets });
    renderWithQuery(<TicketsPage />);

    expect(screen.getByRole("heading", { name: "Tickets", level: 1 })).toBeInTheDocument();
    const body = screen.getAllByRole("rowgroup")[1]!;
    expect(body).toHaveAttribute("aria-busy", "true");
    const placeholders = within(body).getAllByRole("row");
    expect(placeholders).toHaveLength(5);
    // One placeholder per column, so the layout doesn't jump when data arrives.
    for (const row of placeholders) expect(within(row).getAllByRole("cell")).toHaveLength(5);
    expect(screen.queryByText("No tickets yet.")).not.toBeInTheDocument();

    await screen.findByText("Refund for double charge");
    expect(body).toHaveAttribute("aria-busy", "false");
  });

  test("lists tickets newest first, in the order the server returns them", async () => {
    mockTickets({ tickets });
    renderWithQuery(<TicketsPage />);

    await screen.findByText("Refund for double charge");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Subject",
      "From",
      "Category",
      "Status",
      "Received",
    ]);
    expect(bodyRows().map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual([
      "Refund for double charge",
      "Course video won't play",
      "Old question",
    ]);
  });

  test("shows sender, status and received time for each ticket", async () => {
    mockTickets({ tickets });
    renderWithQuery(<TicketsPage />);

    const named = within(await screen.findByRole("row", { name: /Course video/ }));
    expect(named.getByText("Sam Student")).toBeInTheDocument();
    expect(named.getByText("sam@example.com")).toBeInTheDocument();
    expect(named.getByText("Resolved")).toBeInTheDocument();
    expect(named.getByText(formatReceived(tickets[1]!.createdAt))).toBeInTheDocument();

    // Without a name, the email address stands alone.
    const unnamed = within(screen.getByRole("row", { name: /Refund/ }));
    expect(unnamed.getByText("parent@example.com")).toBeInTheDocument();
    expect(unnamed.getByText("Open")).toBeInTheDocument();

    expect(within(screen.getByRole("row", { name: /Old question/ })).getByText("Closed"))
      .toBeInTheDocument();
  });

  test("shows each ticket's category, or Uncategorized", async () => {
    mockTickets({
      tickets: [
        ...tickets,
        {
          ...tickets[2]!,
          id: "t0",
          subject: "General enquiry",
          category: "general_question",
        },
      ],
    });
    renderWithQuery(<TicketsPage />);

    const category = (subject: RegExp) =>
      within(screen.getByRole("row", { name: subject })).getAllByRole("cell")[2]!;

    await screen.findByText("Refund for double charge");
    expect(category(/Refund for double charge/)).toHaveTextContent("Refund");
    expect(category(/Course video/)).toHaveTextContent("Technical");
    expect(category(/General enquiry/)).toHaveTextContent("General question");
    expect(category(/Old question/)).toHaveTextContent("Uncategorized");
  });

  test("shows an empty state when there are no tickets", async () => {
    mockTickets({ tickets: [] });
    renderWithQuery(<TicketsPage />);

    expect(await screen.findByText("No tickets yet.")).toBeInTheDocument();
  });

  test("shows the server's error message", async () => {
    mockTickets({ error: "Unauthorized" }, 401);
    renderWithQuery(<TicketsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("falls back to a generic message on a network error", async () => {
    server.use(http.get("/api/tickets", () => HttpResponse.error()));
    renderWithQuery(<TicketsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load tickets");
  });
});
