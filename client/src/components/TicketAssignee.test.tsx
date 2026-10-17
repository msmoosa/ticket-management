import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import type { Assignee, Ticket } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import TicketAssignee from "./TicketAssignee.tsx";

const ticket: Ticket = {
  id: "t1",
  subject: "Course video won't play",
  body: "The video shows a black screen.",
  fromEmail: "sam@example.com",
  fromName: "Sam Student",
  status: "open",
  category: null,
  assignedTo: null,
  createdAt: "2026-05-02T09:15:00.000Z",
  updatedAt: "2026-05-02T09:15:00.000Z",
};

// In the order the server sends them (by name).
const assignees: Assignee[] = [
  { id: "u1", name: "Ada Admin", email: "ada@example.com" },
  { id: "u2", name: "Alex Agent", email: "alex@example.com" },
];

function mockAssignees(response: Parameters<typeof HttpResponse.json>[0] = { users: assignees }, status = 200) {
  server.use(http.get("/api/tickets/assignees", () => HttpResponse.json(response, { status })));
}

// Records each PATCH /api/tickets/t1 body and answers with the ticket as the server would save it.
function recordPatches() {
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

// Returns the QueryClient, since saves are written into its cache.
function renderAssignee(props: { ticket: Ticket } = { ticket }) {
  return renderWithQuery(<TicketAssignee {...props} />).queryClient;
}

const select = () => screen.getByRole("combobox", { name: "Assigned to" });

async function choose(name: string) {
  const user = userEvent.setup();
  await waitFor(() => expect(select()).toBeEnabled());
  await user.click(select());
  await user.click(await screen.findByRole("option", { name }));
}

describe("TicketAssignee", () => {
  test("is disabled until the assignees load", async () => {
    mockAssignees();
    renderAssignee();
    expect(select()).toBeDisabled();
    await waitFor(() => expect(select()).toBeEnabled());
  });

  test("offers Unassigned, then every assignee in the server's order", async () => {
    const user = userEvent.setup();
    mockAssignees();
    renderAssignee();
    await waitFor(() => expect(select()).toBeEnabled());

    await user.click(select());
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Unassigned",
      "Ada Admin",
      "Alex Agent",
    ]);
  });

  test("shows Unassigned for an unassigned ticket", async () => {
    mockAssignees();
    renderAssignee();
    await waitFor(() => expect(select()).toBeEnabled());
    expect(select()).toHaveTextContent("Unassigned");
  });

  test("shows the current assignee", async () => {
    mockAssignees();
    renderAssignee({ ticket: { ...ticket, assignedTo: { id: "u2", name: "Alex Agent" } } });
    await waitFor(() => expect(select()).toHaveTextContent("Alex Agent"));
  });

  test("keeps showing an assignee who is no longer assignable (e.g. banned)", async () => {
    const user = userEvent.setup();
    mockAssignees();
    renderAssignee({ ticket: { ...ticket, assignedTo: { id: "u9", name: "Bea Banned" } } });
    await waitFor(() => expect(select()).toBeEnabled());
    expect(select()).toHaveTextContent("Bea Banned");

    await user.click(select());
    expect(await screen.findByRole("option", { name: "Bea Banned" })).toBeInTheDocument();
  });

  test("saves the chosen assignee and writes the saved ticket into the detail cache", async () => {
    mockAssignees();
    const bodies = recordPatches();
    const queryClient = renderAssignee();

    await choose("Alex Agent");
    await waitFor(() => expect(bodies).toEqual([{ assignedToId: "u2" }]));
    await waitFor(() =>
      expect(queryClient.getQueryData<Ticket>(["tickets", "detail", "t1"])).toMatchObject({
        assignedTo: { id: "u2", name: "Alex Agent" },
      }),
    );
  });

  test("sends null when Unassigned is chosen", async () => {
    mockAssignees();
    const bodies = recordPatches();
    renderAssignee({ ticket: { ...ticket, assignedTo: { id: "u1", name: "Ada Admin" } } });

    await choose("Unassigned");
    await waitFor(() => expect(bodies).toEqual([{ assignedToId: null }]));
  });

  test("doesn't save when the current assignee is chosen again", async () => {
    mockAssignees();
    const bodies = recordPatches();
    renderAssignee({ ticket: { ...ticket, assignedTo: { id: "u1", name: "Ada Admin" } } });

    await choose("Ada Admin");
    // Give a stray request time to arrive before asserting there was none.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies).toEqual([]);
  });

  test("is disabled while saving", async () => {
    mockAssignees();
    let respond!: () => void;
    server.use(
      http.patch(
        "/api/tickets/t1",
        () =>
          new Promise<Response>((resolve) => {
            respond = () =>
              resolve(
                HttpResponse.json({
                  ticket: { ...ticket, assignedTo: { id: "u2", name: "Alex Agent" } },
                }),
              );
          }),
      ),
    );
    renderAssignee();

    await choose("Alex Agent");
    await waitFor(() => expect(select()).toBeDisabled());
    respond();
    await waitFor(() => expect(select()).toBeEnabled());
  });

  test("shows the server's error when saving fails", async () => {
    mockAssignees();
    server.use(
      http.patch("/api/tickets/t1", () =>
        HttpResponse.json({ error: "Assignee must be an active user" }, { status: 400 }),
      ),
    );
    const queryClient = renderAssignee();

    await choose("Ada Admin");
    expect(await screen.findByText("Assignee must be an active user")).toBeInTheDocument();
    expect(select()).toHaveTextContent("Unassigned");
    expect(queryClient.getQueryData(["tickets", "detail", "t1"])).toBeUndefined();
  });

  test("falls back to a generic message when saving fails without a response", async () => {
    mockAssignees();
    server.use(http.patch("/api/tickets/t1", () => HttpResponse.error()));
    renderAssignee();

    await choose("Ada Admin");
    expect(await screen.findByText("Failed to assign ticket")).toBeInTheDocument();
  });

  test("shows the server's error and stays disabled when assignees fail to load", async () => {
    mockAssignees({ error: "Forbidden" }, 403);
    renderAssignee();
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(select()).toBeDisabled();
  });

  test("falls back to a generic message when assignees fail to load without a response", async () => {
    server.use(http.get("/api/tickets/assignees", () => HttpResponse.error()));
    renderAssignee();
    expect(await screen.findByText("Failed to load assignees")).toBeInTheDocument();
  });
});
