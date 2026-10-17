import type { Page, Request } from "@playwright/test";
import { expect, test, ticketsHeading, type Ticket, type TicketCategory } from "./fixtures.ts";

// Sorting is done by the server (GET /api/tickets?sortBy=…&sortOrder=…); the page only tracks
// which heading is active. Other tests' tickets may share the DB and the list is paginated, so
// each test opens the list searched to its own unique tag (keeping its tickets on page 1 in any
// sort order) and every assertion on row order is scoped to the rows carrying that tag.

const columnHeader = (page: Page, name: string) =>
  page.getByRole("columnheader", { name, exact: true });
const sortButton = (page: Page, name: string) =>
  columnHeader(page, name).getByRole("button", { name, exact: true });
const taggedRows = (page: Page, tag: string) => page.getByRole("row").filter({ hasText: tag });
const COLUMNS = ["Subject", "From", "Category", "Status", "Received"] as const;

/** Assert which heading is sorted (and in which direction); every other heading has no aria-sort. */
async function expectSorted(
  page: Page,
  column: (typeof COLUMNS)[number],
  direction: "ascending" | "descending",
) {
  await expect(columnHeader(page, column)).toHaveAttribute("aria-sort", direction);
  for (const other of COLUMNS.filter((c) => c !== column)) {
    await expect(columnHeader(page, other)).not.toHaveAttribute("aria-sort");
  }
}

/** Wait for the tickets request carrying the given sort params. */
function waitForTicketsRequest(page: Page, sortBy: string, sortOrder: "asc" | "desc") {
  return page.waitForRequest((req: Request) => {
    const url = new URL(req.url());
    return (
      req.method() === "GET" &&
      url.pathname === "/api/tickets" &&
      url.searchParams.get("sortBy") === sortBy &&
      url.searchParams.get("sortOrder") === sortOrder
    );
  });
}

/** Open the ticket list searched to `tag`, so only this test's tickets are listed. */
async function openTickets(page: Page, tag: string) {
  await page.goto(`/tickets?search=${encodeURIComponent(tag)}`);
  await expect(ticketsHeading(page)).toBeVisible();
}

/** Click a heading and wait until the server answered with the expected sort. */
async function clickSort(
  page: Page,
  column: (typeof COLUMNS)[number],
  sortBy: string,
  sortOrder: "asc" | "desc",
) {
  const request = waitForTicketsRequest(page, sortBy, sortOrder);
  await sortButton(page, column).click();
  const response = await (await request).response();
  expect(response?.status()).toBe(200);
}

/**
 * Three tickets created in a non-alphabetical order, so newest-first, A→Z and Z→A are all
 * different orders: created Bravo, Charlie, Alpha (Alpha is newest).
 */
async function createSubjectTickets(createTicket: (e: { subject: string }) => Promise<Ticket>) {
  const tag = crypto.randomUUID();
  for (const word of ["Bravo", "Charlie", "Alpha"]) {
    await createTicket({ subject: `${word} sorting [${tag}]` });
  }
  return tag;
}

test.describe("ticket list sorting", () => {
  test("defaults to newest first with Received marked descending", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = await createSubjectTickets(createTicket);

    const request = waitForTicketsRequest(page, "createdAt", "desc");
    await openTickets(page, tag);
    await request;

    await expectSorted(page, "Received", "descending");
    await expect(taggedRows(page, tag)).toHaveText([/^Alpha/, /^Charlie/, /^Bravo/]);
  });

  test("clicking Subject sorts A to Z, and clicking again Z to A", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = await createSubjectTickets(createTicket);
    await openTickets(page, tag);
    await expect(taggedRows(page, tag)).toHaveText([/^Alpha/, /^Charlie/, /^Bravo/]);

    await clickSort(page, "Subject", "subject", "asc");
    await expectSorted(page, "Subject", "ascending");
    await expect(taggedRows(page, tag)).toHaveText([/^Alpha/, /^Bravo/, /^Charlie/]);

    await clickSort(page, "Subject", "subject", "desc");
    await expectSorted(page, "Subject", "descending");
    await expect(taggedRows(page, tag)).toHaveText([/^Charlie/, /^Bravo/, /^Alpha/]);

    // A third click flips back rather than clearing the sort.
    await clickSort(page, "Subject", "subject", "asc");
    await expectSorted(page, "Subject", "ascending");
    await expect(taggedRows(page, tag)).toHaveText([/^Alpha/, /^Bravo/, /^Charlie/]);
  });

  test("clicking Received after another column returns to newest first", async ({
    agentPage: page,
    createTicket,
  }) => {
    const tag = await createSubjectTickets(createTicket);
    await openTickets(page, tag);

    await clickSort(page, "Subject", "subject", "asc");
    await expectSorted(page, "Subject", "ascending");
    await expect(taggedRows(page, tag)).toHaveText([/^Alpha/, /^Bravo/, /^Charlie/]);

    // Received starts descending on first click.
    await clickSort(page, "Received", "createdAt", "desc");
    await expectSorted(page, "Received", "descending");
    await expect(taggedRows(page, tag)).toHaveText([/^Alpha/, /^Charlie/, /^Bravo/]);

    // And flips to oldest first on the next.
    await clickSort(page, "Received", "createdAt", "asc");
    await expectSorted(page, "Received", "ascending");
    await expect(taggedRows(page, tag)).toHaveText([/^Bravo/, /^Charlie/, /^Alpha/]);
  });

  test("category sort keeps Uncategorized tickets last in both directions", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
  }) => {
    const tag = crypto.randomUUID();
    // Created oldest to newest. Two uncategorized tickets check the createdAt-desc tie-break.
    const specs: [string, TicketCategory | null][] = [
      ["Uncategorized older", null],
      ["Refund", "refund_request"],
      ["General", "general_question"],
      ["Uncategorized newer", null],
      ["Technical", "technical_question"],
    ];
    for (const [label, category] of specs) {
      const ticket = await createTicket({ subject: `${label} [${tag}]` });
      if (category) setTicketCategory(ticket.id, category);
    }

    await openTickets(page, tag);
    const rows = taggedRows(page, tag);
    await expect(rows).toHaveCount(specs.length);

    // Enum declaration order: general_question, technical_question, refund_request.
    await clickSort(page, "Category", "category", "asc");
    await expectSorted(page, "Category", "ascending");
    await expect(rows).toHaveText([
      /^General/,
      /^Technical/,
      /^Refund/,
      /^Uncategorized newer/,
      /^Uncategorized older/,
    ]);

    await clickSort(page, "Category", "category", "desc");
    await expectSorted(page, "Category", "descending");
    await expect(rows).toHaveText([
      /^Refund/,
      /^Technical/,
      /^General/,
      /^Uncategorized newer/,
      /^Uncategorized older/,
    ]);

    // Across the whole page, no categorized row follows an uncategorized one.
    const categoryCells = await page
      .getByRole("row")
      .filter({ has: page.getByRole("cell") })
      .locator("td:nth-child(3)")
      .allTextContents();
    const firstUncategorized = categoryCells.indexOf("Uncategorized");
    expect(firstUncategorized).toBeGreaterThanOrEqual(0);
    expect(categoryCells.slice(firstUncategorized).every((c) => c === "Uncategorized")).toBe(true);
  });
});
