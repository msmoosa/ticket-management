import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import type { Ticket, TicketStatus } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import TicketStatusSelect from "./TicketStatusSelect.tsx";

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

// Records each PATCH /api/tickets/t1 body and answers with the ticket as the server would save it.
function recordPatches() {
  const bodies: unknown[] = [];
  server.use(
    http.patch("/api/tickets/t1", async ({ request }) => {
      const body = (await request.json()) as { status: TicketStatus };
      bodies.push(body);
      return HttpResponse.json({ ticket: { ...ticket, ...body } });
    }),
  );
  return bodies;
}

const select = () => screen.getByRole("combobox", { name: "Status" });

async function choose(name: string) {
  const user = userEvent.setup();
  await user.click(select());
  await user.click(await screen.findByRole("option", { name }));
}

describe("TicketStatusSelect", () => {
  test("shows the ticket's status", () => {
    renderWithQuery(<TicketStatusSelect ticket={{ ...ticket, status: "resolved" }} />);
    expect(select()).toHaveTextContent("Resolved");
    expect(select()).toBeEnabled();
  });

  test("offers every status in order", async () => {
    const user = userEvent.setup();
    renderWithQuery(<TicketStatusSelect ticket={ticket} />);
    await user.click(select());
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Open", "Resolved", "Closed"]);
  });

  test("saves the chosen status and writes the saved ticket into the detail cache", async () => {
    const bodies = recordPatches();
    const { queryClient } = renderWithQuery(<TicketStatusSelect ticket={ticket} />);

    await choose("Closed");
    await waitFor(() => expect(bodies).toEqual([{ status: "closed" }]));
    await waitFor(() =>
      expect(queryClient.getQueryData<Ticket>(["tickets", "detail", "t1"])).toMatchObject({
        status: "closed",
      }),
    );
  });

  test("marks cached ticket lists stale after saving, but not other ticket queries", async () => {
    recordPatches();
    const { queryClient } = renderWithQuery(<TicketStatusSelect ticket={ticket} />);
    const listKey = ["tickets", { sortBy: "createdAt", sortOrder: "desc", page: 1, pageSize: 25 }];
    queryClient.setQueryData(listKey, { tickets: [], total: 0, page: 1, pageSize: 25 });
    queryClient.setQueryData(["tickets", "assignees"], []);

    await choose("Resolved");
    await waitFor(() => expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(["tickets", "assignees"])?.isInvalidated).toBe(false);
  });

  test("doesn't save when the current status is chosen again", async () => {
    const bodies = recordPatches();
    renderWithQuery(<TicketStatusSelect ticket={ticket} />);

    await choose("Open");
    // Give a stray request time to arrive before asserting there was none.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies).toEqual([]);
  });

  test("is disabled while saving", async () => {
    let respond!: () => void;
    server.use(
      http.patch(
        "/api/tickets/t1",
        () =>
          new Promise<Response>((resolve) => {
            respond = () => resolve(HttpResponse.json({ ticket: { ...ticket, status: "closed" } }));
          }),
      ),
    );
    renderWithQuery(<TicketStatusSelect ticket={ticket} />);

    await choose("Closed");
    await waitFor(() => expect(select()).toBeDisabled());
    respond();
    await waitFor(() => expect(select()).toBeEnabled());
  });

  test("shows the server's error when saving fails, keeping the old status", async () => {
    server.use(
      http.patch("/api/tickets/t1", () =>
        HttpResponse.json({ error: "Ticket not found" }, { status: 404 }),
      ),
    );
    const { queryClient } = renderWithQuery(<TicketStatusSelect ticket={ticket} />);

    await choose("Closed");
    expect(await screen.findByText("Ticket not found")).toBeInTheDocument();
    expect(select()).toHaveTextContent("Open");
    expect(queryClient.getQueryData(["tickets", "detail", "t1"])).toBeUndefined();
  });

  test("falls back to a generic message when saving fails without a response", async () => {
    server.use(http.patch("/api/tickets/t1", () => HttpResponse.error()));
    renderWithQuery(<TicketStatusSelect ticket={ticket} />);

    await choose("Closed");
    expect(await screen.findByText("Failed to update status")).toBeInTheDocument();
  });
});
