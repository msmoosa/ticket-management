import { request as playwrightRequest, type Page } from "@playwright/test";
import {
  apiSignIn,
  authPost,
  expect,
  test as base,
  uniqueEmail,
} from "./fixtures.ts";

type Fixtures = {
  /** Emails of users the test creates through the UI or POST /api/users; removed after the test. */
  trackUser: (email: string) => void;
};

const test = base.extend<Fixtures>({
  trackUser: async ({ adminApi }, use) => {
    const emails: string[] = [];
    await use((email) => emails.push(email.toLowerCase()));
    if (emails.length === 0) return;
    const res = await adminApi.get("/api/users");
    const { users } = (await res.json()) as { users: { id: string; email: string }[] };
    for (const user of users.filter((u) => emails.includes(u.email))) {
      await authPost(adminApi, "admin/remove-user", { userId: user.id });
    }
  },
});

const usersHeading = (page: Page) => page.getByRole("heading", { name: "Users", level: 1 });
const userRow = (page: Page, email: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: email, exact: true }) });
const openButton = (page: Page) => page.getByRole("button", { name: "Create user" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Create user" });

async function openDialog(page: Page) {
  await page.goto("/users");
  await expect(usersHeading(page)).toBeVisible();
  await openButton(page).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}

async function fillForm(page: Page, values: { name: string; email: string; password: string }) {
  const d = dialog(page);
  await d.getByLabel("Name").fill(values.name);
  await d.getByLabel("Email").fill(values.email);
  await d.getByLabel("Password").fill(values.password);
}

async function countUsersWithEmail(page: Page, email: string) {
  const res = await page.request.get("/api/users");
  expect(res.status()).toBe(200);
  const { users } = (await res.json()) as { users: { email: string }[] };
  return users.filter((u) => u.email === email.toLowerCase()).length;
}

test.describe("create user dialog (admin)", () => {
  test("creates an agent who appears in the list and can sign in", async ({
    adminPage: page,
    baseURL,
    trackUser,
  }) => {
    const email = uniqueEmail("created");
    const name = `Created ${crypto.randomUUID().slice(0, 8)}`;
    const password = "s3cret-password";
    trackUser(email);

    const d = await openDialog(page);
    await expect(d.getByText("New users sign in as agents.")).toBeVisible();
    await fillForm(page, { name, email, password });
    await d.getByRole("button", { name: "Create user" }).click();

    await expect(d).toBeHidden();
    const cells = userRow(page, email).getByRole("cell");
    await expect(cells.nth(0)).toHaveText(name);
    await expect(cells.nth(2)).toHaveText("Agent");
    await expect(cells.nth(3)).toHaveText("Active");

    // The new user can sign in with the chosen password (separate cookie jar from the admin page).
    const userApi = await playwrightRequest.newContext({ baseURL });
    try {
      await apiSignIn(userApi, { email, password });
      const me = await userApi.get("/api/me");
      expect(me.status()).toBe(200);
      expect(JSON.stringify(await me.json())).toContain(email);
    } finally {
      await userApi.dispose();
    }
  });

  test("shows validation errors and creates nothing", async ({ adminPage: page, trackUser }) => {
    const email = "not-an-email";
    trackUser(email);

    const d = await openDialog(page);
    await fillForm(page, { name: "Al", email, password: "short" });
    await d.getByRole("button", { name: "Create user" }).click();

    await expect(d.getByText("Name must be at least 3 characters")).toBeVisible();
    await expect(d.getByText("Enter a valid email address")).toBeVisible();
    await expect(d.getByText("Password must be at least 8 characters")).toBeVisible();
    await expect(d.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(d).toBeVisible();

    expect(await countUsersWithEmail(page, email)).toBe(0);
  });

  test("shows the server error for a duplicate email and stays open", async ({
    adminPage: page,
    createUser,
  }) => {
    const existing = await createUser({ role: "agent" });

    const d = await openDialog(page);
    // Duplicate check is case-insensitive.
    await fillForm(page, {
      name: "Duplicate Person",
      email: existing.email.toUpperCase(),
      password: "password123",
    });
    await d.getByRole("button", { name: "Create user" }).click();

    await expect(d.getByRole("alert")).toHaveText("A user with this email already exists");
    await expect(d).toBeVisible();
    await expect(d.getByLabel("Name")).toHaveValue("Duplicate Person");
    expect(await countUsersWithEmail(page, existing.email)).toBe(1);
  });

  test("cancel closes the dialog and reopening shows an empty form", async ({
    adminPage: page,
    trackUser,
  }) => {
    const email = uniqueEmail("cancelled");
    trackUser(email);

    const d = await openDialog(page);
    await fillForm(page, { name: "Cancelled User", email, password: "password123" });
    await d.getByRole("button", { name: "Cancel" }).click();
    await expect(d).toBeHidden();

    await openButton(page).click();
    await expect(d).toBeVisible();
    await expect(d.getByLabel("Name")).toHaveValue("");
    await expect(d.getByLabel("Email")).toHaveValue("");
    await expect(d.getByLabel("Password")).toHaveValue("");

    expect(await countUsersWithEmail(page, email)).toBe(0);
  });

  test("agents don't see the Users page or its Create user button", async ({
    agentPage: page,
  }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/\/$/);
    await expect(openButton(page)).toHaveCount(0);
  });
});

test.describe("POST /api/users", () => {
  const body = () => ({
    name: "Api User",
    email: uniqueEmail("api"),
    password: "password123",
  });

  test("is forbidden for agents", async ({ page, agent, trackUser }) => {
    const data = body();
    trackUser(data.email);
    await apiSignIn(page.request, agent);
    const res = await page.request.post("/api/users", { data });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });

    // Nothing was created.
    const signIn = await authPost(page.request, "sign-in/email", {
      email: data.email,
      password: data.password,
    });
    expect(signIn.status()).toBe(401);
  });

  test("is unauthorized when signed out", async ({ page, trackUser }) => {
    const data = body();
    trackUser(data.email);
    const res = await page.request.post("/api/users", { data });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  test("returns 201 with an agent user for an admin", async ({ adminApi, trackUser }) => {
    const data = { ...body(), email: uniqueEmail("API").replace("API", "Mixed-CASE") };
    trackUser(data.email);
    const res = await adminApi.post("/api/users", { data });
    expect(res.status(), await res.text()).toBe(201);
    const { user } = (await res.json()) as { user: Record<string, unknown> };
    expect(user).toMatchObject({ name: data.name, email: data.email.toLowerCase(), role: "agent" });
    expect(Object.keys(user).sort()).toEqual(["banned", "createdAt", "email", "id", "name", "role"]);
  });
});
