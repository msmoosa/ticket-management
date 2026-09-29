import { apiSignIn, authPost, dashboardHeading, expect, test, usersNavLink } from "./fixtures.ts";

const usersHeading = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: "Users", level: 1 });

test.describe("admin", () => {
  test("sees the Users link and can open the users page", async ({ adminPage: page }) => {
    await expect(usersNavLink(page)).toBeVisible();

    await usersNavLink(page).click();
    await expect(page).toHaveURL("/users");
    await expect(usersHeading(page)).toBeVisible();
  });

  test("can load /users directly", async ({ adminPage: page }) => {
    await page.goto("/users");

    await expect(page).toHaveURL("/users");
    await expect(usersHeading(page)).toBeVisible();
  });

  test("an agent promoted to admin gets the admin UI on next load", async ({
    page,
    adminApi,
    createUser,
  }) => {
    const user = await createUser({ role: "agent" });
    await apiSignIn(page.request, user);
    await page.goto("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(usersNavLink(page)).toHaveCount(0);

    const res = await authPost(adminApi, "admin/set-role", { userId: user.id, role: "admin" });
    expect(res.status()).toBe(200);

    await page.reload();
    await expect(usersNavLink(page)).toBeVisible();
    await page.goto("/users");
    await expect(usersHeading(page)).toBeVisible();
  });
});

test.describe("agent", () => {
  test("does not see the Users link", async ({ agentPage: page }) => {
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(usersNavLink(page)).toHaveCount(0);
  });

  test("is redirected from /users to the dashboard", async ({ agentPage: page }) => {
    await page.goto("/users");

    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(usersHeading(page)).toHaveCount(0);
  });

  test("cannot change their own role through the admin API", async ({
    agentPage: page,
    agent,
  }) => {
    const res = await authPost(page.request, "admin/set-role", {
      userId: agent.id,
      role: "admin",
    });
    expect(res.status()).toBe(403);

    // Still an agent, both on the server and in the UI.
    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { user: { role: string } }).user.role).toBe("agent");
    await page.reload();
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(usersNavLink(page)).toHaveCount(0);
  });

  test("cannot list or create users through the admin API", async ({ agentPage: page }) => {
    const list = await page.request.get("/api/auth/admin/list-users");
    expect(list.status()).toBe(403);

    const create = await authPost(page.request, "admin/create-user", {
      email: `sneaky-${crypto.randomUUID()}@example.com`,
      password: "password123",
      name: "Sneaky",
      role: "admin",
    });
    expect(create.status()).toBe(403);
  });
});

test("admin endpoints reject signed-out requests", async ({ page }) => {
  const res = await page.request.get("/api/auth/admin/list-users");
  expect(res.status()).toBe(401);
});
