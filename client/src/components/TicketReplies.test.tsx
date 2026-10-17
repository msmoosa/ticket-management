import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import type { TicketReply } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import TicketReplies from "./TicketReplies.tsx";

const replies: TicketReply[] = [
  {
    id: "r1",
    sender: "agent",
    body: "Have you tried another browser?\nChrome works best.",
    author: { id: "u2", name: "Alex Agent" },
    createdAt: "2026-05-02T10:00:00.000Z",
  },
  {
    id: "r2",
    sender: "agent",
    body: "Following up on this.",
    author: null,
    createdAt: "2026-05-03T08:30:00.000Z",
  },
];

const ticket = { id: "t1", fromEmail: "sam@example.com", fromName: "Sam Student" };

const sentFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function mockReplies(response: Parameters<typeof HttpResponse.json>[0], status = 200) {
  server.use(
    http.get("/api/tickets/t1/replies", () => HttpResponse.json(response, { status })),
  );
}

const replyBox = () => screen.getByRole("textbox", { name: "Reply" });
const sendButton = () => screen.getByRole("button", { name: "Send reply" });

describe("TicketReplies", () => {
  test("shows a loading state while the replies load", () => {
    mockReplies({ replies });
    renderWithQuery(<TicketReplies ticket={ticket} />);
    expect(screen.getByRole("status", { name: "Loading replies" })).toBeInTheDocument();
  });

  test("lists replies oldest first with author, time and body", async () => {
    mockReplies({ replies });
    renderWithQuery(<TicketReplies ticket={ticket} />);

    const items = within(await screen.findByRole("list", { name: "Reply thread" })).getAllByRole(
      "listitem",
    );
    expect(items).toHaveLength(2);
    const first = within(items[0]!);
    expect(first.getByText("Alex Agent")).toBeInTheDocument();
    expect(first.getByText(sentFormat.format(new Date(replies[0]!.createdAt)))).toBeInTheDocument();
    expect(first.getByText(/Have you tried another browser\?/)).toBeInTheDocument();
    expect(within(items[1]!).getByText("Deleted user")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Following up on this.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  test("shows the sender's emailed replies under their name, marked as from the customer", async () => {
    const customerReply: TicketReply = {
      id: "r3",
      sender: "customer",
      body: "Still broken in Firefox.",
      author: null,
      createdAt: "2026-05-04T09:00:00.000Z",
    };
    mockReplies({ replies: [...replies, customerReply] });
    renderWithQuery(<TicketReplies ticket={ticket} />);

    const items = within(await screen.findByRole("list", { name: "Reply thread" })).getAllByRole(
      "listitem",
    );
    const last = within(items[2]!);
    expect(last.getByText("Sam Student")).toBeInTheDocument();
    expect(last.getByText("Customer")).toBeInTheDocument();
    expect(last.getByText("Still broken in Firefox.")).toBeInTheDocument();
    expect(last.queryByText("Deleted user")).not.toBeInTheDocument();
    // Agent replies aren't marked.
    expect(within(items[0]!).queryByText("Customer")).not.toBeInTheDocument();
  });

  test("names a customer without a display name by their email", async () => {
    mockReplies({
      replies: [{ id: "r3", sender: "customer", body: "Hi", author: null, createdAt: replies[0]!.createdAt }],
    });
    renderWithQuery(<TicketReplies ticket={{ ...ticket, fromName: null }} />);
    const item = within(await screen.findByRole("listitem"));
    expect(item.getByText("sam@example.com")).toBeInTheDocument();
  });

  test("says when there are no replies yet", async () => {
    mockReplies({ replies: [] });
    renderWithQuery(<TicketReplies ticket={ticket} />);
    expect(await screen.findByText("No replies yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Reply thread" })).not.toBeInTheDocument();
  });

  test("shows the server's error when the replies fail to load", async () => {
    mockReplies({ error: "Ticket not found" }, 404);
    renderWithQuery(<TicketReplies ticket={ticket} />);
    expect(await screen.findByText("Ticket not found")).toBeInTheDocument();
  });

  test("sends a reply, adds it to the thread and clears the form", async () => {
    const user = userEvent.setup();
    let saved: TicketReply[] = [];
    const bodies: unknown[] = [];
    server.use(
      http.get("/api/tickets/t1/replies", () => HttpResponse.json({ replies: saved })),
      http.post("/api/tickets/t1/replies", async ({ request }) => {
        const body = (await request.json()) as { body: string };
        bodies.push(body);
        const reply = {
          id: "r9",
          sender: "agent" as const,
          body: body.body,
          author: { id: "u1", name: "Ada Admin" },
          createdAt: "2026-05-04T12:00:00.000Z",
        };
        saved = [...saved, reply];
        return HttpResponse.json({ reply }, { status: 201 });
      }),
    );
    renderWithQuery(<TicketReplies ticket={ticket} />);
    await screen.findByText("No replies yet.");

    await user.type(replyBox(), "  Thanks, we're looking into it.  ");
    await user.click(sendButton());

    const thread = within(await screen.findByRole("list", { name: "Reply thread" }));
    expect(thread.getByText("Thanks, we're looking into it.")).toBeInTheDocument();
    expect(thread.getByText("Ada Admin")).toBeInTheDocument();
    expect(bodies).toEqual([{ body: "Thanks, we're looking into it." }]);
    await waitFor(() => expect(replyBox()).toHaveValue(""));
  });

  test("won't send an empty reply", async () => {
    const user = userEvent.setup();
    mockReplies({ replies: [] });
    renderWithQuery(<TicketReplies ticket={ticket} />);
    await screen.findByText("No replies yet.");

    await user.type(replyBox(), "   ");
    await user.click(sendButton());

    expect(await screen.findByText("Write a reply first")).toBeInTheDocument();
    expect(replyBox()).toHaveAttribute("aria-invalid", "true");
  });

  test("shows the server's error when sending fails, keeping the draft", async () => {
    const user = userEvent.setup();
    mockReplies({ replies: [] });
    server.use(
      http.post("/api/tickets/t1/replies", () =>
        HttpResponse.json({ error: "Ticket not found" }, { status: 404 }),
      ),
    );
    renderWithQuery(<TicketReplies ticket={ticket} />);
    await screen.findByText("No replies yet.");

    await user.type(replyBox(), "Hello");
    await user.click(sendButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Ticket not found");
    expect(replyBox()).toHaveValue("Hello");
    expect(screen.getByText("No replies yet.")).toBeInTheDocument();
  });
});
