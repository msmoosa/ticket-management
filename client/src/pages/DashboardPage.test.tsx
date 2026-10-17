import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import type { TicketStats, TicketSummary } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import DashboardPage from "./DashboardPage.tsx";

const stats: TicketStats = {
  status: { open: 12, resolved: 30, closed: 8 },
  category: { general_question: 20, technical_question: 15, refund_request: 5, uncategorized: 10 },
  waitingOverDay: 3,
  perDay: [
    { date: "2026-10-15", count: 4 },
    { date: "2026-10-16", count: 0 },
    { date: "2026-10-17", count: 2 },
  ],
  days: 30,
  tz: "UTC",
};

const recent: TicketSummary[] = [
  {
    id: "t1",
    subject: "Course video won't play",
    fromEmail: "sam@example.com",
    fromName: "Sam Student",
    status: "open",
    category: "technical_question",
    awaitingReplySince: null,
    createdAt: "2026-10-17T09:15:00.000Z",
  },
  {
    id: "t2",
    subject: "Refund please",
    fromEmail: "parent@example.com",
    fromName: null,
    status: "resolved",
    category: "refund_request",
    awaitingReplySince: null,
    createdAt: "2026-10-16T14:30:00.000Z",
  },
];

function mockStats(response: Parameters<typeof HttpResponse.json>[0], status = 200) {
  server.use(http.get("/api/tickets/stats", () => HttpResponse.json(response, { status })));
}

function mockRecent(tickets: TicketSummary[]) {
  server.use(
    http.get("/api/tickets", () =>
      HttpResponse.json({ tickets, total: tickets.length, page: 1, pageSize: 6 }),
    ),
  );
}

function renderPage() {
  return renderWithQuery(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  test("shows ticket counts that link to the filtered list", async () => {
    mockStats(stats);
    mockRecent(recent);
    renderPage();

    const open = await screen.findByRole("link", { name: /^Open 12$/ });
    expect(open).toHaveAttribute("href", "/tickets?status=open");
    expect(screen.getByRole("link", { name: /Waiting a day or more 3/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Resolved 30/ })).toHaveAttribute(
      "href",
      "/tickets?status=resolved",
    );
    expect(screen.getByRole("link", { name: /Closed 8/ })).toBeInTheDocument();

    const refunds = screen.getByRole("link", { name: /^Refund\s*5$/ });
    expect(refunds).toHaveAttribute("href", "/tickets?category=refund_request");
    expect(screen.getByRole("link", { name: /^Uncategorized\s*10$/ })).toHaveAttribute(
      "href",
      "/tickets?category=uncategorized",
    );
  });

  test("charts tickets per day, with the total and a table of every day", async () => {
    mockStats(stats);
    mockRecent(recent);
    renderPage();

    const table = await screen.findByRole("table", { name: "Tickets received per day" });
    const chart = screen.getByText("Tickets received").closest("[data-slot=card]") as HTMLElement;
    expect(within(chart).getByText("6")).toBeInTheDocument();
    expect(within(chart).getByText("2 a day on average")).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/4$/),
      expect.stringMatching(/0$/),
      "Today2",
    ]);
  });

  test("lists the newest tickets with their status", async () => {
    mockStats(stats);
    mockRecent(recent);
    renderPage();

    const list = await screen.findByRole("list", { name: "Recent tickets" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole("link", { name: "Course video won't play" })).toHaveAttribute(
      "href",
      "/tickets/t1",
    );
    expect(within(items[0]!).getByText(/Sam Student/)).toBeInTheDocument();
    expect(within(items[1]!).getByText(/parent@example.com/)).toBeInTheDocument();
    expect(within(items[1]!).getByText("Resolved")).toBeInTheDocument();
  });

  test("shows loading placeholders until the data arrives", async () => {
    mockStats(stats);
    mockRecent(recent);
    renderPage();

    expect(screen.getByRole("status", { name: "Loading ticket stats" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading recent tickets" })).toBeInTheDocument();
    await screen.findByRole("link", { name: /^Open 12$/ });
    expect(screen.queryByRole("status", { name: "Loading ticket stats" })).not.toBeInTheDocument();
  });

  test("says so when there are no tickets yet", async () => {
    mockStats(stats);
    mockRecent([]);
    renderPage();

    expect(await screen.findByText("No tickets yet.")).toBeInTheDocument();
  });

  test("shows the server's error when the stats fail to load", async () => {
    mockStats({ error: "Unknown time zone" }, 400);
    mockRecent(recent);
    renderPage();

    expect(await screen.findByText("Unknown time zone")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Open/ })).not.toBeInTheDocument();
  });
});
