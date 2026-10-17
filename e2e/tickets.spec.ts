import type { Page } from "@playwright/test";
import {
  ADMIN,
  apiSignIn,
  dashboardHeading,
  expect,
  signInViaForm,
  test,
  ticketsHeading,
  ticketsNavLink,
  usersNavLink,
  type Ticket,
  type TicketCategory,
} from "./fixtures.ts";

/** Format a timestamp exactly as TicketsPage does, in the browser's locale and time zone. */
function formatReceived(page: Page, iso: string) {
  return page.evaluate(
    (value) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      ),
    iso,
  );
}

const ticketRows = (page: Page, tag: string) =>
  page.getByRole("row").filter({ hasText: tag });

test.describe("ticket list page", () => {
  test("shows tickets from the inbound email webhook, newest first", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8);
    const tag2 = crypto.randomUUID();
    // Created in sequence, so each one is newer than the last.
    const oldest = await createTicket({
      subject: `Cannot log in [${tag}]`,
      from: `sam-${tag2}@example.com`,
      fromName: "Sam Student",
    });
    const middle = await createTicket({
      subject: `Refund request [${tag}]`,
      from: `no-name-${tag2}@example.com`,
    });
    const newest = await createTicket({
      subject: `Video won't play [${tag}]`,
      from: `Pat-${tag2}@Example.com`,
      fromName: "Pat Parent",
    });

    await page.goto("/tickets");
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(
      page.getByText("Support requests from email. Click a column heading to sort."),
    ).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText([
      "Subject",
      "From",
      "Category",
      "Status",
      "Received",
    ]);

    const rows = ticketRows(page, tag);
    await expect(rows).toHaveCount(3);
    await expect(rows).toHaveText([/Video won't play/, /Refund request/, /Cannot log in/]);

    const expectRow = async (
      index: number,
      ticket: Ticket,
      from: { name: string | null; email: string },
    ) => {
      const cells = rows.nth(index).getByRole("cell");
      await expect(cells).toHaveCount(5);
      await expect(cells.nth(0)).toHaveText(ticket.subject);
      if (from.name) {
        await expect(cells.nth(1).getByText(from.name, { exact: true })).toBeVisible();
        await expect(cells.nth(1).getByText(from.email, { exact: true })).toBeVisible();
      } else {
        await expect(cells.nth(1)).toHaveText(from.email);
      }
      // Webhook tickets aren't classified yet.
      await expect(cells.nth(2)).toHaveText("Uncategorized");
      await expect(cells.nth(3)).toHaveText("Open");
      await expect(cells.nth(4)).toHaveText(await formatReceived(page, ticket.createdAt));
    };

    // The sender address is stored lowercased.
    await expectRow(0, newest, { name: "Pat Parent", email: `pat-${tag2}@example.com` });
    await expectRow(1, middle, { name: null, email: `no-name-${tag2}@example.com` });
    await expectRow(2, oldest, { name: "Sam Student", email: `sam-${tag2}@example.com` });
  });

  test("shows the category label for classified tickets", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
  }) => {
    const tag = crypto.randomUUID();
    const cases: [TicketCategory | null, string][] = [
      ["general_question", "General question"],
      ["technical_question", "Technical"],
      ["refund_request", "Refund"],
      [null, "Uncategorized"],
    ];
    const tickets: Ticket[] = [];
    for (const [category] of cases) {
      const ticket = await createTicket({ subject: `${category ?? "none"} [${tag}]` });
      // No API sets a category yet (AI classification comes later), so write it to the test DB.
      if (category) setTicketCategory(ticket.id, category);
      tickets.push(ticket);
    }

    await page.goto("/tickets");
    await expect(ticketsHeading(page)).toBeVisible();
    const categoryIndex = 2;
    await expect(page.getByRole("columnheader").nth(categoryIndex)).toHaveText("Category");
    for (const [i, [, label]] of cases.entries()) {
      const row = page.getByRole("row").filter({ hasText: tickets[i]!.subject });
      await expect(row.getByRole("cell").nth(categoryIndex)).toHaveText(label);
    }
  });

  test("shows the empty state when there are no tickets", async ({ agentPage: page }) => {
    // The DB is shared for the whole run and only reset at the start; every ticket test deletes
    // its tickets afterwards, so the list is normally empty here. If something else left tickets
    // behind (e.g. server tests running against helpdesk_test at the same time), the empty state
    // can't be observed without deleting data this test doesn't own.
    const res = await page.request.get("/api/tickets");
    expect(res.status()).toBe(200);
    const { tickets } = (await res.json()) as { tickets: Ticket[] };
    test.skip(tickets.length > 0, "The test database already has tickets from elsewhere");

    await page.goto("/tickets");
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(page.getByRole("cell", { name: "No tickets yet." })).toBeVisible();
  });
});

test.describe("tickets navigation", () => {
  test("an agent sees the Tickets link and can open the ticket list", async ({
    agentPage: page,
  }) => {
    await expect(ticketsNavLink(page)).toBeVisible();
    await expect(usersNavLink(page)).toHaveCount(0);

    await ticketsNavLink(page).click();
    await expect(page).toHaveURL("/tickets");
    await expect(ticketsHeading(page)).toBeVisible();
  });

  test("an admin sees the Tickets link and can open the ticket list", async ({
    adminPage: page,
  }) => {
    await expect(ticketsNavLink(page)).toBeVisible();

    await ticketsNavLink(page).click();
    await expect(page).toHaveURL("/tickets");
    await expect(ticketsHeading(page)).toBeVisible();
  });

  test("signed out, the Tickets link is hidden", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(ticketsNavLink(page)).toHaveCount(0);
  });

  test("signed out, /tickets redirects to /login and returns to /tickets after sign-in", async ({
    page,
    agent,
    createTicket,
  }) => {
    const ticket = await createTicket();

    await page.goto("/tickets");
    await expect(page).toHaveURL("/login");
    await expect(ticketsHeading(page)).toHaveCount(0);

    await signInViaForm(page, agent);
    await expect(page).toHaveURL("/tickets");
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: ticket.subject })).toBeVisible();
    await expect(dashboardHeading(page)).toHaveCount(0);
  });
});

test.describe("GET /api/tickets", () => {
  test("returns tickets newest first to a signed-in agent", async ({
    page,
    agent,
    createTicket,
  }) => {
    const tag = crypto.randomUUID();
    const created: Ticket[] = [];
    for (const name of ["first", "second", "third"]) {
      created.push(await createTicket({ subject: `${name} [${tag}]`, fromName: `Sender ${name}` }));
    }

    await apiSignIn(page.request, agent);
    const res = await page.request.get("/api/tickets");
    expect(res.status()).toBe(200);
    const { tickets } = (await res.json()) as { tickets: Ticket[] };

    // Webhook-created tickets start unclassified.
    for (const t of created) expect(t.category).toBeNull();

    const ours = tickets.filter((t) => t.subject.includes(tag));
    expect(ours).toEqual(
      [...created].reverse().map((t) => ({
        id: t.id,
        subject: t.subject,
        fromEmail: t.fromEmail,
        fromName: t.fromName,
        status: "open",
        category: null,
        createdAt: t.createdAt,
      })),
    );

    // The whole list is sorted by createdAt, newest first.
    const times = tickets.map((t) => Date.parse(t.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test("returns tickets to a signed-in admin", async ({ page, createTicket }) => {
    const ticket = await createTicket();

    await apiSignIn(page.request, ADMIN);
    const res = await page.request.get("/api/tickets");
    expect(res.status()).toBe(200);
    const { tickets } = (await res.json()) as { tickets: Ticket[] };
    expect(tickets.map((t) => t.id)).toContain(ticket.id);
  });

  test("returns the category once a ticket is classified", async ({
    page,
    agent,
    createTicket,
    setTicketCategory,
  }) => {
    const ticket = await createTicket();
    setTicketCategory(ticket.id, "refund_request");

    await apiSignIn(page.request, agent);
    const res = await page.request.get("/api/tickets");
    expect(res.status()).toBe(200);
    const { tickets } = (await res.json()) as { tickets: Ticket[] };
    expect(tickets.find((t) => t.id === ticket.id)).toEqual({
      id: ticket.id,
      subject: ticket.subject,
      fromEmail: ticket.fromEmail,
      fromName: ticket.fromName,
      status: "open",
      category: "refund_request",
      createdAt: ticket.createdAt,
    });
  });

  test("rejects requests without a session", async ({ page }) => {
    const res = await page.request.get("/api/tickets");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
