import type { Page, Request } from "@playwright/test";
import { ADMIN, expect, test } from "./fixtures.ts";

// The reply thread on the ticket detail page (/tickets/:id): GET/POST /api/tickets/:id/replies,
// rendered by TicketReplies + TicketReplyForm. Each test creates its own ticket, so the thread
// starts empty; replies are cascade-deleted with the ticket by the createTicket fixture.
// (Signed-out redirect from /tickets/:id is covered in ticket-detail.spec.ts.)

const subjectHeading = (page: Page, subject: string) =>
  page.getByRole("heading", { name: subject, level: 1 });
const repliesSection = (page: Page) =>
  page.getByRole("region", { name: "Replies" });
const replyThread = (page: Page) => page.getByRole("list", { name: "Reply thread" });
const replyItems = (page: Page) => replyThread(page).getByRole("listitem");
const noReplies = (page: Page) => page.getByText("No replies yet.");
const replyField = (page: Page) => page.getByRole("textbox", { name: "Reply" });
const sendButton = (page: Page) => page.getByRole("button", { name: "Send reply" });

async function openTicket(page: Page, id: string, subject: string) {
  await page.goto(`/tickets/${id}`);
  await expect(subjectHeading(page, subject)).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading replies" })).toBeHidden();
}

test.describe("ticket replies", () => {
  test("an agent sends a multi-line reply; it appears with their name and survives a reload", async ({
    agentPage: page,
    agent,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket.id, ticket.subject);

    await expect(repliesSection(page).getByRole("heading", { name: "Replies" })).toBeVisible();
    await expect(noReplies(page)).toBeVisible();

    const tag = crypto.randomUUID();
    const lines = ["Hi there,", `Please clear your browser cache and retry. [${tag}]`, "Thanks, Support"];
    await replyField(page).fill(lines.join("\n"));
    await sendButton(page).click();

    await expect(replyItems(page)).toHaveCount(1);
    const reply = replyItems(page).first();
    await expect(reply).toContainText(agent.name);
    for (const line of lines) await expect(reply).toContainText(line);
    // The body keeps its line breaks (toContainText normalizes whitespace, innerText doesn't).
    expect(await reply.getByText(tag).innerText()).toBe(lines.join("\n"));
    await expect(reply.locator("time")).toBeVisible();
    await expect(noReplies(page)).toBeHidden();
    await expect(replyField(page)).toHaveValue("");

    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(replyItems(page)).toHaveCount(1);
    await expect(replyItems(page).first()).toContainText(agent.name);
    await expect(replyItems(page).first()).toContainText(tag);
    await expect(noReplies(page)).toBeHidden();
  });

  test("replies from different users are listed oldest first, each with its author", async ({
    agentPage: page,
    agent,
    adminApi,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket.id, ticket.subject);

    const first = `Agent reply ${crypto.randomUUID()}`;
    await replyField(page).fill(first);
    await sendButton(page).click();
    await expect(replyItems(page)).toHaveCount(1);

    // The admin replies from another session.
    const second = `Admin reply ${crypto.randomUUID()}`;
    const res = await adminApi.post(`/api/tickets/${ticket.id}/replies`, { data: { body: second } });
    expect(res.status(), await res.text()).toBe(201);

    await page.reload();
    await expect(replyItems(page)).toHaveCount(2);
    await expect(replyItems(page).nth(0)).toContainText(agent.name);
    await expect(replyItems(page).nth(0)).toContainText(first);
    await expect(replyItems(page).nth(1)).toContainText(ADMIN.name);
    await expect(replyItems(page).nth(1)).toContainText(second);
  });

  test("an empty or whitespace-only reply shows a validation error and posts nothing", async ({
    agentPage: page,
    createTicket,
  }) => {
    const ticket = await createTicket();
    await openTicket(page, ticket.id, ticket.subject);

    const posts: Request[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes(`/api/tickets/${ticket.id}/replies`)) {
        posts.push(req);
      }
    });

    await sendButton(page).click();
    await expect(page.getByText("Write a reply first")).toBeVisible();
    await expect(replyField(page)).toHaveAttribute("aria-invalid", "true");

    await replyField(page).fill("   \n\t  \n");
    await sendButton(page).click();
    await expect(page.getByText("Write a reply first")).toBeVisible();

    await expect(noReplies(page)).toBeVisible();
    expect(posts).toHaveLength(0);

    // Nothing was saved on the server either.
    await page.reload();
    await expect(subjectHeading(page, ticket.subject)).toBeVisible();
    await expect(noReplies(page)).toBeVisible();
    expect(posts).toHaveLength(0);
  });
});
