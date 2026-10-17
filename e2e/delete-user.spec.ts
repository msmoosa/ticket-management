import { request as playwrightRequest, type Page } from "@playwright/test";
import {
  ADMIN,
  CLIENT_ORIGIN,
  apiSignIn,
  dashboardHeading,
  expect,
  loginEmailField,
  signInViaForm,
  test,
  type Credentials,
  type TestUser,
} from "./fixtures.ts";

// Users come from the `createUser` fixture, which hard-deletes them by id after the test
// (Better Auth's admin remove-user), so soft-deleted rows are cleaned up too.

const usersHeading = (page: Page) => page.getByRole("heading", { name: "Users", level: 1 });
const userRow = (page: Page, email: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: email, exact: true }) });
const deleteButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Delete ${name}`, exact: true });
const dialog = (page: Page, name: string) =>
  page.getByRole("alertdialog", { name: `Delete ${name}?` });

const description = (email: string) =>
  `${email} will be removed from the users list and signed out, and won't be able to sign in again.`;

async function openDeleteDialog(page: Page, user: Pick<TestUser, "name" | "email">) {
  await page.goto("/users");
  await expect(usersHeading(page)).toBeVisible();
  await expect(userRow(page, user.email)).toBeVisible();
  await deleteButton(page, user.name).click();
  const d = dialog(page, user.name);
  await expect(d).toBeVisible();
  return d;
}

/** Status of a sign-in attempt from a fresh cookie jar. */
async function signInStatus(baseURL: string | undefined, creds: Credentials) {
  const ctx = await playwrightRequest.newContext({ baseURL });
  try {
    const res = await ctx.post("/api/auth/sign-in/email", {
      data: { email: creds.email, password: creds.password },
      headers: { Origin: CLIENT_ORIGIN },
    });
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

test.describe("delete user dialog (admin)", () => {
  test("shows the user's name and email", async ({
    adminPage: page,
    createUser,
  }) => {
    await createUser(); // another row, to make sure the right one is used
    const user = await createUser();

    const d = await openDeleteDialog(page, user);
    await expect(d.getByRole("heading", { name: `Delete ${user.name}?` })).toBeVisible();
    await expect(d.getByText(description(user.email))).toBeVisible();
    await expect(d.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(d.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  });

  test("deletes an agent: row disappears, they can't sign in, and their session ends", async ({
    adminPage: page,
    createUser,
    browser,
    baseURL,
  }) => {
    const agent = await createUser({ role: "agent" });

    // The agent is signed in elsewhere before the deletion.
    const agentContext = await browser.newContext({ baseURL });
    try {
      const agentPage = await agentContext.newPage();
      await apiSignIn(agentPage.request, agent);
      await agentPage.goto("/");
      await expect(dashboardHeading(agentPage)).toBeVisible();

      const d = await openDeleteDialog(page, agent);
      await d.getByRole("button", { name: "Delete", exact: true }).click();

      await expect(d).toBeHidden();
      await expect(userRow(page, agent.email)).toHaveCount(0);
      await expect(userRow(page, ADMIN.email)).toBeVisible();

      expect(await signInStatus(baseURL, agent)).toBe(401);

      const me = await agentPage.request.get("/api/me");
      expect(me.status()).toBe(401);
      await agentPage.reload();
      await expect(agentPage).toHaveURL(/\/login$/);
      await expect(loginEmailField(agentPage)).toBeVisible();
    } finally {
      await agentContext.close();
    }
  });

  test("the deleted user sees an error when signing in through the form", async ({
    page,
    adminApi,
    createUser,
  }) => {
    const agent = await createUser({ role: "agent" });
    const res = await adminApi.delete(`/api/users/${agent.id}`);
    expect(res.status()).toBe(204);

    await page.goto("/login");
    await signInViaForm(page, agent);
    await expect(page.getByRole("alert")).toContainText("Invalid email or password");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("cancel keeps the user", async ({ adminPage: page, createUser, baseURL }) => {
    const user = await createUser();

    const d = await openDeleteDialog(page, user);
    await d.getByRole("button", { name: "Cancel" }).click();

    await expect(d).toBeHidden();
    await expect(userRow(page, user.email)).toBeVisible();
    await page.reload();
    await expect(userRow(page, user.email)).toBeVisible();
    expect(await signInStatus(baseURL, user)).toBe(200);
  });

  test("another admin can't be deleted: no button, and the API returns 403", async ({
    adminPage: page,
    adminApi,
    createUser,
    baseURL,
  }) => {
    const otherAdmin = await createUser({ role: "admin" });

    await page.goto("/users");
    await expect(usersHeading(page)).toBeVisible();
    await expect(userRow(page, otherAdmin.email)).toBeVisible();
    await expect(deleteButton(page, otherAdmin.name)).toHaveCount(0);

    const res = await adminApi.delete(`/api/users/${otherAdmin.id}`);
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "Admin users can't be deleted" });

    await page.reload();
    await expect(userRow(page, otherAdmin.email)).toBeVisible();
    expect(await signInStatus(baseURL, otherAdmin)).toBe(200);
  });

  test("an admin's own row has no delete button", async ({ page, createUser }) => {
    // A fresh admin, never the seeded one (other tests sign in as it).
    const self = await createUser({ role: "admin" });
    await apiSignIn(page.request, self);

    await page.goto("/users");
    await expect(usersHeading(page)).toBeVisible();
    await expect(userRow(page, self.email)).toBeVisible();
    await expect(deleteButton(page, self.name)).toHaveCount(0);
  });
});

test.describe("deleted users' emails stay reserved", () => {
  test("the Create user dialog rejects a deleted user's email", async ({
    adminPage: page,
    adminApi,
    createUser,
  }) => {
    const deleted = await createUser();
    const res = await adminApi.delete(`/api/users/${deleted.id}`);
    expect(res.status()).toBe(204);

    await page.goto("/users");
    await expect(usersHeading(page)).toBeVisible();
    await page.getByRole("button", { name: "Create user" }).click();
    const d = page.getByRole("dialog", { name: "Create user" });
    await expect(d).toBeVisible();
    await d.getByLabel("Name").fill("Replacement User");
    await d.getByLabel("Email").fill(deleted.email);
    await d.getByLabel("Password").fill("password123");
    await d.getByRole("button", { name: "Create user" }).click();

    await expect(d.getByRole("alert")).toHaveText("This email belongs to a deleted user");
    await expect(d).toBeVisible();
    await expect(userRow(page, deleted.email)).toHaveCount(0);
  });

  test("POST /api/users returns 409 for a deleted user's email", async ({
    adminApi,
    createUser,
  }) => {
    const deleted = await createUser();
    expect((await adminApi.delete(`/api/users/${deleted.id}`)).status()).toBe(204);

    const res = await adminApi.post("/api/users", {
      data: { name: "Replacement User", email: deleted.email, password: "password123" },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toEqual({ error: "This email belongs to a deleted user" });
  });
});

test.describe("DELETE /api/users/:id", () => {
  test("is forbidden for agents", async ({ page, agent, createUser }) => {
    const target = await createUser();
    await apiSignIn(page.request, agent);
    const res = await page.request.delete(`/api/users/${target.id}`);
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  test("is unauthorized when signed out", async ({ page, createUser }) => {
    const target = await createUser();
    const res = await page.request.delete(`/api/users/${target.id}`);
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
