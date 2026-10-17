import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test, ticketsHeading, type Ticket } from "./fixtures.ts";

// The ticket detail page (/tickets/:id) has "Status" and "Category" selects
// (TicketStatusSelect.tsx / TicketCategorySelect.tsx) that save on change with
// PATCH /api/tickets/:id and are disabled while saving. Any signed-in user can edit. Saving also
// marks cached list pages stale, so "Back to tickets" shows the change. Other tests' tickets share
// the DB, so list assertions are scoped to a search for this test's unique tag.

const statusSelect = (page: Page) => page.getByRole("combobox", { name: "Status" });
const categorySelect = (page: Page) => page.getByRole("combobox", { name: "Category" });
const assigneeSelect = (page: Page) => page.getByRole("combobox", { name: "Assigned to" });
/** The label a select trigger shows (the trigger's own text also includes its chevron). */
const selectedValue = (select: Locator) => select.locator('[data-slot="select-value"]');
const subjectHeading = (page: Page, subject: string) =>
  page.getByRole("heading", { name: subject, level: 1 });
const backLink = (page: Page) => page.getByRole("link", { name: "Back to tickets" });

async function openTicket(page: Page, ticket: Ticket) {
  await page.goto(`/tickets/${ticket.id}`);
  await expect(subjectHeading(page, ticket.subject)).toBeVisible();
}

async function reloadTicket(page: Page, ticket: Ticket) {
  await page.reload();
  await expect(subjectHeading(page, ticket.subject)).toBeVisible();
}

/**
 * Pick an option in a detail-page select and wait for the save to finish (the select is disabled
 * while saving, and the PATCH must succeed).
 */
async function choose(page: Page, select: Locator, option: string) {
  await expect(select).toBeEnabled();
  const saved = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && new URL(res.url()).pathname.startsWith("/api/tickets/"),
  );
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(selectedValue(select)).toHaveText(option);
  await expect(select).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

/** Assert the detail page's three selects show these values. */
async function expectFields(
  page: Page,
  fields: { status: string; category: string; assignee: string },
) {
  await expect(selectedValue(statusSelect(page))).toHaveText(fields.status);
  await expect(selectedValue(categorySelect(page))).toHaveText(fields.category);
  await expect(selectedValue(assigneeSelect(page))).toHaveText(fields.assignee);
}

async function apiAssign(api: APIRequestContext, ticketId: string, assignedToId: string) {
  const res = await api.patch(`/api/tickets/${ticketId}`, { data: { assignedToId } });
  expect(res.status(), `assign ticket: ${await res.text()}`).toBe(200);
}

/** A ticket's row on the list page; cells are Subject, From, Category, Status, Received. */
const ticketRow = (page: Page, ticket: Ticket) =>
  page.getByRole("row").filter({ has: page.getByRole("link", { name: ticket.subject }) });

async function expectRow(page: Page, ticket: Ticket, category: string, status: string) {
  const cells = ticketRow(page, ticket).getByRole("cell");
  await expect(cells).toHaveText([ticket.subject, ticket.fromEmail, category, status, /.+/]);
}

test.describe("changing a ticket's status and category", () => {
  test("an agent moves a ticket Open → Resolved → Closed, and each change persists", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket);
    await expect(selectedValue(statusSelect(page))).toHaveText("Open");

    await choose(page, statusSelect(page), "Resolved");
    await reloadTicket(page, ticket);
    await expect(selectedValue(statusSelect(page))).toHaveText("Resolved");

    await choose(page, statusSelect(page), "Closed");
    await reloadTicket(page, ticket);
    await expect(selectedValue(statusSelect(page))).toHaveText("Closed");
  });

  test("an agent sets, changes and clears a ticket's category, and each change persists", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket);
    await expect(selectedValue(categorySelect(page))).toHaveText("Uncategorized");

    await choose(page, categorySelect(page), "Technical");
    await reloadTicket(page, ticket);
    await expect(selectedValue(categorySelect(page))).toHaveText("Technical");

    await choose(page, categorySelect(page), "Refund");
    await reloadTicket(page, ticket);
    await expect(selectedValue(categorySelect(page))).toHaveText("Refund");

    await choose(page, categorySelect(page), "Uncategorized");
    await reloadTicket(page, ticket);
    await expect(selectedValue(categorySelect(page))).toHaveText("Uncategorized");
  });

  test("the category select offers every category plus Uncategorized, and status every status", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket);

    await categorySelect(page).click();
    await expect(page.getByRole("option")).toHaveText([
      "General question",
      "Technical",
      "Refund",
      "Uncategorized",
    ]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();

    await statusSelect(page).click();
    await expect(page.getByRole("option")).toHaveText(["Open", "Resolved", "Closed"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("Back to tickets shows the new status and category in the list, and filters reflect them", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = crypto.randomUUID();
    const ticket = await createTicket({ subject: `Refund please [${tag}]` });

    // Open the ticket from the list, so the list page for this search is cached.
    await page.goto(`/tickets?search=${tag}`);
    await expect(ticketsHeading(page)).toBeVisible();
    await expectRow(page, ticket, "Uncategorized", "Open");
    await page.getByRole("link", { name: ticket.subject }).click();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();

    await choose(page, statusSelect(page), "Closed");
    await choose(page, categorySelect(page), "Refund");

    await backLink(page).click();
    await expect(page).toHaveURL(`/tickets?search=${tag}`);
    await expectRow(page, ticket, "Refund", "Closed");

    // The status filter (and the category filter) now include it...
    await page.goto(`/tickets?search=${tag}&status=closed&category=refund_request`);
    await expect(ticketsHeading(page)).toBeVisible();
    await expectRow(page, ticket, "Refund", "Closed");

    // ...and the old values no longer match it.
    await page.goto(`/tickets?search=${tag}&status=open`);
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(page.getByRole("cell", { name: "No tickets match these filters." })).toBeVisible();
    await expect(ticketRow(page, ticket)).toHaveCount(0);

    await page.goto(`/tickets?search=${tag}&category=uncategorized`);
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(page.getByRole("cell", { name: "No tickets match these filters." })).toBeVisible();
  });

  test("Back to tickets after changing only the status keeps the list filtered view up to date", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = crypto.randomUUID();
    const ticket = await createTicket({ subject: `Still open [${tag}]` });

    // Open the ticket from the "Open" filtered list, then resolve it.
    await page.goto(`/tickets?search=${tag}&status=open`);
    await expect(ticketsHeading(page)).toBeVisible();
    await expectRow(page, ticket, "Uncategorized", "Open");
    await page.getByRole("link", { name: ticket.subject }).click();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();

    await choose(page, statusSelect(page), "Resolved");

    await backLink(page).click();
    await expect(page).toHaveURL(`/tickets?search=${tag}&status=open`);
    await expect(page.getByRole("cell", { name: "No tickets match these filters." })).toBeVisible();
    await expect(ticketRow(page, ticket)).toHaveCount(0);
  });

  test("changing status keeps category and assignee, and changing category keeps status and assignee", async ({
    agentPage: page,
    agent,
    createTicket,
    adminApi,
  }) => {
    const ticket = await createTicket();
    await apiAssign(adminApi, ticket.id, agent.id);
    await openTicket(page, ticket);
    await expectFields(page, { status: "Open", category: "Uncategorized", assignee: agent.name });

    await choose(page, categorySelect(page), "General question");
    await reloadTicket(page, ticket);
    await expectFields(page, {
      status: "Open",
      category: "General question",
      assignee: agent.name,
    });

    await choose(page, statusSelect(page), "Resolved");
    await reloadTicket(page, ticket);
    await expectFields(page, {
      status: "Resolved",
      category: "General question",
      assignee: agent.name,
    });

    await choose(page, categorySelect(page), "Uncategorized");
    await reloadTicket(page, ticket);
    await expectFields(page, { status: "Resolved", category: "Uncategorized", assignee: agent.name });

    // And reassigning keeps status and category.
    await choose(page, assigneeSelect(page), "Unassigned");
    await reloadTicket(page, ticket);
    await expectFields(page, { status: "Resolved", category: "Uncategorized", assignee: "Unassigned" });
  });

  test("an admin can change a ticket's status and category", async ({
    adminPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket);

    await choose(page, statusSelect(page), "Closed");
    await choose(page, categorySelect(page), "Technical");

    await reloadTicket(page, ticket);
    await expectFields(page, { status: "Closed", category: "Technical", assignee: "Unassigned" });
  });

  test("a failed save shows the error under the select and keeps the old value", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket);

    // Simulate the server rejecting the update.
    await page.route(`**/api/tickets/${ticket.id}`, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, json: { error: "Database unavailable" } })
        : route.fallback(),
    );

    await statusSelect(page).click();
    await page.getByRole("option", { name: "Closed", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Database unavailable");
    await expect(selectedValue(statusSelect(page))).toHaveText("Open");
    await expect(statusSelect(page)).toBeEnabled();

    await page.unroute(`**/api/tickets/${ticket.id}`);
    await reloadTicket(page, ticket);
    await expectFields(page, { status: "Open", category: "Uncategorized", assignee: "Unassigned" });
  });
});
