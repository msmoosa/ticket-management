import type { Locator, Page } from "@playwright/test";
import { dashboardHeading, expect, test, ticketsHeading } from "./fixtures.ts";

// The dashboard (/) shows counts over the whole shared test DB, so count assertions compare
// before/after deltas around tickets this test creates (tests run serially, one worker).

const main = (page: Page) => page.getByRole("main");
const statsLoading = (page: Page) => page.getByRole("status", { name: "Loading ticket stats" });

/** A stat tile or category row: a link whose text is the label followed by its count. */
const countLink = (page: Page, label: string) =>
  main(page).getByRole("link", { name: new RegExp(`^${label}\\s*[\\d,]+$`) });

const chart = (page: Page) =>
  page.getByRole("group", {
    name: "Tickets received per day. Use the arrow keys to read each day.",
  });
const chartTable = (page: Page) => page.getByRole("table", { name: "Tickets received per day" });
const todayCell = (page: Page) =>
  chartTable(page).getByRole("row", { name: /^Today\b/ }).getByRole("cell");
const recentList = (page: Page) => page.getByRole("list", { name: "Recent tickets" });

const tickets = (n: number) => `${n} ${n === 1 ? "ticket" : "tickets"}`;

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(dashboardHeading(page)).toBeVisible();
  await expect(statsLoading(page)).toHaveCount(0);
}

/** The number shown in a count link (stat tile or category row), once loaded. */
async function readCount(link: Locator): Promise<number> {
  await expect(link).toBeVisible();
  const text = (await link.textContent()) ?? "";
  const match = /([\d,]+)\s*$/.exec(text);
  expect(match, `count in "${text}"`).not.toBeNull();
  return Number(match![1]!.replace(/,/g, ""));
}

async function readTodayCount(page: Page): Promise<number> {
  await expect(todayCell(page)).toHaveText(/^\d+$/);
  return Number(await todayCell(page).textContent());
}

async function expectCount(link: Locator, label: string, count: number) {
  await expect(link).toHaveText(new RegExp(`^${label}\\s*${count.toLocaleString("en-US")}$`));
}

test.describe("dashboard", () => {
  test("an agent sees counts and recent tickets that reflect new tickets", async ({
    agentPage: page,
    createTicket,
    setTicketTimes,
  }) => {
    await expect(page).toHaveURL("/");
    await expect(statsLoading(page)).toHaveCount(0);

    const open = countLink(page, "Open");
    const waiting = countLink(page, "Waiting a day or more");
    const uncategorized = countLink(page, "Uncategorized");
    const openBefore = await readCount(open);
    const waitingBefore = await readCount(waiting);
    const uncategorizedBefore = await readCount(uncategorized);
    const todayBefore = await readTodayCount(page);

    const tag = crypto.randomUUID();
    const older = await createTicket({ subject: `Dashboard older [${tag}]` });
    // Make the first ticket's sender look like they've waited two days (it stays created today).
    setTicketTimes(older.id, {
      awaitingReplySince: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const newest = await createTicket({ subject: `Dashboard newest [${tag}]` });

    await openDashboard(page);
    await expectCount(open, "Open", openBefore + 2);
    await expectCount(waiting, "Waiting a day or more", waitingBefore + 1);
    await expectCount(uncategorized, "Uncategorized", uncategorizedBefore + 2);
    await expect(todayCell(page)).toHaveText(String(todayBefore + 2));

    // The chart card's 30-day total includes today's tickets.
    await expect(main(page).getByText(/a day on average$/)).toBeVisible();

    const items = recentList(page).getByRole("listitem");
    await expect(items.first()).toContainText(newest.subject);
    await expect(items.nth(1)).toContainText(older.subject);
    await expect(items.first().getByText("Open", { exact: true })).toBeVisible();
  });

  test("the Resolved tile opens the ticket list filtered to resolved tickets", async ({
    agentPage: page,
    createTicket,
    setTicketStatus,
  }) => {
    const resolved = countLink(page, "Resolved");
    const before = await readCount(resolved);
    const ticket = await createTicket({ subject: `Dashboard resolved [${crypto.randomUUID()}]` });
    setTicketStatus(ticket.id, "resolved");

    await openDashboard(page);
    await expectCount(resolved, "Resolved", before + 1);
    await resolved.click();

    await expect(page).toHaveURL("/tickets?status=resolved");
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Status" }).locator('[data-slot="select-value"]'),
    ).toHaveText("Resolved");
    await expect(page.getByRole("row").filter({ hasText: ticket.subject })).toBeVisible();
  });

  test("the Open and Closed tiles link to the matching status filters", async ({
    agentPage: page,
  }) => {
    await countLink(page, "Open").click();
    await expect(page).toHaveURL("/tickets?status=open");
    await expect(ticketsHeading(page)).toBeVisible();

    await openDashboard(page);
    await countLink(page, "Closed").click();
    await expect(page).toHaveURL("/tickets?status=closed");
    await expect(ticketsHeading(page)).toBeVisible();
  });

  test("a category row opens the ticket list filtered to that category", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
  }) => {
    const refund = countLink(page, "Refund");
    const before = await readCount(refund);
    const ticket = await createTicket({ subject: `Dashboard refund [${crypto.randomUUID()}]` });
    setTicketCategory(ticket.id, "refund_request");

    await openDashboard(page);
    await expectCount(refund, "Refund", before + 1);
    await refund.click();

    await expect(page).toHaveURL("/tickets?category=refund_request");
    await expect(ticketsHeading(page)).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Category" }).locator('[data-slot="select-value"]'),
    ).toHaveText("Refund");
    await expect(page.getByRole("row").filter({ hasText: ticket.subject })).toBeVisible();
  });

  test("clicking a recent ticket's subject opens its detail page", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket({ subject: `Dashboard detail [${crypto.randomUUID()}]` });
    await openDashboard(page);

    await recentList(page).getByRole("link", { name: ticket.subject }).click();
    await expect(page).toHaveURL(`/tickets/${ticket.id}`);
    await expect(page.getByRole("heading", { name: ticket.subject, level: 1 })).toBeVisible();
  });

  test("View all opens the ticket list", async ({ agentPage: page }) => {
    await main(page).getByRole("link", { name: "View all" }).click();
    await expect(page).toHaveURL("/tickets");
    await expect(ticketsHeading(page)).toBeVisible();
  });

  test("the chart can be read with the keyboard", async ({ agentPage: page, createTicket }) => {
    await createTicket();
    await openDashboard(page);

    const today = await readTodayCount(page);
    expect(today).toBeGreaterThan(0);
    // The day before today is the second-to-last row of the chart's table.
    const yesterdayRow = chartTable(page).getByRole("row").nth(-2);
    const yesterdayLabel = (await yesterdayRow.getByRole("rowheader").textContent())!;
    const yesterdayCount = Number(await yesterdayRow.getByRole("cell").textContent());

    // The Closed tile is the last focusable element before the chart.
    await countLink(page, "Closed").focus();
    await page.keyboard.press("Tab");
    await expect(chart(page)).toBeFocused();
    await expect(chart(page).getByText("Today, so far")).toBeVisible();
    await expect(chart(page).getByText(tickets(today), { exact: true })).toBeVisible();
    await expect(page.getByText(`Today: ${tickets(today)}`)).toBeAttached();

    await page.keyboard.press("ArrowLeft");
    await expect(chart(page).getByText("Today, so far")).toHaveCount(0);
    await expect(chart(page).getByText(yesterdayLabel, { exact: true })).toBeVisible();
    await expect(chart(page).getByText(tickets(yesterdayCount), { exact: true })).toBeVisible();

    await page.keyboard.press("End");
    await expect(chart(page).getByText("Today, so far")).toBeVisible();

    // Leaving the chart hides the tooltip.
    await page.keyboard.press("Tab");
    await expect(chart(page).getByText("Today, so far")).toHaveCount(0);
  });

  test("hovering today's column shows its tooltip", async ({ agentPage: page }) => {
    const today = await readTodayCount(page);
    const box = (await chart(page).boundingBox())!;
    await chart(page).hover({ position: { x: box.width - 2, y: box.height / 2 } });
    await expect(chart(page).getByText("Today, so far")).toBeVisible();
    await expect(chart(page).getByText(tickets(today), { exact: true })).toBeVisible();
  });
});
