import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import type { Ticket, TicketCategory } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import TicketCategorySelect from "./TicketCategorySelect.tsx";

const ticket: Ticket = {
  id: "t1",
  subject: "Course video won't play",
  body: "The video shows a black screen.",
  fromEmail: "sam@example.com",
  fromName: "Sam Student",
  status: "open",
  category: "technical_question",
  assignedTo: null,
  createdAt: "2026-05-02T09:15:00.000Z",
  updatedAt: "2026-05-02T09:15:00.000Z",
};

// Records each PATCH /api/tickets/t1 body and answers with the ticket as the server would save it.
function recordPatches() {
  const bodies: unknown[] = [];
  server.use(
    http.patch("/api/tickets/t1", async ({ request }) => {
      const body = (await request.json()) as { category: TicketCategory | null };
      bodies.push(body);
      return HttpResponse.json({ ticket: { ...ticket, ...body } });
    }),
  );
  return bodies;
}

const select = () => screen.getByRole("combobox", { name: "Category" });

async function choose(name: string) {
  const user = userEvent.setup();
  await user.click(select());
  await user.click(await screen.findByRole("option", { name }));
}

describe("TicketCategorySelect", () => {
  test("shows the ticket's category", () => {
    renderWithQuery(<TicketCategorySelect ticket={ticket} />);
    expect(select()).toHaveTextContent("Technical");
  });

  test("shows Uncategorized for an unclassified ticket", () => {
    renderWithQuery(<TicketCategorySelect ticket={{ ...ticket, category: null }} />);
    expect(select()).toHaveTextContent("Uncategorized");
  });

  test("offers every category, then Uncategorized", async () => {
    const user = userEvent.setup();
    renderWithQuery(<TicketCategorySelect ticket={ticket} />);
    await user.click(select());
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "General question",
      "Technical",
      "Refund",
      "Uncategorized",
    ]);
  });

  test("saves the chosen category and writes the saved ticket into the detail cache", async () => {
    const bodies = recordPatches();
    const { queryClient } = renderWithQuery(<TicketCategorySelect ticket={ticket} />);

    await choose("Refund");
    await waitFor(() => expect(bodies).toEqual([{ category: "refund_request" }]));
    await waitFor(() =>
      expect(queryClient.getQueryData<Ticket>(["tickets", "detail", "t1"])).toMatchObject({
        category: "refund_request",
      }),
    );
  });

  test("sends null when Uncategorized is chosen", async () => {
    const bodies = recordPatches();
    renderWithQuery(<TicketCategorySelect ticket={ticket} />);

    await choose("Uncategorized");
    await waitFor(() => expect(bodies).toEqual([{ category: null }]));
  });

  test("doesn't save when the current category is chosen again", async () => {
    const bodies = recordPatches();
    renderWithQuery(<TicketCategorySelect ticket={{ ...ticket, category: null }} />);

    await choose("Uncategorized");
    // Give a stray request time to arrive before asserting there was none.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bodies).toEqual([]);
  });

  test("shows the server's error when saving fails, keeping the old category", async () => {
    server.use(
      http.patch("/api/tickets/t1", () =>
        HttpResponse.json({ error: "Invalid option" }, { status: 400 }),
      ),
    );
    renderWithQuery(<TicketCategorySelect ticket={ticket} />);

    await choose("Refund");
    expect(await screen.findByText("Invalid option")).toBeInTheDocument();
    expect(select()).toHaveTextContent("Technical");
  });

  test("falls back to a generic message when saving fails without a response", async () => {
    server.use(http.patch("/api/tickets/t1", () => HttpResponse.error()));
    renderWithQuery(<TicketCategorySelect ticket={ticket} />);

    await choose("Refund");
    expect(await screen.findByText("Failed to update category")).toBeInTheDocument();
  });
});
