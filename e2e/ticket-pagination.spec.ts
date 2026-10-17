import type { Locator, Page } from "@playwright/test";
import { expect, test, ticketsHeading, type Ticket } from "./fixtures.ts";

// Pagination is done by the server (GET /api/tickets?page=…&pageSize=…) and the page and page
// size live in the page URL (defaults page=1 and pageSize=25 are left out). Other tests' tickets
// may share the DB, so every test searches for its own unique tag, which makes the totals exact.

const nav = (page: Page) => page.getByRole("navigation", { name: "Pagination" });
const rangeText = (page: Page) => nav(page).getByText(/^Showing /);
const pageText = (page: Page) => nav(page).getByText(/^Page \d+ of \d+$/);
const firstButton = (page: Page) => nav(page).getByRole("button", { name: "First page" });
const previousButton = (page: Page) => nav(page).getByRole("button", { name: "Previous page" });
const nextButton = (page: Page) => nav(page).getByRole("button", { name: "Next page" });
const lastButton = (page: Page) => nav(page).getByRole("button", { name: "Last page" });
const rowsPerPage = (page: Page) => page.getByRole("combobox", { name: "Rows per page" });
const statusSelect = (page: Page) => page.getByRole("combobox", { name: "Status" });
const columnHeader = (page: Page, name: string) =>
  page.getByRole("columnheader", { name, exact: true });
const taggedRows = (page: Page, tag: string) => page.getByRole("row").filter({ hasText: tag });
// Rows start with the Waiting cell, so row order is asserted on each row's subject link.
const subjectLinks = (rows: Locator) => rows.getByRole("link");

type SelectTrigger = ReturnType<typeof rowsPerPage>;

/** The trigger also holds Base UI's dropdown icon, so check the shadcn value slot. */
async function expectSelected(select: SelectTrigger, label: string) {
  await expect(select.locator('[data-slot="select-value"]')).toHaveText(label);
}

/** Open a Base UI select and pick an option by its label. */
async function choose(select: SelectTrigger, page: Page, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expectSelected(select, option);
}

/** Assert the page is /tickets with exactly these query params (in any order). */
async function expectTicketsUrl(page: Page, expected: Record<string, string>) {
  await expect(page).toHaveURL((url) => {
    if (url.pathname !== "/tickets") return false;
    const actual = Object.fromEntries(url.searchParams);
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    return [...keys].every((key) => actual[key] === expected[key]);
  });
}

async function openTickets(page: Page, params: Record<string, string>) {
  await page.goto(`/tickets?${new URLSearchParams(params)}`);
  await expect(ticketsHeading(page)).toBeVisible();
}

/**
 * Create `count` tickets, oldest first, with subjects `Ticket 01 [<tag>]`, `Ticket 02 [<tag>]`, …
 * so newest first is the highest number first. Returns the tag.
 */
async function createNumbered(createTicket: (e: { subject: string }) => Promise<Ticket>, count: number) {
  const tag = crypto.randomUUID();
  for (let i = 1; i <= count; i++) {
    await createTicket({ subject: `${label(i)} [${tag}]` });
  }
  return tag;
}

const label = (n: number) => `Ticket ${String(n).padStart(2, "0")}`;

/** Row matchers for tickets `from` down to `to` (or up, if `from < to`). */
function subjects(from: number, to: number) {
  const step = from <= to ? 1 : -1;
  const out: RegExp[] = [];
  for (let n = from; n !== to + step; n += step) out.push(new RegExp(`^${label(n)} `));
  return out;
}

async function expectPage(
  page: Page,
  { range, current, pages }: { range: string; current: number; pages: number },
) {
  await expect(rangeText(page)).toHaveText(range);
  await expect(pageText(page)).toHaveText(`Page ${current} of ${pages}`);
  const atStart = current === 1;
  const atEnd = current === pages;
  for (const [button, disabled] of [
    [firstButton(page), atStart],
    [previousButton(page), atStart],
    [nextButton(page), atEnd],
    [lastButton(page), atEnd],
  ] as const) {
    if (disabled) await expect(button).toBeDisabled();
    else await expect(button).toBeEnabled();
  }
}

test.describe("ticket list pagination", () => {
  test("first, previous, next and last move between pages and update the URL", async ({
    agentPage: page,
    createTicket,
  }) => {
    // 21 tickets at 10 per page: three pages, so First/Previous and Next/Last differ.
    const tag = await createNumbered(createTicket, 21);
    const rows = taggedRows(page, tag);

    await openTickets(page, { search: tag, pageSize: "10" });
    await expectSelected(rowsPerPage(page), "10");
    await expectPage(page, { range: "Showing 1–10 of 21", current: 1, pages: 3 });
    await expect(subjectLinks(rows)).toHaveText(subjects(21, 12));

    await nextButton(page).click();
    await expectTicketsUrl(page, { search: tag, pageSize: "10", page: "2" });
    await expectPage(page, { range: "Showing 11–20 of 21", current: 2, pages: 3 });
    await expect(subjectLinks(rows)).toHaveText(subjects(11, 2));

    await nextButton(page).click();
    await expectTicketsUrl(page, { search: tag, pageSize: "10", page: "3" });
    await expectPage(page, { range: "Showing 21–21 of 21", current: 3, pages: 3 });
    await expect(subjectLinks(rows)).toHaveText(subjects(1, 1));

    await previousButton(page).click();
    await expectTicketsUrl(page, { search: tag, pageSize: "10", page: "2" });
    await expectPage(page, { range: "Showing 11–20 of 21", current: 2, pages: 3 });
    await expect(subjectLinks(rows)).toHaveText(subjects(11, 2));

    // Page 1 is the default, so it drops out of the URL.
    await firstButton(page).click();
    await expectTicketsUrl(page, { search: tag, pageSize: "10" });
    await expectPage(page, { range: "Showing 1–10 of 21", current: 1, pages: 3 });
    await expect(subjectLinks(rows)).toHaveText(subjects(21, 12));

    await lastButton(page).click();
    await expectTicketsUrl(page, { search: tag, pageSize: "10", page: "3" });
    await expectPage(page, { range: "Showing 21–21 of 21", current: 3, pages: 3 });
    await expect(subjectLinks(rows)).toHaveText(subjects(1, 1));
  });

  test("changing rows per page returns to page 1 and changes the row count", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = await createNumbered(createTicket, 12);
    const rows = taggedRows(page, tag);

    await openTickets(page, { search: tag, pageSize: "10", page: "2" });
    await expectPage(page, { range: "Showing 11–12 of 12", current: 2, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(2, 1));

    // 25 is the default page size, so both page and pageSize drop out of the URL.
    await choose(rowsPerPage(page), page, "25");
    await expectTicketsUrl(page, { search: tag });
    await expectPage(page, { range: "Showing 1–12 of 12", current: 1, pages: 1 });
    await expect(rows).toHaveCount(12);
    await expect(subjectLinks(rows)).toHaveText(subjects(12, 1));

    await choose(rowsPerPage(page), page, "10");
    await expectTicketsUrl(page, { search: tag, pageSize: "10" });
    await expectPage(page, { range: "Showing 1–10 of 12", current: 1, pages: 2 });
    await expect(rows).toHaveCount(10);
    await expect(subjectLinks(rows)).toHaveText(subjects(12, 3));
  });

  test("defaults to 25 rows per page", async ({ agentPage: page, createTicket }) => {
    const tag = await createNumbered(createTicket, 26);
    const rows = taggedRows(page, tag);

    await openTickets(page, { search: tag });
    await expectSelected(rowsPerPage(page), "25");
    await expectPage(page, { range: "Showing 1–25 of 26", current: 1, pages: 2 });
    await expect(rows).toHaveCount(25);

    await nextButton(page).click();
    await expectTicketsUrl(page, { search: tag, page: "2" });
    await expectPage(page, { range: "Showing 26–26 of 26", current: 2, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(1, 1));
  });

  test("sorting or filtering goes back to page 1 and keeps the page size", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = await createNumbered(createTicket, 12);
    const rows = taggedRows(page, tag);

    await openTickets(page, { search: tag, pageSize: "10", page: "2" });
    await expectPage(page, { range: "Showing 11–12 of 12", current: 2, pages: 2 });

    await columnHeader(page, "Subject").getByRole("button", { name: "Subject" }).click();
    await expectTicketsUrl(page, {
      search: tag,
      pageSize: "10",
      sortBy: "subject",
      sortOrder: "asc",
    });
    await expect(columnHeader(page, "Subject")).toHaveAttribute("aria-sort", "ascending");
    await expectPage(page, { range: "Showing 1–10 of 12", current: 1, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(1, 10));

    await nextButton(page).click();
    await expectTicketsUrl(page, {
      search: tag,
      pageSize: "10",
      sortBy: "subject",
      sortOrder: "asc",
      page: "2",
    });
    await expectPage(page, { range: "Showing 11–12 of 12", current: 2, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(11, 12));

    // Every ticket is open, so the filter keeps all 12 but still starts over at page 1.
    await choose(statusSelect(page), page, "Open");
    await expectTicketsUrl(page, {
      search: tag,
      status: "open",
      pageSize: "10",
      sortBy: "subject",
      sortOrder: "asc",
    });
    await expectPage(page, { range: "Showing 1–10 of 12", current: 1, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(1, 10));
  });

  test("a deep link opens that page, and a page past the end lands on the last page", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = await createNumbered(createTicket, 12);
    const rows = taggedRows(page, tag);

    await openTickets(page, { search: tag, page: "2", pageSize: "10" });
    await expectSelected(rowsPerPage(page), "10");
    await expectPage(page, { range: "Showing 11–12 of 12", current: 2, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(2, 1));
    // Loading the page doesn't rewrite a valid URL.
    await expectTicketsUrl(page, { search: tag, page: "2", pageSize: "10" });

    await openTickets(page, { search: tag, pageSize: "10" });
    await expectPage(page, { range: "Showing 1–10 of 12", current: 1, pages: 2 });

    await openTickets(page, { search: tag, page: "5", pageSize: "10" });
    await expectTicketsUrl(page, { search: tag, page: "2", pageSize: "10" });
    await expectPage(page, { range: "Showing 11–12 of 12", current: 2, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(2, 1));

    // The redirect replaced the out-of-range entry, so Back skips it.
    await page.goBack();
    await expectTicketsUrl(page, { search: tag, pageSize: "10" });
    await expectPage(page, { range: "Showing 1–10 of 12", current: 1, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(12, 3));
  });

  test("browser back and forward move between visited pages", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = await createNumbered(createTicket, 12);
    const rows = taggedRows(page, tag);

    await openTickets(page, { search: tag, pageSize: "10" });
    await expectPage(page, { range: "Showing 1–10 of 12", current: 1, pages: 2 });

    await nextButton(page).click();
    await expectTicketsUrl(page, { search: tag, pageSize: "10", page: "2" });
    await expect(subjectLinks(rows)).toHaveText(subjects(2, 1));

    await page.goBack();
    await expectTicketsUrl(page, { search: tag, pageSize: "10" });
    await expectPage(page, { range: "Showing 1–10 of 12", current: 1, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(12, 3));

    await page.goForward();
    await expectTicketsUrl(page, { search: tag, pageSize: "10", page: "2" });
    await expectPage(page, { range: "Showing 11–12 of 12", current: 2, pages: 2 });
    await expect(subjectLinks(rows)).toHaveText(subjects(2, 1));
  });

  test("the pagination bar is hidden when no tickets match", async ({ agentPage: page }) => {
    await openTickets(page, { search: `nothing-${crypto.randomUUID()}` });
    await expect(page.getByRole("cell", { name: "No tickets match these filters." })).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
  });
});
