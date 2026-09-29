import {
  ADMIN,
  authPost,
  dashboardHeading,
  expect,
  header,
  signInViaForm,
  signOutButton,
  test,
  uniqueEmail,
  usersNavLink,
} from "./fixtures.ts";

const INVALID_CREDENTIALS = "Invalid email or password";
const EMAIL_ERROR = "Enter a valid email address";
const PASSWORD_ERROR = "Password is required";

test.describe("login form", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("signed-out header shows no user or sign-out button", async ({ page }) => {
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);
    await expect(usersNavLink(page)).toHaveCount(0);
  });

  test("admin signs in and lands on the dashboard", async ({ page }) => {
    await signInViaForm(page, ADMIN);

    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(header(page).getByText(ADMIN.name, { exact: true })).toBeVisible();
    await expect(signOutButton(page)).toBeVisible();
    await expect(usersNavLink(page)).toBeVisible();
  });

  test("agent signs in and lands on the dashboard", async ({ page, agent }) => {
    await signInViaForm(page, agent);

    await expect(page).toHaveURL("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await expect(header(page).getByText(agent.name, { exact: true })).toBeVisible();
    await expect(signOutButton(page)).toBeVisible();
    await expect(usersNavLink(page)).toHaveCount(0);
  });

  test("pressing Enter in the password field submits the form", async ({ page, agent }) => {
    await page.getByLabel("Email").fill(agent.email);
    await page.getByLabel("Password").fill(agent.password);
    await page.getByLabel("Password").press("Enter");

    await expect(dashboardHeading(page)).toBeVisible();
  });

  test("email is matched case-insensitively", async ({ page, agent }) => {
    await signInViaForm(page, { email: agent.email.toUpperCase(), password: agent.password });

    await expect(dashboardHeading(page)).toBeVisible();
  });

  test("submit button is disabled and shows progress while signing in", async ({ page, agent }) => {
    // Hold the sign-in request until the pending state has been checked.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/auth/sign-in/email", async (route) => {
      await released;
      await route.continue();
    });

    await signInViaForm(page, agent);
    const pending = page.getByRole("button", { name: "Signing in…" });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();

    release();
    await expect(dashboardHeading(page)).toBeVisible();
  });
});

test.describe("login validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("empty submit shows both field errors and sends no request", async ({ page }) => {
    let signInRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/api/auth/sign-in")) signInRequests++;
    });

    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();
    await expect(page.getByText(PASSWORD_ERROR)).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL("/login");
    expect(signInRequests).toBe(0);
  });

  test("invalid email format shows only the email error", async ({ page }) => {
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(PASSWORD_ERROR)).toHaveCount(0);
    await expect(page.getByLabel("Password")).not.toHaveAttribute("aria-invalid");
    await expect(page).toHaveURL("/login");
  });

  test("missing password shows only the password error", async ({ page }) => {
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(PASSWORD_ERROR)).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(EMAIL_ERROR)).toHaveCount(0);
    await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid");
  });

  test("field errors clear once the input is corrected", async ({ page }) => {
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(EMAIL_ERROR)).toBeVisible();

    await page.getByLabel("Email").fill(ADMIN.email);
    await expect(page.getByText(EMAIL_ERROR)).toHaveCount(0);
    await expect(page.getByLabel("Email")).not.toHaveAttribute("aria-invalid");

    await page.getByLabel("Password").fill("x");
    await expect(page.getByText(PASSWORD_ERROR)).toHaveCount(0);
  });
});

test.describe("login server errors", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("wrong password shows an error, then correcting it signs in", async ({ page, agent }) => {
    await signInViaForm(page, { email: agent.email, password: "wrong-password" });

    await expect(page.getByRole("alert").filter({ hasText: INVALID_CREDENTIALS })).toBeVisible();
    await expect(page).toHaveURL("/login");
    await expect(signOutButton(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();

    await page.getByLabel("Password").fill(agent.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(dashboardHeading(page)).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("unknown email shows the same generic error", async ({ page }) => {
    await signInViaForm(page, { email: uniqueEmail("nobody"), password: "password123" });

    await expect(page.getByRole("alert").filter({ hasText: INVALID_CREDENTIALS })).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("banned user cannot sign in and sees the ban message", async ({
    page,
    adminApi,
    agent,
  }) => {
    const ban = await authPost(adminApi, "admin/ban-user", { userId: agent.id });
    expect(ban.status()).toBe(200);

    await signInViaForm(page, agent);

    await expect(
      page.getByRole("alert").filter({ hasText: "You have been banned from this application" }),
    ).toBeVisible();
    await expect(page).toHaveURL("/login");
    await expect(signOutButton(page)).toHaveCount(0);
  });

  test("an unbanned user can sign in again", async ({ page, adminApi, agent }) => {
    expect((await authPost(adminApi, "admin/ban-user", { userId: agent.id })).status()).toBe(200);
    expect((await authPost(adminApi, "admin/unban-user", { userId: agent.id })).status()).toBe(200);

    await signInViaForm(page, agent);

    await expect(dashboardHeading(page)).toBeVisible();
  });
});
