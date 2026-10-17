import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test } from "vitest";
import type { Assignee, Ticket } from "@/lib/tickets";
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
  assignedTo: null,
  createdAt: "2026-05-02T09:15:00.000Z",
  updatedAt: "2026-05-02T10:00:00.000Z",
};

const assignees: Assignee[] = [
  { id: "u1", name: "Ada Admin", email: "ada@example.com" },
  { id: "u2", name: "Alex Agent", email: "alex@example.com" },
];

function mockTicket(response: Parameters<typeof HttpResponse.json>[0], status = 200) {
  server.use(
    http.get("/api/tickets/t1", () => HttpResponse.json(response, { status })),
    http.get("/api/tickets/assignees", () => HttpResponse.json({ users: assignees })),
  );
}

// Records each PATCH /api/tickets/t1 body and answers with the ticket as it would be saved.
function recordAssignments() {
  const bodies: unknown[] = [];
  server.use(
    http.patch("/api/tickets/t1", async ({ request }) => {
      const body = (await request.json()) as { assignedToId: string | null };
      bodies.push(body);
      const user = assignees.find((u) => u.id === body.assignedToId);
      return HttpResponse.json({
        ticket: { ...ticket, assignedTo: user ? { id: user.id, name: user.name } : null },
      });
    }),
  );
  return bodies;
}

const assigneeSelect = () => screen.getByRole("combobox", { name: "Assigned to" });

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

  describe("assigning", () => {
    test("shows Unassigned for an unassigned ticket", async () => {
      mockTicket({ ticket });
      renderPage();
      await screen.findByRole("heading", { name: "Course video won't play" });
      await waitFor(() => expect(assigneeSelect()).toBeEnabled());
      expect(assigneeSelect()).toHaveTextContent("Unassigned");
    });

    test("shows the current assignee", async () => {
      mockTicket({ ticket: { ...ticket, assignedTo: { id: "u2", name: "Alex Agent" } } });
      renderPage();
      await waitFor(() => expect(assigneeSelect()).toHaveTextContent("Alex Agent"));
    });

    test("assigns the ticket to the chosen user, then unassigns it", async () => {
      const user = userEvent.setup();
      mockTicket({ ticket });
      const bodies = recordAssignments();
      renderPage();
      await waitFor(() => expect(assigneeSelect()).toBeEnabled());

      await user.click(assigneeSelect());
      await user.click(await screen.findByRole("option", { name: "Alex Agent" }));
      await waitFor(() => expect(assigneeSelect()).toHaveTextContent("Alex Agent"));
      expect(bodies).toEqual([{ assignedToId: "u2" }]);

      await waitFor(() => expect(assigneeSelect()).toBeEnabled());
      await user.click(assigneeSelect());
      await user.click(await screen.findByRole("option", { name: "Unassigned" }));
      await waitFor(() => expect(assigneeSelect()).toHaveTextContent("Unassigned"));
      expect(bodies).toEqual([{ assignedToId: "u2" }, { assignedToId: null }]);
    });

    test("shows the server's error when assigning fails, keeping the old assignee", async () => {
      const user = userEvent.setup();
      mockTicket({ ticket });
      server.use(
        http.patch("/api/tickets/t1", () =>
          HttpResponse.json({ error: "Assignee must be an active user" }, { status: 400 }),
        ),
      );
      renderPage();
      await waitFor(() => expect(assigneeSelect()).toBeEnabled());

      await user.click(assigneeSelect());
      await user.click(await screen.findByRole("option", { name: "Ada Admin" }));
      expect(await screen.findByText("Assignee must be an active user")).toBeInTheDocument();
      expect(assigneeSelect()).toHaveTextContent("Unassigned");
    });

    test("shows an error when the assignee list fails to load", async () => {
      mockTicket({ ticket });
      server.use(
        http.get("/api/tickets/assignees", () =>
          HttpResponse.json({ error: "Server error" }, { status: 500 }),
        ),
      );
      renderPage();
      expect(await screen.findByText("Server error")).toBeInTheDocument();
      expect(assigneeSelect()).toBeDisabled();
    });
  });

  test("shows the new status and category after they are saved", async () => {
    const user = userEvent.setup();
    mockTicket({ ticket });
    // Applies each save to the stored ticket, as the server does.
    let saved = ticket;
    server.use(
      http.patch("/api/tickets/t1", async ({ request }) => {
        saved = { ...saved, ...((await request.json()) as Partial<Ticket>) };
        return HttpResponse.json({ ticket: saved });
      }),
    );
    renderPage();
    const status = await screen.findByRole("combobox", { name: "Status" });

    await user.click(status);
    await user.click(await screen.findByRole("option", { name: "Closed" }));
    await waitFor(() => expect(status).toHaveTextContent("Closed"));

    const category = screen.getByRole("combobox", { name: "Category" });
    await waitFor(() => expect(category).toBeEnabled());
    await user.click(category);
    await user.click(await screen.findByRole("option", { name: "Uncategorized" }));
    await waitFor(() => expect(category).toHaveTextContent("Uncategorized"));
    expect(status).toHaveTextContent("Closed");
  });

  test("groups the editable fields in a side panel, apart from the message", async () => {
    mockTicket({ ticket });
    renderPage();
    const panel = within(await screen.findByRole("complementary", { name: "Ticket properties" }));

    for (const name of ["Status", "Category", "Assigned to"]) {
      expect(panel.getByRole("combobox", { name })).toBeInTheDocument();
    }
    expect(panel.queryByText(/The lesson 3 video shows a black screen/)).not.toBeInTheDocument();
    expect(panel.queryByText("Sam Student")).not.toBeInTheDocument();
  });
});
