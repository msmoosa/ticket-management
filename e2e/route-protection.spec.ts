import {
  ADMIN,
  apiSignIn,
  dashboardHeading,
  expect,
  signInViaForm,
  signOutButton,
  test,
} from "./fixtures.ts";

const notFoundHeading = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: "Page not found" });
const usersHeading = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { name: "Users", level: 1 });

test.describe("signed-out access", () => {
  test("visiting / redirects to /login, and signing in returns to /", async ({ page, agent }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");
    await expect(dashboardHeading(page)).toHaveCount(0);

    await signInViaForm(page, agent);
    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
  });

  test("visiting /users redirects to /login, and an admin is returned to /users", async ({
    page,
  }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/login");
    await expect(usersHeading(page)).toHaveCount(0);

    await signInViaForm(page, ADMIN);
    await expect(page).toHaveURL("/users");
    await expect(usersHeading(page)).toBeVisible();
  });

  test("an agent who originally requested /users ends up on the dashboard", async ({
    page,
    agent,
  }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/login");

    await signInViaForm(page, agent);
    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(usersHeading(page)).toHaveCount(0);
  });

  test("the protected API rejects requests without a session", async ({ page }) => {
    const res = await page.request.get("/api/me");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});

test.describe("guest-only login page", () => {
  test("a signed-in user visiting /login is sent to /", async ({ agentPage: page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
  });

  test("a signed-in admin visiting /login is sent to /", async ({ adminPage: page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
  });
});

test.describe("unknown routes", () => {
  test("show the not-found page when signed out, without redirecting", async ({ page }) => {
    await page.goto("/does-not-exist");

    await expect(page).toHaveURL("/does-not-exist");
    await expect(notFoundHeading(page)).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);
  });

  test("show the not-found page when signed in, with a link back to the dashboard", async ({
    page,
    agent,
  }) => {
    await apiSignIn(page.request, agent);
    await page.goto("/some/deep/unknown/path");

    await expect(notFoundHeading(page)).toBeVisible();
    await expect(signOutButton(page)).toBeVisible();

    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
  });

  test("signed out, the not-found link leads to the login page", async ({ page }) => {
    await page.goto("/nope");
    await page.getByRole("link", { name: "Back to dashboard" }).click();

    await expect(page).toHaveURL("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});
