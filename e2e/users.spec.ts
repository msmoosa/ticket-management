import type { Page } from "@playwright/test";
import { ADMIN, apiSignIn, authPost, expect, test } from "./fixtures.ts";

const usersHeading = (page: Page) => page.getByRole("heading", { name: "Users", level: 1 });
/** The table row containing `email` (emails are unique, so this matches one row). */
const userRow = (page: Page, email: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: email, exact: true }) });

test.describe("users page (admin)", () => {
  test("lists a new agent and the admin with their role and status", async ({
    adminPage: page,
    createUser,
  }) => {
    const agent = await createUser({ role: "agent" });

    await page.goto("/users");
    await expect(usersHeading(page)).toBeVisible();
    await expect(page.getByRole("columnheader")).toHaveText([
      "Name",
      "Email",
      "Role",
      "Status",
      "Created",
      "Actions",
    ]);

    const agentCells = userRow(page, agent.email).getByRole("cell");
    await expect(agentCells).toHaveCount(6);
    await expect(agentCells.nth(0)).toHaveText(agent.name);
    await expect(agentCells.nth(1)).toHaveText(agent.email);
    await expect(agentCells.nth(2)).toHaveText("Agent");
    await expect(agentCells.nth(3)).toHaveText("Active");
    await expect(agentCells.nth(4)).not.toBeEmpty();
    await expect(
      agentCells.nth(5).getByRole("button", { name: `Edit ${agent.name}` }),
    ).toBeVisible();

    const adminCells = userRow(page, ADMIN.email).getByRole("cell");
    await expect(adminCells.nth(0)).toHaveText(ADMIN.name);
    await expect(adminCells.nth(2)).toHaveText("Admin");
    await expect(adminCells.nth(3)).toHaveText("Active");
  });

  test("shows a banned user as Banned", async ({ adminPage: page, adminApi, createUser }) => {
    const user = await createUser({ role: "agent" });
    const ban = await authPost(adminApi, "admin/ban-user", { userId: user.id });
    expect(ban.status(), await ban.text()).toBe(200);

    await page.goto("/users");

    const cells = userRow(page, user.email).getByRole("cell");
    await expect(cells.nth(3)).toHaveText("Banned");
  });

  test("shows the server error when loading users fails", async ({ adminPage: page }) => {
    await page.route("**/api/users", (route) =>
      route.fulfill({ status: 500, json: { error: "Internal Server Error" } }),
    );

    await page.goto("/users");

    await expect(usersHeading(page)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText("Internal Server Error");
    await expect(page.getByRole("table")).toHaveCount(0);
  });
});

test.describe("GET /api/users", () => {
  test("returns users with only the public fields for an admin", async ({
    adminApi,
    createUser,
  }) => {
    const agent = await createUser({ role: "agent" });

    const res = await adminApi.get("/api/users");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { users: Record<string, unknown>[] };

    expect(body.users.length).toBeGreaterThanOrEqual(2);
    for (const user of body.users) {
      expect(Object.keys(user).sort()).toEqual(
        ["banned", "createdAt", "email", "id", "name", "role"],
      );
    }
    expect(body.users.find((u) => u.email === agent.email)).toMatchObject({
      id: agent.id,
      name: agent.name,
      role: "agent",
    });

    const times = body.users.map((u) => new Date(u.createdAt as string).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test("is forbidden for agents", async ({ page, agent }) => {
    await apiSignIn(page.request, agent);
    const res = await page.request.get("/api/users");
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  test("is unauthorized when signed out", async ({ page }) => {
    const res = await page.request.get("/api/users");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
