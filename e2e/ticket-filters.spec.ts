import type { Locator, Page } from "@playwright/test";
import {
  expect,
  test,
  ticketsHeading,
  type Ticket,
  type TicketCategory,
  type TicketStatus,
} from "./fixtures.ts";

// Filtering is done by the server (GET /api/tickets?status=…&category=…&search=…) and the
// filter state lives in the page URL. Other tests' tickets may share the DB, so every assertion
// on rows is scoped to rows carrying this test's unique tag (or to a search for that tag).

const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search tickets" });
const statusSelect = (page: Page) => page.getByRole("combobox", { name: "Status" });
const categorySelect = (page: Page) => page.getByRole("combobox", { name: "Category" });
const clearFiltersButton = (page: Page) => page.getByRole("button", { name: "Clear filters" });
const taggedRows = (page: Page, tag: string) => page.getByRole("row").filter({ hasText: tag });
// Rows start with the Waiting cell, so row order is asserted on each row's subject link.
const subjectLinks = (rows: Locator) => rows.getByRole("link");
const noMatches = (page: Page) => page.getByRole("cell", { name: "No tickets match these filters." });
const columnHeader = (page: Page, name: string) =>
  page.getByRole("columnheader", { name, exact: true });

type SelectTrigger = ReturnType<typeof statusSelect>;

/**
 * Assert the label a select trigger shows. The trigger also contains Base UI's dropdown icon
 * (whose text is "▼"), so check the shadcn value slot rather than the whole trigger text.
 */
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

async function openTickets(page: Page, query = "") {
  await page.goto(`/tickets${query}`);
  await expect(ticketsHeading(page)).toBeVisible();
}

type Spec = { label: string; status?: TicketStatus; category?: TicketCategory | null };

/**
 * Create tickets (oldest first) whose subjects are `<label> [<tag>]`, then set their status and
 * category in the test DB. Returns the tag.
 */
async function createTagged(
  fixtures: {
    createTicket: (e: { subject: string }) => Promise<Ticket>;
    setTicketCategory: (id: string, category: TicketCategory | null) => void;
    setTicketStatus: (id: string, status: TicketStatus) => void;
  },
  specs: Spec[],
) {
  const tag = crypto.randomUUID();
  for (const spec of specs) {
    const ticket = await fixtures.createTicket({ subject: `${spec.label} [${tag}]` });
    if (spec.status && spec.status !== "open") fixtures.setTicketStatus(ticket.id, spec.status);
    if (spec.category) fixtures.setTicketCategory(ticket.id, spec.category);
  }
  return tag;
}

test.describe("ticket list filters", () => {
  test("search narrows the list by subject, sender name and sender email", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = crypto.randomUUID();
    const nameTag = crypto.randomUUID().slice(0, 8);
    const emailTag = crypto.randomUUID();
    await createTicket({ subject: `Password reset [${tag}]` });
    await createTicket({ subject: `Course access [${tag}]`, fromName: `Quincy ${nameTag}` });
    await createTicket({ subject: `Invoice copy [${tag}]`, from: `zed-${emailTag}@example.com` });

    await openTickets(page);
    await expect(searchBox(page)).toHaveValue("");
    await expect(clearFiltersButton(page)).toHaveCount(0);
    const rows = taggedRows(page, tag);
    await expect(subjectLinks(rows)).toHaveText([/^Invoice copy/, /^Course access/, /^Password reset/]);

    // Subject (case-insensitive).
    await searchBox(page).fill(`password RESET [${tag}`);
    await expectTicketsUrl(page, { search: `password RESET [${tag}` });
    await expect(subjectLinks(rows)).toHaveText([/^Password reset/]);
    await expect(clearFiltersButton(page)).toBeVisible();

    // Sender name.
    await searchBox(page).fill(`quincy ${nameTag}`);
    await expectTicketsUrl(page, { search: `quincy ${nameTag}` });
    await expect(subjectLinks(rows)).toHaveText([/^Course access/]);

    // Sender email (stored lowercased; the search is case-insensitive). Surrounding spaces are
    // trimmed before they reach the URL.
    await searchBox(page).fill(`  ZED-${emailTag.toUpperCase()}  `);
    await expectTicketsUrl(page, { search: `ZED-${emailTag.toUpperCase()}` });
    await expect(subjectLinks(rows)).toHaveText([/^Invoice copy/]);

    // Emptying the box removes the filter and restores the list.
    await searchBox(page).fill("");
    await expectTicketsUrl(page, {});
    await expect(subjectLinks(rows)).toHaveText([/^Invoice copy/, /^Course access/, /^Password reset/]);
    await expect(clearFiltersButton(page)).toHaveCount(0);
  });

  test("category filter shows only matching tickets, including Uncategorized", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
    setTicketStatus,
  }) => {
    const tag = await createTagged({ createTicket, setTicketCategory, setTicketStatus }, [
      { label: "Uncat", category: null },
      { label: "General", category: "general_question" },
      { label: "Technical", category: "technical_question" },
      { label: "Refund", category: "refund_request" },
    ]);

    await openTickets(page);
    await expectSelected(categorySelect(page), "All categories");
    const rows = taggedRows(page, tag);
    await expect(subjectLinks(rows)).toHaveText([/^Refund/, /^Technical/, /^General/, /^Uncat/]);

    const cases: [string, string, RegExp][] = [
      ["Uncategorized", "uncategorized", /^Uncat/],
      ["General question", "general_question", /^General/],
      ["Technical", "technical_question", /^Technical/],
      ["Refund", "refund_request", /^Refund/],
    ];
    for (const [label, value, row] of cases) {
      await choose(categorySelect(page), page, label);
      await expectTicketsUrl(page, { category: value });
      await expect(subjectLinks(rows)).toHaveText([row]);
    }

    // Back to all categories drops the param.
    await choose(categorySelect(page), page, "All categories");
    await expectTicketsUrl(page, {});
    await expect(subjectLinks(rows)).toHaveText([/^Refund/, /^Technical/, /^General/, /^Uncat/]);
  });

  test("status filter shows only tickets with that status", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
    setTicketStatus,
  }) => {
    const tag = await createTagged({ createTicket, setTicketCategory, setTicketStatus }, [
      { label: "Opened", status: "open" },
      { label: "Resolved one", status: "resolved" },
      { label: "Closed one", status: "closed" },
    ]);

    await openTickets(page);
    await expectSelected(statusSelect(page), "All statuses");
    const rows = taggedRows(page, tag);
    await expect(subjectLinks(rows)).toHaveText([/^Closed one/, /^Resolved one/, /^Opened/]);

    const cases: [TicketStatus, string, RegExp][] = [
      ["open", "Open", /^Opened/],
      ["resolved", "Resolved", /^Resolved one/],
      ["closed", "Closed", /^Closed one/],
    ];
    for (const [value, label, row] of cases) {
      await choose(statusSelect(page), page, label);
      await expectTicketsUrl(page, { status: value });
      await expect(subjectLinks(rows)).toHaveText([row]);
      // The status column agrees with the filter.
      await expect(rows.getByRole("cell").nth(4)).toHaveText(label);
    }

    await choose(statusSelect(page), page, "All statuses");
    await expectTicketsUrl(page, {});
    await expect(rows).toHaveCount(3);
  });

  test("filters combine with each other and with sorting", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
    setTicketStatus,
  }) => {
    // Created oldest to newest, so newest first is Delta, Charlie, Bravo, Alpha.
    const tag = await createTagged({ createTicket, setTicketCategory, setTicketStatus }, [
      { label: "Charlie", status: "open", category: "general_question" },
      { label: "Alpha", status: "open", category: "general_question" },
      { label: "Bravo", status: "closed", category: "general_question" },
      { label: "Delta", status: "open", category: "technical_question" },
    ]);

    await openTickets(page);
    const rows = taggedRows(page, tag);
    await expect(rows).toHaveCount(4);

    await choose(statusSelect(page), page, "Open");
    await expectTicketsUrl(page, { status: "open" });
    await expect(subjectLinks(rows)).toHaveText([/^Delta/, /^Alpha/, /^Charlie/]);

    // Status AND category.
    await choose(categorySelect(page), page, "General question");
    await expectTicketsUrl(page, { status: "open", category: "general_question" });
    await expect(subjectLinks(rows)).toHaveText([/^Alpha/, /^Charlie/]);

    // Status AND category AND search.
    await searchBox(page).fill(`Charlie [${tag}`);
    await expectTicketsUrl(page, {
      status: "open",
      category: "general_question",
      search: `Charlie [${tag}`,
    });
    await expect(subjectLinks(rows)).toHaveText([/^Charlie/]);
    // From here on, search for the whole tag: the list is paginated, so sorting the unsearched
    // list could push this test's tickets off page 1 when the DB holds other tickets.
    await searchBox(page).fill(tag);
    await expectTicketsUrl(page, { status: "open", category: "general_question", search: tag });
    await expect(subjectLinks(rows)).toHaveText([/^Alpha/, /^Charlie/]);

    // Sorting keeps the filters.
    await columnHeader(page, "Subject").getByRole("button", { name: "Subject" }).click();
    await expectTicketsUrl(page, {
      status: "open",
      category: "general_question",
      search: tag,
      sortBy: "subject",
      sortOrder: "asc",
    });
    await expect(columnHeader(page, "Subject")).toHaveAttribute("aria-sort", "ascending");
    await expect(subjectLinks(rows)).toHaveText([/^Alpha/, /^Charlie/]);
    await expectSelected(statusSelect(page), "Open");
    await expectSelected(categorySelect(page), "General question");

    // Filtering keeps the sort.
    await choose(statusSelect(page), page, "All statuses");
    await expectTicketsUrl(page, {
      category: "general_question",
      search: tag,
      sortBy: "subject",
      sortOrder: "asc",
    });
    await expect(columnHeader(page, "Subject")).toHaveAttribute("aria-sort", "ascending");
    await expect(subjectLinks(rows)).toHaveText([/^Alpha/, /^Bravo/, /^Charlie/]);
  });

  test("a deep link with filters pre-applies them", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
    setTicketStatus,
  }) => {
    const tag = await createTagged({ createTicket, setTicketCategory, setTicketStatus }, [
      { label: "Zulu", status: "closed", category: "refund_request" },
      { label: "Yankee", status: "closed", category: "refund_request" },
      { label: "Xray", status: "open", category: "refund_request" },
      { label: "Whiskey", status: "closed", category: "general_question" },
    ]);

    const query = new URLSearchParams({
      status: "closed",
      category: "refund_request",
      search: tag,
      sortBy: "subject",
      sortOrder: "asc",
    });
    await openTickets(page, `?${query}`);

    await expectSelected(statusSelect(page), "Closed");
    await expectSelected(categorySelect(page), "Refund");
    await expect(searchBox(page)).toHaveValue(tag);
    await expect(columnHeader(page, "Subject")).toHaveAttribute("aria-sort", "ascending");
    await expect(clearFiltersButton(page)).toBeVisible();
    await expect(subjectLinks(taggedRows(page, tag))).toHaveText([/^Yankee/, /^Zulu/]);
    // Loading the page doesn't rewrite the URL.
    await expectTicketsUrl(page, Object.fromEntries(query));
  });

  test("a deep link with unknown filter values ignores them", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket();

    await openTickets(page, "?status=pending&category=billing&sortBy=nope&sortOrder=sideways");
    await expectSelected(statusSelect(page), "All statuses");
    await expectSelected(categorySelect(page), "All categories");
    await expect(clearFiltersButton(page)).toHaveCount(0);
    await expect(columnHeader(page, "Received")).toHaveAttribute("aria-sort", "descending");
    await expect(page.getByRole("row").filter({ hasText: ticket.subject })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("shows an empty state when nothing matches, and Clear filters resets but keeps the sort", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
    setTicketStatus,
  }) => {
    // Open and uncategorized, so a Closed + Refund filter matches neither.
    const tag = await createTagged({ createTicket, setTicketCategory, setTicketStatus }, [
      { label: "Bravo" },
      { label: "Alpha" },
    ]);

    await openTickets(page, "?sortBy=subject&sortOrder=asc");
    const rows = taggedRows(page, tag);
    await expect(subjectLinks(rows)).toHaveText([/^Alpha/, /^Bravo/]);
    await expect(clearFiltersButton(page)).toHaveCount(0);

    await searchBox(page).fill(tag);
    await expect(subjectLinks(rows)).toHaveText([/^Alpha/, /^Bravo/]);
    await choose(statusSelect(page), page, "Closed");
    await choose(categorySelect(page), page, "Refund");
    await expectTicketsUrl(page, {
      search: tag,
      status: "closed",
      category: "refund_request",
      sortBy: "subject",
      sortOrder: "asc",
    });
    await expect(noMatches(page)).toBeVisible();
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("No tickets yet.")).toHaveCount(0);

    await clearFiltersButton(page).click();
    await expectTicketsUrl(page, { sortBy: "subject", sortOrder: "asc" });
    await expect(searchBox(page)).toHaveValue("");
    await expectSelected(statusSelect(page), "All statuses");
    await expectSelected(categorySelect(page), "All categories");
    await expect(clearFiltersButton(page)).toHaveCount(0);
    await expect(noMatches(page)).toHaveCount(0);
    await expect(columnHeader(page, "Subject")).toHaveAttribute("aria-sort", "ascending");
    await expect(subjectLinks(rows)).toHaveText([/^Alpha/, /^Bravo/]);
  });

  test("browser back returns to the previous filter state", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
    setTicketStatus,
  }) => {
    const tag = await createTagged({ createTicket, setTicketCategory, setTicketStatus }, [
      { label: "Closed general", status: "closed", category: "general_question" },
      { label: "Open general", category: "general_question" },
      { label: "Open uncategorized" },
    ]);

    await openTickets(page);
    const rows = taggedRows(page, tag);
    await expect(rows).toHaveCount(3);

    await choose(statusSelect(page), page, "Open");
    await expectTicketsUrl(page, { status: "open" });
    await expect(subjectLinks(rows)).toHaveText([/^Open uncategorized/, /^Open general/]);

    await choose(categorySelect(page), page, "Uncategorized");
    await expectTicketsUrl(page, { status: "open", category: "uncategorized" });
    await expect(subjectLinks(rows)).toHaveText([/^Open uncategorized/]);

    await searchBox(page).fill(`nothing-${crypto.randomUUID()}`);
    await expect(noMatches(page)).toBeVisible();

    await page.goBack();
    await expectTicketsUrl(page, { status: "open", category: "uncategorized" });
    await expect(searchBox(page)).toHaveValue("");
    await expect(subjectLinks(rows)).toHaveText([/^Open uncategorized/]);

    await page.goBack();
    await expectTicketsUrl(page, { status: "open" });
    await expectSelected(statusSelect(page), "Open");
    await expectSelected(categorySelect(page), "All categories");
    await expect(subjectLinks(rows)).toHaveText([/^Open uncategorized/, /^Open general/]);

    await page.goBack();
    await expectTicketsUrl(page, {});
    await expectSelected(statusSelect(page), "All statuses");
    await expect(rows).toHaveCount(3);

    await page.goForward();
    await expectTicketsUrl(page, { status: "open" });
    await expectSelected(statusSelect(page), "Open");
    await expect(subjectLinks(rows)).toHaveText([/^Open uncategorized/, /^Open general/]);
  });
});
