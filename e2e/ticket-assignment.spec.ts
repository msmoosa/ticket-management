import type { APIRequestContext, Page } from "@playwright/test";
import { ADMIN, expect, test, type Ticket } from "./fixtures.ts";

// The "Assigned to" select on the ticket detail page (TicketAssignee.tsx) lists "Unassigned" plus
// every active user (GET /api/tickets/assignees) and saves on change (PATCH /api/tickets/:id).
// Users created by other tests share the DB, so options are always looked up by this test's
// unique user names.

const assigneeSelect = (page: Page) => page.getByRole("combobox", { name: "Assigned to" });
/** The selected value shown in the trigger (the trigger's own text also includes its chevron). */
const assigneeValue = (page: Page) =>
  assigneeSelect(page).locator('[data-slot="select-value"]');
const option = (page: Page, name: string) => page.getByRole("option", { name, exact: true });
const subjectHeading = (page: Page, subject: string) =>
  page.getByRole("heading", { name: subject, level: 1 });

async function openTicket(page: Page, ticket: Ticket) {
  await page.goto(`/tickets/${ticket.id}`);
  await expect(subjectHeading(page, ticket.subject)).toBeVisible();
}

/** Pick an assignee and wait for the save to finish (the select is disabled while saving). */
async function assignTo(page: Page, name: string) {
  await assigneeSelect(page).click();
  await option(page, name).click();
  await expect(assigneeValue(page)).toHaveText(name);
  await expect(assigneeSelect(page)).toBeEnabled();
}

async function apiAssign(api: APIRequestContext, ticketId: string, assignedToId: string | null) {
  const res = await api.patch(`/api/tickets/${ticketId}`, { data: { assignedToId } });
  expect(res.status(), `assign ticket: ${await res.text()}`).toBe(200);
}

async function apiDeleteUser(adminApi: APIRequestContext, userId: string) {
  const res = await adminApi.delete(`/api/users/${userId}`);
  expect(res.status(), `delete user: ${await res.text()}`).toBe(204);
}

test.describe("ticket assignment", () => {
  test("an agent assigns an unassigned ticket to themselves and it persists", async ({
    agentPage: page,
    agent,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket);

    await expect(assigneeValue(page)).toHaveText("Unassigned");
    await expect(assigneeSelect(page)).toBeEnabled();

    await assignTo(page, agent.name);

    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(assigneeValue(page)).toHaveText(agent.name);
  });

  test("an agent reassigns a ticket to another user, then unassigns it", async ({
    agentPage: page,
    agent,
    createUser,
    createTicket,
    adminApi,
  }) => {
    const colleague = await createUser({ role: "agent" });
    const ticket = await createTicket();
    await apiAssign(adminApi, ticket.id, agent.id);
    await openTicket(page, ticket);
    await expect(assigneeValue(page)).toHaveText(agent.name);

    await assignTo(page, colleague.name);
    await page.reload();
    await expect(assigneeValue(page)).toHaveText(colleague.name);

    // Admins are assignable too.
    await assignTo(page, ADMIN.name);
    await page.reload();
    await expect(assigneeValue(page)).toHaveText(ADMIN.name);

    await assignTo(page, "Unassigned");
    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(assigneeValue(page)).toHaveText("Unassigned");
  });

  test("an admin can assign a ticket to an agent", async ({
    adminPage: page,
    agent,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket);
    await expect(assigneeValue(page)).toHaveText("Unassigned");

    await assignTo(page, agent.name);

    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(assigneeValue(page)).toHaveText(agent.name);
  });

  test("deleted users are not offered as assignees", async ({
    agentPage: page,
    agent,
    createUser,
    createTicket,
    adminApi,
  }) => {
    const deleted = await createUser({ role: "agent" });
    await apiDeleteUser(adminApi, deleted.id);
    const ticket = await createTicket();
    await openTicket(page, ticket);

    await assigneeSelect(page).click();
    await expect(option(page, "Unassigned")).toBeVisible();
    await expect(option(page, agent.name)).toBeAttached();
    await expect(option(page, deleted.name)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("a ticket assigned to a user who is then deleted shows Unassigned", async ({
    agentPage: page,
    createUser,
    createTicket,
    adminApi,
  }) => {
    const leaver = await createUser({ role: "agent" });
    const ticket = await createTicket();
    await apiAssign(adminApi, ticket.id, leaver.id);
    await openTicket(page, ticket);
    await expect(assigneeValue(page)).toHaveText(leaver.name);

    await apiDeleteUser(adminApi, leaver.id);

    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(assigneeValue(page)).toHaveText("Unassigned");
    await assigneeSelect(page).click();
    await expect(option(page, "Unassigned")).toBeVisible();
    await expect(option(page, leaver.name)).toHaveCount(0);
  });

  test("assigning to a user deleted after the page loaded shows the server error", async ({
    agentPage: page,
    createUser,
    createTicket,
    adminApi,
  }) => {
    const leaver = await createUser({ role: "agent" });
    const ticket = await createTicket();
    await openTicket(page, ticket);
    await expect(assigneeSelect(page)).toBeEnabled(); // assignees (including `leaver`) loaded

    await apiDeleteUser(adminApi, leaver.id);

    await assigneeSelect(page).click();
    await option(page, leaver.name).click();

    await expect(page.getByRole("alert")).toHaveText("Assignee must be an active user");
    await expect(assigneeValue(page)).toHaveText("Unassigned");
    await expect(assigneeSelect(page)).toBeEnabled();

    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(assigneeValue(page)).toHaveText("Unassigned");
  });
});
