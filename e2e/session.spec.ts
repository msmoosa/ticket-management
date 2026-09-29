import {
  ADMIN,
  authPost,
  dashboardHeading,
  expect,
  header,
  signOutButton,
  test,
  usersNavLink,
} from "./fixtures.ts";

test.describe("session persistence", () => {
  test("reloading keeps the user signed in", async ({ agentPage: page, agent }) => {
    await page.reload();

    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(header(page).getByText(agent.name, { exact: true })).toBeVisible();
  });

  test("a new tab in the same browser context is signed in", async ({
    agentPage: page,
    agent,
  }) => {
    const second = await page.context().newPage();
    await second.goto("/");

    await expect(dashboardHeading(second)).toBeVisible();
    await expect(header(second).getByText(agent.name, { exact: true })).toBeVisible();
  });

  test("a separate browser context is not signed in", async ({ agentPage: _page, browser }) => {
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await otherPage.goto("/");

    await expect(otherPage).toHaveURL("/login");
    await other.close();
  });

  test("/api/me returns the signed-in user", async ({ agentPage: page, agent }) => {
    const res = await page.request.get("/api/me");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { user: { id: string; email: string; role: string } };
    expect(body.user).toMatchObject({ id: agent.id, email: agent.email, role: "agent" });
  });
});

test.describe("sign out", () => {
  test("returns to /login and clears the header", async ({ adminPage: page }) => {
    await signOutButton(page).click();

    await expect(page).toHaveURL("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);
    await expect(usersNavLink(page)).toHaveCount(0);
    await expect(header(page).getByText(ADMIN.name, { exact: true })).toHaveCount(0);
  });

  test("protected pages redirect to /login afterwards and /api/me is 401", async ({
    adminPage: page,
  }) => {
    await signOutButton(page).click();
    await expect(page).toHaveURL("/login");

    await page.goto("/");
    await expect(page).toHaveURL("/login");
    await page.goto("/users");
    await expect(page).toHaveURL("/login");

    const me = await page.request.get("/api/me");
    expect(me.status()).toBe(401);
  });

  test("back navigation does not expose protected content", async ({ adminPage: page }) => {
    await usersNavLink(page).click();
    await expect(page).toHaveURL("/users");

    await signOutButton(page).click();
    await expect(page).toHaveURL("/login");

    await page.goBack();
    await expect(page).toHaveURL("/login");
    await expect(dashboardHeading(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toHaveCount(0);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("signing out in one tab signs out the other tab on reload", async ({
    agentPage: page,
  }) => {
    const second = await page.context().newPage();
    await second.goto("/");
    await expect(dashboardHeading(second)).toBeVisible();

    await signOutButton(page).click();
    await expect(page).toHaveURL("/login");

    await second.reload();
    await expect(second).toHaveURL("/login");
  });
});

test.describe("server-side session invalidation", () => {
  test("revoking an agent's sessions sends them to /login on next load", async ({
    agentPage: page,
    adminApi,
    agent,
  }) => {
    const res = await authPost(adminApi, "admin/revoke-user-sessions", { userId: agent.id });
    expect(res.status()).toBe(200);

    expect((await page.request.get("/api/me")).status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("banning an agent ends their session and blocks sign-in", async ({
    agentPage: page,
    adminApi,
    agent,
  }) => {
    const res = await authPost(adminApi, "admin/ban-user", { userId: agent.id });
    expect(res.status()).toBe(200);

    await page.goto("/");
    await expect(page).toHaveURL("/login");

    const signIn = await authPost(page.request, "sign-in/email", {
      email: agent.email,
      password: agent.password,
    });
    expect(signIn.status()).toBe(403);
  });

  test("revoking one user's sessions does not sign out others", async ({
    adminPage: page,
    adminApi,
    createUser,
  }) => {
    const other = await createUser({ role: "agent" });
    const res = await authPost(adminApi, "admin/revoke-user-sessions", { userId: other.id });
    expect(res.status()).toBe(200);

    await page.reload();
    await expect(dashboardHeading(page)).toBeVisible();
  });
});
