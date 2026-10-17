import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test } from "vitest";
import type { Ticket } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import TicketDetailPage from "./TicketDetailPage.tsx";

const ticket: Ticket = {
  id: "t1",
  subject: "Course video won't play",
  body: "Hi,\n\nThe lesson 3 video shows a black screen.\n\nThanks, Sam",
  fromEmail: "sam@example.com",
  fromName: "Sam Student",
  status: "resolved",
  category: "technical_question",
  createdAt: "2026-05-02T09:15:00.000Z",
  updatedAt: "2026-05-02T10:00:00.000Z",
};

function mockTicket(response: Parameters<typeof HttpResponse.json>[0], status = 200) {
  server.use(http.get("/api/tickets/t1", () => HttpResponse.json(response, { status })));
}

function renderPage(entry: string | { pathname: string; state: unknown } = "/tickets/t1") {
  return renderWithQuery(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="tickets/:id" element={<TicketDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TicketDetailPage", () => {
  test("shows a loading state while the ticket loads", () => {
    mockTicket({ ticket });
    renderPage();
    expect(screen.getByRole("status", { name: "Loading ticket" })).toBeInTheDocument();
  });

  test("shows the ticket's subject, status, category, sender, date and body", async () => {
    mockTicket({ ticket });
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Course video won't play" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Technical")).toBeInTheDocument();
    expect(screen.getByText("Sam Student")).toBeInTheDocument();
    expect(screen.getByText("<sam@example.com>")).toBeInTheDocument();
    const received = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ticket.createdAt));
    expect(screen.getByText(received)).toBeInTheDocument();
    expect(screen.getByText(/The lesson 3 video shows a black screen/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("shows an unnamed sender's email and an uncategorized ticket", async () => {
    mockTicket({ ticket: { ...ticket, fromName: null, category: null } });
    renderPage();

    expect(await screen.findByText("sam@example.com")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });

  test("links back to the list view it came from", async () => {
    mockTicket({ ticket });
    renderPage({ pathname: "/tickets/t1", state: { from: "/tickets?status=open&page=2" } });

    expect(await screen.findByRole("link", { name: "Back to tickets" })).toHaveAttribute(
      "href",
      "/tickets?status=open&page=2",
    );
  });

  test("links back to the full list when opened directly", async () => {
    mockTicket({ ticket });
    renderPage();

    expect(await screen.findByRole("link", { name: "Back to tickets" })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });

  test("shows the server's error, e.g. for an unknown ticket", async () => {
    mockTicket({ error: "Ticket not found" }, 404);
    renderPage();

    expect(await screen.findByText("Ticket not found")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });
});
