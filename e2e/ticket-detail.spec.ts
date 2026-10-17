import type { Page } from "@playwright/test";
import { expect, loginEmailField, signInViaForm, test, ticketsHeading } from "./fixtures.ts";

// The ticket detail page (/tickets/:id) is opened from the subject link on the tickets list and
// loads GET /api/tickets/:id. Other tests' tickets may share the DB, so list assertions are
// scoped to this test's unique subjects (or a search for its unique tag).

const backLink = (page: Page) => page.getByRole("link", { name: "Back to tickets" });
const subjectHeading = (page: Page, subject: string) =>
  page.getByRole("heading", { name: subject, level: 1 });
/** The <dd> paired with a <dt> label in the detail page's metadata list. */
const detail = (page: Page, label: string) =>
  page
    .locator("dl > div")
    .filter({ has: page.getByRole("term").filter({ hasText: label }) })
    .getByRole("definition");
const statusSelect = (page: Page) => page.getByRole("combobox", { name: "Status" });
const columnHeader = (page: Page, name: string) =>
  page.getByRole("columnheader", { name, exact: true });

/** Format a date the way the page does, in the browser's locale and time zone. */
function formatReceived(page: Page, iso: string) {
  return page.evaluate(
    (value) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      ),
    iso,
  );
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

test.describe("ticket detail page", () => {
  test("an agent opens a ticket from the list and sees its details", async ({
    agentPage: page,
    createTicket,
    setTicketCategory,
  }) => {
    const tag = crypto.randomUUID();
    const email = `ada-${tag}@example.com`;
    const ticket = await createTicket({
      from: email,
      fromName: "Ada Student",
      subject: `Cannot open quiz [${tag}]`,
      text: "Hi,\nThe quiz page shows a blank screen.\nThanks, Ada",
    });
    setTicketCategory(ticket.id, "technical_question");

    await page.goto(`/tickets?search=${tag}`);
    await expect(ticketsHeading(page)).toBeVisible();
    await page.getByRole("link", { name: ticket.subject }).click();

    await expect(page).toHaveURL(`/tickets/${ticket.id}`);
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(page.getByText("Open", { exact: true })).toBeVisible();
    await expect(page.getByText("Technical", { exact: true })).toBeVisible();
    await expect(detail(page, "From")).toHaveText(`Ada Student <${email}>`);
    await expect(detail(page, "Received")).toHaveText(await formatReceived(page, ticket.createdAt));
    const body = page.getByText("The quiz page shows a blank screen.");
    await expect(body).toBeVisible();
    await expect(body).toContainText("Hi,");
    await expect(body).toContainText("Thanks, Ada");

    await backLink(page).click();
    await expectTicketsUrl(page, { search: tag });
    await expect(page.getByRole("link", { name: ticket.subject })).toBeVisible();
  });

  test("a ticket without a sender name or category shows the email and Uncategorized", async ({
    agentPage: page,
    createTicket,
    setTicketStatus,
  }) => {
    const ticket = await createTicket({ text: "Where is my refund?" });
    setTicketStatus(ticket.id, "resolved");

    await page.goto(`/tickets/${ticket.id}`);

    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
    await expect(page.getByText("Uncategorized", { exact: true })).toBeVisible();
    await expect(detail(page, "From")).toHaveText(ticket.fromEmail);
    await expect(page.getByText("Where is my refund?")).toBeVisible();
  });

  test("Back to tickets returns to the list with the same filter and sort", async ({
    agentPage: page,
    createTicket,
    setTicketStatus,
  }) => {
    const tag = crypto.randomUUID();
    const alpha = await createTicket({ subject: `Alpha resolved [${tag}]` });
    const beta = await createTicket({ subject: `Beta resolved [${tag}]` });
    const open = await createTicket({ subject: `Gamma open [${tag}]` });
    setTicketStatus(alpha.id, "resolved");
    setTicketStatus(beta.id, "resolved");

    await page.goto(`/tickets?search=${tag}`);
    await expect(page.getByRole("link", { name: open.subject })).toBeVisible();

    // Filter to resolved tickets through the UI.
    await statusSelect(page).click();
    await page.getByRole("option", { name: "Resolved", exact: true }).click();
    await expect(page.getByRole("link", { name: open.subject })).toBeHidden();

    // Sort by subject, A→Z.
    await columnHeader(page, "Subject").getByRole("button").click();
    await expect(columnHeader(page, "Subject")).toHaveAttribute("aria-sort", "ascending");
    const expected = { search: tag, status: "resolved", sortBy: "subject", sortOrder: "asc" };
    await expectTicketsUrl(page, expected);

    await page.getByRole("link", { name: beta.subject }).click();
    await expect(page).toHaveURL(`/tickets/${beta.id}`);
    await expect(subjectHeading(page, beta.subject)).toBeVisible();

    await backLink(page).click();
    await expectTicketsUrl(page, expected);
    await expect(statusSelect(page).locator('[data-slot="select-value"]')).toHaveText("Resolved");
    await expect(columnHeader(page, "Subject")).toHaveAttribute("aria-sort", "ascending");
    await expect(page.getByRole("searchbox", { name: "Search tickets" })).toHaveValue(tag);
    const subjects = page.getByRole("row").filter({ hasText: tag }).getByRole("link");
    await expect(subjects).toHaveText([alpha.subject, beta.subject]);
  });

  test("an unknown ticket id shows Ticket not found, and Back goes to /tickets", async ({
    agentPage: page,
  }) => {
    await page.goto(`/tickets/does-not-exist-${crypto.randomUUID()}`);

    await expect(page.getByRole("alert")).toHaveText("Ticket not found");
    await expect(backLink(page)).toHaveAttribute("href", "/tickets");

    await backLink(page).click();
    await expectTicketsUrl(page, {});
    await expect(ticketsHeading(page)).toBeVisible();
  });

  test("signed out, a ticket link redirects to /login and returns to the ticket after sign-in", async ({
    page,
    agent,
    createTicket,
  }) => {
    const ticket = await createTicket();

    await page.goto(`/tickets/${ticket.id}`);

    await expect(page).toHaveURL("/login");
    await expect(loginEmailField(page)).toBeVisible();
    await expect(subjectHeading(page, ticket.subject)).toBeHidden();

    await signInViaForm(page, agent);
    await expect(page).toHaveURL(`/tickets/${ticket.id}`);
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
  });
});
