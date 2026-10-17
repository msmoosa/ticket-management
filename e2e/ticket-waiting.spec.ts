import type { Page } from "@playwright/test";
import { expect, test, ticketsHeading, type ListedTicket, type Ticket } from "./fixtures.ts";

// How long a ticket's sender has had no answer (`Ticket.awaitingReplySince`): the list's first
// column ("12m", "26h", "3d"; "Replied" once an agent answered; empty unless open) and the
// "Waiting" item on the detail page ("3 hours"). Set when a ticket arrives, cleared by an agent
// reply, set again by the customer's next emailed reply. Other tests' tickets may share the DB,
// so the list is always searched to this test's unique subject.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const subjectHeading = (page: Page, subject: string) =>
  page.getByRole("heading", { name: subject, level: 1 });
const ticketRow = (page: Page, subject: string) =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name: subject, exact: true }) });
/** The row's Waiting cell (the first column). */
const waitingCell = (page: Page, subject: string) =>
  ticketRow(page, subject).getByRole("cell").first();
/** The detail page's "Waiting" item (a <dt>/<dd> pair in the sender metadata list). */
const waitingTerm = (page: Page) => page.getByRole("term").filter({ hasText: /^Waiting$/ });
const waitingDetail = (page: Page) =>
  page.locator("dl > div").filter({ has: waitingTerm(page) }).getByRole("definition");
const replyField = (page: Page) => page.getByRole("textbox", { name: "Reply" });
const sendButton = (page: Page) => page.getByRole("button", { name: "Send reply" });
const replyItems = (page: Page) =>
  page.getByRole("list", { name: "Reply thread" }).getByRole("listitem");

async function openList(page: Page, subject: string) {
  await page.goto(`/tickets?search=${encodeURIComponent(subject)}`);
  await expect(ticketsHeading(page)).toBeVisible();
  await expect(ticketRow(page, subject)).toBeVisible();
}

async function openDetail(page: Page, ticket: Ticket) {
  await page.goto(`/tickets/${ticket.id}`);
  await expect(subjectHeading(page, ticket.subject)).toBeVisible();
}

async function sendReply(page: Page, body: string) {
  await replyField(page).fill(body);
  await sendButton(page).click();
  await expect(replyItems(page).last()).toContainText(body);
}

/** The ticket as GET /api/tickets/:id returns it. */
async function fetchTicket(page: Page, id: string): Promise<ListedTicket> {
  const res = await page.request.get(`/api/tickets/${id}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { ticket: ListedTicket }).ticket;
}

/** Format a date as the Waiting tooltip does, in the browser's locale and time zone. */
function formatSince(page: Page, iso: string) {
  return page.evaluate(
    (value) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      ),
    iso,
  );
}

const subject = (label: string) => `${label} [${crypto.randomUUID()}]`;

test.describe("ticket waiting time", () => {
  test("a new open ticket shows a wait of minutes in the list and on its page", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket({ subject: subject("Fresh wait") });

    // The API starts the wait when the ticket arrives.
    const listed = await fetchTicket(page, ticket.id);
    expect(listed.awaitingReplySince).not.toBeNull();
    expect(
      Math.abs(Date.parse(listed.awaitingReplySince!) - Date.parse(ticket.createdAt)),
    ).toBeLessThan(5_000);

    await openList(page, ticket.subject);
    // Waiting is the first column and, unlike the others, isn't a sort button.
    const waitingHeader = page.getByRole("columnheader").first();
    await expect(waitingHeader).toHaveText("Waiting");
    await expect(waitingHeader.getByRole("button")).toHaveCount(0);
    await expect(waitingCell(page, ticket.subject)).toHaveText(/^\d+m$/);
    await expect(waitingCell(page, ticket.subject).getByTitle(/^Waiting since /)).toBeVisible();

    await openDetail(page, ticket);
    await expect(waitingTerm(page)).toBeVisible();
    await expect(waitingDetail(page)).toHaveText(/^\d+ minutes?$/);
  });

  test("an agent's reply ends the wait on the ticket page and in the list", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket({ subject: subject("Answered") });

    // Open the ticket from the list, so the list's cached page is what Back to tickets shows.
    await openList(page, ticket.subject);
    await expect(waitingCell(page, ticket.subject)).toHaveText(/^\d+m$/);
    await page.getByRole("link", { name: ticket.subject, exact: true }).click();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(waitingDetail(page)).toHaveText(/^\d+ minutes?$/);

    await sendReply(page, `We're on it. [${crypto.randomUUID()}]`);
    await expect(waitingTerm(page)).toBeHidden();
    // Still open: only the wait ended.
    await expect(page.getByRole("combobox", { name: "Status" })).toContainText("Open");

    await page.getByRole("link", { name: "Back to tickets" }).click();
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(waitingCell(page, ticket.subject)).toHaveText("Replied");

    // And it's stored, not just updated in the browser's cache.
    expect((await fetchTicket(page, ticket.id)).awaitingReplySince).toBeNull();
    await openDetail(page, ticket);
    await expect(replyItems(page)).toHaveCount(1);
    await expect(waitingTerm(page)).toBeHidden();
  });

  test("the customer's emailed reply after an agent's answer starts a new wait", async ({
    agentPage: page,
    createTicket,
  }) => {
    const from = `waiting-${crypto.randomUUID()}@example.com`;
    const messageId = `<e2e-waiting-${crypto.randomUUID()}@example.com>`;
    const ticket = await createTicket({ subject: subject("Follow-up"), from, messageId });

    await openDetail(page, ticket);
    await sendReply(page, "Have you tried signing out and in again?");
    await expect(waitingTerm(page)).toBeHidden();

    // The customer answers in the same thread (as the email provider would deliver it).
    const followUp = `That didn't help, sorry. [${crypto.randomUUID()}]`;
    const threaded = await createTicket({
      from,
      subject: `Re: ${ticket.subject}`,
      text: followUp,
      inReplyTo: messageId,
    });
    expect(threaded.id).toBe(ticket.id);

    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(replyItems(page)).toHaveCount(2);
    await expect(replyItems(page).last()).toContainText(followUp);
    await expect(waitingDetail(page)).toHaveText(/^\d+ minutes?$/);

    await openList(page, ticket.subject);
    await expect(waitingCell(page, ticket.subject)).toHaveText(/^\d+m$/);
  });

  test("resolved and closed tickets show no wait", async ({
    agentPage: page,
    createTicket,
    setTicketStatus,
  }) => {
    const resolved = await createTicket({ subject: subject("Resolved wait") });
    const closed = await createTicket({ subject: subject("Closed wait") });
    setTicketStatus(resolved.id, "resolved");
    setTicketStatus(closed.id, "closed");

    for (const [ticket, status] of [
      [resolved, "Resolved"],
      [closed, "Closed"],
    ] as const) {
      await openList(page, ticket.subject);
      const cells = ticketRow(page, ticket.subject).getByRole("cell");
      await expect(cells.nth(4)).toHaveText(status);
      // Still awaiting a reply in the DB, but the wait only matters while the ticket is open.
      await expect(cells.first()).toHaveText("");

      await openDetail(page, ticket);
      await expect(page.getByRole("term").filter({ hasText: /^Received$/ })).toBeVisible();
      await expect(waitingTerm(page)).toBeHidden();
    }
  });

  test("longer waits show in hours up to two days, then in days", async ({
    agentPage: page,
    createTicket,
    setTicketTimes,
  }) => {
    const cases = [
      // A little past the whole unit, so the floor is stable while the test runs.
      { ago: 26 * HOUR + 10 * MINUTE, short: "26h", long: "26 hours" },
      { ago: 3 * DAY + HOUR, short: "3d", long: "3 days" },
    ];
    for (const { ago, short, long } of cases) {
      const ticket = await createTicket({ subject: subject(`Waiting ${short}`) });
      const since = new Date(Date.now() - ago).toISOString();
      setTicketTimes(ticket.id, { createdAt: since, awaitingReplySince: since });

      await openList(page, ticket.subject);
      const cell = waitingCell(page, ticket.subject);
      await expect(cell).toHaveText(short);
      await expect(cell.getByTitle(`Waiting since ${await formatSince(page, since)}`)).toBeVisible();

      await openDetail(page, ticket);
      await expect(waitingDetail(page)).toHaveText(long);
    }
  });

  test("the reply thread shows how long after the email an agent answered", async ({
    agentPage: page,
    createTicket,
    setTicketTimes,
  }) => {
    const ticket = await createTicket({ subject: subject("Slow answer") });
    const since = new Date(Date.now() - 3 * DAY - HOUR).toISOString();
    setTicketTimes(ticket.id, { createdAt: since, awaitingReplySince: since });

    await openDetail(page, ticket);
    await sendReply(page, "Sorry for the slow reply!");
    await expect(replyItems(page).first()).toContainText("3 days later");
    await expect(waitingTerm(page)).toBeHidden();
  });
});
