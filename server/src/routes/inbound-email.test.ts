import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../app.ts";
import { prisma } from "../db.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let url: string;

const run = crypto.randomUUID();
const secret = process.env.INBOUND_EMAIL_SECRET!;
const support = process.env.SUPPORT_EMAIL!;
// Every ticket these tests create has this marker in its subject, for cleanup.
const subject = (text: string) => `${text} [${run}]`;

const email = (overrides: Record<string, unknown> = {}) => ({
  from: "Student@Example.com",
  fromName: "Sam Student",
  to: [support],
  subject: subject("Can't log in"),
  text: "I forgot my password.",
  ...overrides,
});

function post(body: unknown, headers: Record<string, string> = { "X-Webhook-Secret": secret }) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  if (!secret || !support) {
    throw new Error("Set INBOUND_EMAIL_SECRET and SUPPORT_EMAIL in server/.env.test");
  }
  server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  url = `http://localhost:${port}/api/webhooks/inbound-email`;
});

afterAll(async () => {
  await prisma.ticket.deleteMany({
    where: { OR: [{ subject: { contains: run } }, { messageId: { contains: run } }] },
  });
  server.close();
});

test("rejects a missing secret with 401", async () => {
  const res = await post(email(), {});
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("rejects a wrong secret with 401", async () => {
  const res = await post(email(), { "X-Webhook-Secret": `${secret}x` });
  expect(res.status).toBe(401);
});

test("fails closed with 503 when no secret is configured", async () => {
  delete process.env.INBOUND_EMAIL_SECRET;
  try {
    const res = await post(email(), { "X-Webhook-Secret": "" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Inbound email is not configured" });
  } finally {
    process.env.INBOUND_EMAIL_SECRET = secret;
  }
});

test.each([
  [{ from: "not-an-email" }, "`from` must be an email address"],
  [{ to: [] }, "`to` must list at least one recipient"],
  [{ text: undefined }, "The email needs a `text` or `html` body"],
  [{ text: "  \n " }, "The email body is empty"],
])("rejects an invalid email with 400 (%#)", async (overrides, error) => {
  const res = await post(email(overrides));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error });
});

test("rejects email not addressed to the support address with 422", async () => {
  const res = await post(email({ to: ["sales@example.com"], subject: subject("wrong inbox") }));
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: "Not addressed to the support address" });
  expect(await prisma.ticket.count({ where: { subject: subject("wrong inbox") } })).toBe(0);
});

test("creates an open ticket from the email", async () => {
  const res = await post(
    email({ to: ["someone@example.com", `Help Desk <${support.toUpperCase()}>`] }),
  );
  expect(res.status).toBe(201);

  const { ticket } = (await res.json()) as { ticket: Record<string, unknown> };
  expect(ticket).toEqual({
    id: expect.any(String),
    subject: subject("Can't log in"),
    body: "I forgot my password.",
    fromEmail: "student@example.com",
    fromName: "Sam Student",
    status: "open",
    category: null,
    createdAt: expect.any(String),
  });
  const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id as string } });
  expect(row.messageId).toBeNull();
});

test("stores an HTML-only email as plain text", async () => {
  const res = await post(
    email({ text: undefined, html: "<p>Hello &amp; welcome</p><p>Second<br>line</p>" }),
  );
  expect(res.status).toBe(201);
  const { ticket } = (await res.json()) as { ticket: { body: string } };
  expect(ticket.body).toBe("Hello & welcome\nSecond\nline");
});

test("prefers the text part when both are sent", async () => {
  const res = await post(email({ html: "<p>HTML version</p>" }));
  const { ticket } = (await res.json()) as { ticket: { body: string } };
  expect(ticket.body).toBe("I forgot my password.");
});

test("uses a placeholder subject when the email has none", async () => {
  const messageId = `<no-subject-${run}@mail.example.com>`;
  const res = await post(email({ subject: "   ", messageId }));
  expect(res.status).toBe(201);
  const { ticket } = (await res.json()) as { ticket: { subject: string } };
  expect(ticket.subject).toBe("(no subject)");
});

test("a repeated Message-ID returns the existing ticket instead of a duplicate", async () => {
  const messageId = `<retry-${run}@mail.example.com>`;
  const first = await post(email({ messageId, subject: subject("retried") }));
  expect(first.status).toBe(201);
  const second = await post(email({ messageId, subject: subject("retried") }));
  expect(second.status).toBe(200);

  const a = (await first.json()) as { ticket: { id: string } };
  const b = (await second.json()) as { ticket: { id: string } };
  expect(b.ticket.id).toBe(a.ticket.id);
  expect(await prisma.ticket.count({ where: { messageId } })).toBe(1);
});

test("accepts bodies larger than the app-wide 100kb JSON limit", async () => {
  const res = await post(email({ text: "x".repeat(300_000) }));
  expect(res.status).toBe(201);
});

function postRaw(body: string) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Webhook-Secret": secret },
    body,
  });
}

test("rejects malformed JSON with 400", async () => {
  const res = await postRaw('{"from": oops');
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Malformed JSON body" });
});

test("rejects bodies over 1mb with 413", async () => {
  const res = await postRaw(JSON.stringify(email({ text: "x".repeat(1_100_000) })));
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ error: "Request body is too large" });
});

type Reply = { id: string; sender: string; body: string; author: unknown; createdAt: string };
type Threaded = { ticket: { id: string; status: string }; reply?: Reply };

// Opens a ticket from an email with a Message-ID, for replies to reference.
async function openTicket(name: string) {
  const messageId = `<${name}-${run}@mail.example.com>`;
  const res = await post(email({ messageId, subject: subject(name) }));
  expect(res.status).toBe(201);
  const { ticket } = (await res.json()) as Threaded;
  return { ticket, messageId };
}

const replyEmail = (overrides: Record<string, unknown>) =>
  email({
    subject: `Re: ${subject("thread")}`,
    messageId: `<reply-${crypto.randomUUID()}-${run}@mail.example.com>`,
    ...overrides,
  });

test("a reply from the ticket's sender is added to its thread, without the quoted text", async () => {
  const { ticket, messageId } = await openTicket("reply-in-reply-to");

  const res = await post(
    replyEmail({
      inReplyTo: messageId,
      text: "Still can't log in.\n\nOn Mon, 4 May 2026, Help Desk <help@example.com> wrote:\n> Try resetting it.",
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as Threaded;
  expect(body.ticket.id).toBe(ticket.id);
  expect(body.reply).toEqual({
    id: expect.any(String),
    sender: "customer",
    body: "Still can't log in.",
    author: null,
    createdAt: expect.any(String),
  });

  // No new ticket: only the original has this run's thread subject.
  expect(await prisma.ticket.count({ where: { subject: { contains: `reply-in-reply-to [${run}]` } } })).toBe(1);
  expect(await prisma.ticketReply.count({ where: { ticketId: ticket.id } })).toBe(1);
});

test("threads by References too (string or array, with or without angle brackets), and by earlier replies", async () => {
  const { ticket, messageId } = await openTicket("reply-references");

  const first = await post(
    replyEmail({ references: `<unknown@elsewhere> ${messageId.slice(1, -1)}`, text: "One" }),
  );
  expect(((await first.json()) as Threaded).ticket.id).toBe(ticket.id);

  // A later reply that only references the first reply still finds the ticket.
  const firstReplyId = (await prisma.ticketReply.findFirstOrThrow({
    where: { ticketId: ticket.id },
  })).messageId!;
  const second = await post(replyEmail({ references: [firstReplyId], text: "Two" }));
  expect(second.status).toBe(201);
  expect(((await second.json()) as Threaded).ticket.id).toBe(ticket.id);

  const replies = await prisma.ticketReply.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "asc" },
  });
  expect(replies.map((r) => r.body)).toEqual(["One", "Two"]);
});

test("a reply reopens a resolved or closed ticket", async () => {
  const { ticket, messageId } = await openTicket("reply-reopens");
  await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "closed" } });

  const res = await post(replyEmail({ inReplyTo: messageId, text: "It broke again." }));
  expect(((await res.json()) as Threaded).ticket.status).toBe("open");
  expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("open");
});

test("a repeated reply Message-ID returns the existing reply instead of a duplicate", async () => {
  const { ticket, messageId } = await openTicket("reply-retried");
  const reply = replyEmail({ inReplyTo: messageId, text: "Once only" });

  const first = await post(reply);
  expect(first.status).toBe(201);
  const second = await post(reply);
  expect(second.status).toBe(200);
  const a = (await first.json()) as Threaded;
  const b = (await second.json()) as Threaded;
  expect(b).toEqual({ ...a, ticket: { ...a.ticket, status: "open" } });
  expect(await prisma.ticketReply.count({ where: { ticketId: ticket.id } })).toBe(1);
});

test("mail from someone else, or referencing nothing known, starts a new ticket", async () => {
  const { ticket, messageId } = await openTicket("reply-stranger");

  for (const overrides of [
    { from: "someone-else@example.com", inReplyTo: messageId, subject: subject("stranger") },
    { inReplyTo: `<unknown-${run}@mail.example.com>`, subject: subject("unknown ref") },
  ]) {
    const res = await post(replyEmail(overrides));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Threaded;
    expect(body.reply).toBeUndefined();
    expect(body.ticket.id).not.toBe(ticket.id);
  }
  expect(await prisma.ticketReply.count({ where: { ticketId: ticket.id } })).toBe(0);
});
