import { request as playwrightRequest, type Page } from "@playwright/test";
import {
  CLIENT_ORIGIN,
  apiSignIn,
  expect,
  test,
  uniqueEmail,
  type Credentials,
  type TestUser,
} from "./fixtures.ts";

// Users come from the `createUser` fixture, which removes them by id after the test,
// so renamed emails are cleaned up too.

const usersHeading = (page: Page) => page.getByRole("heading", { name: "Users", level: 1 });
const userRow = (page: Page, email: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: email, exact: true }) });
const editButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `Edit ${name}`, exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Edit user" });

async function openEditDialog(page: Page, user: Pick<TestUser, "name">) {
  await page.goto("/users");
  await expect(usersHeading(page)).toBeVisible();
  await editButton(page, user.name).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
}

/** Status of a sign-in attempt from a fresh cookie jar. */
async function signInStatus(baseURL: string | undefined, creds: Credentials) {
  const ctx = await playwrightRequest.newContext({ baseURL });
  try {
    const res = await ctx.post("/api/auth/sign-in/email", {
      data: creds,
      headers: { Origin: CLIENT_ORIGIN },
    });
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

async function fetchUser(page: Page, id: string) {
  const res = await page.request.get("/api/users");
  expect(res.status()).toBe(200);
  const { users } = (await res.json()) as { users: { id: string; name: string; email: string }[] };
  return users.find((u) => u.id === id);
}

test.describe("edit user dialog (admin)", () => {
  test("opens prefilled with the row's user and an empty password", async ({
    adminPage: page,
    createUser,
  }) => {
    await createUser(); // another row, to make sure the right one is used
    const user = await createUser();

    const d = await openEditDialog(page, user);
    await expect(d.getByText(`Update ${user.name}'s details.`)).toBeVisible();
    await expect(d.getByLabel("Name")).toHaveValue(user.name);
    await expect(d.getByLabel("Email")).toHaveValue(user.email);
    await expect(d.getByLabel("Password")).toHaveValue("");
    await expect(d.getByText("Leave blank to keep the current password.")).toBeVisible();
    await expect(d.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  test("edits name and email, keeping the password", async ({
    adminPage: page,
    createUser,
    baseURL,
  }) => {
    const user = await createUser();
    const newName = `Renamed ${crypto.randomUUID().slice(0, 8)}`;
    const newEmail = uniqueEmail("renamed");

    const d = await openEditDialog(page, user);
    await d.getByLabel("Name").fill(newName);
    await d.getByLabel("Email").fill(newEmail);
    await d.getByRole("button", { name: "Save changes" }).click();

    await expect(d).toBeHidden();
    const cells = userRow(page, newEmail).getByRole("cell");
    await expect(cells.nth(0)).toHaveText(newName);
    await expect(cells.nth(1)).toHaveText(newEmail);
    await expect(cells.nth(2)).toHaveText("Agent");
    await expect(userRow(page, user.email)).toHaveCount(0);
    await expect(editButton(page, newName)).toBeVisible();

    // Old password still works at the new email; the old email no longer does.
    expect(await signInStatus(baseURL, { email: newEmail, password: user.password })).toBe(200);
    expect(await signInStatus(baseURL, { email: user.email, password: user.password })).toBe(401);
  });

  test("sets a new password", async ({ adminPage: page, createUser, baseURL }) => {
    const user = await createUser();
    const newPassword = "brand-new-password";

    const d = await openEditDialog(page, user);
    await d.getByLabel("Password").fill(newPassword);
    await d.getByRole("button", { name: "Save changes" }).click();
    await expect(d).toBeHidden();

    expect(await signInStatus(baseURL, { email: user.email, password: newPassword })).toBe(200);
    expect(await signInStatus(baseURL, { email: user.email, password: user.password })).toBe(401);
  });

  test("shows validation errors, stays open, and changes nothing", async ({
    adminPage: page,
    createUser,
    baseURL,
  }) => {
    const user = await createUser();
    let patches = 0;
    page.on("request", (req) => {
      if (req.method() === "PATCH" && req.url().includes("/api/users/")) patches++;
    });

    const d = await openEditDialog(page, user);
    await d.getByLabel("Name").fill("Al");
    await d.getByLabel("Email").fill("not-an-email");
    await d.getByLabel("Password").fill("1234567");
    await d.getByRole("button", { name: "Save changes" }).click();

    await expect(d.getByText("Name must be at least 3 characters")).toBeVisible();
    await expect(d.getByText("Enter a valid email address")).toBeVisible();
    await expect(d.getByText("Password must be at least 8 characters")).toBeVisible();
    await expect(d.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(d.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
    await expect(d.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(d).toBeVisible();
    expect(patches).toBe(0);

    expect(await fetchUser(page, user.id)).toMatchObject({ name: user.name, email: user.email });
    expect(await signInStatus(baseURL, user)).toBe(200);
  });

  test("shows the server error when the email belongs to another user", async ({
    adminPage: page,
    createUser,
  }) => {
    const other = await createUser();
    const user = await createUser();

    const d = await openEditDialog(page, user);
    await d.getByLabel("Email").fill(other.email.toUpperCase());
    await d.getByRole("button", { name: "Save changes" }).click();

    await expect(d.getByRole("alert")).toHaveText("A user with this email already exists");
    await expect(d).toBeVisible();
    await expect(d.getByLabel("Email")).toHaveValue(other.email.toUpperCase());
    await expect(d.getByRole("button", { name: "Save changes" })).toBeEnabled();

    expect(await fetchUser(page, user.id)).toMatchObject({ email: user.email });
  });

  test("cancel discards changes and reopening shows the original values", async ({
    adminPage: page,
    createUser,
  }) => {
    const user = await createUser();

    const d = await openEditDialog(page, user);
    await d.getByLabel("Name").fill("Discarded Name");
    await d.getByLabel("Email").fill(uniqueEmail("discarded"));
    await d.getByLabel("Password").fill("discarded-password");
    await d.getByRole("button", { name: "Cancel" }).click();
    await expect(d).toBeHidden();

    await expect(userRow(page, user.email).getByRole("cell").nth(0)).toHaveText(user.name);

    await editButton(page, user.name).click();
    await expect(d).toBeVisible();
    await expect(d.getByLabel("Name")).toHaveValue(user.name);
    await expect(d.getByLabel("Email")).toHaveValue(user.email);
    await expect(d.getByLabel("Password")).toHaveValue("");

    expect(await fetchUser(page, user.id)).toMatchObject({ name: user.name, email: user.email });
  });
});

test.describe("PATCH /api/users/:id", () => {
  test("is forbidden for agents", async ({ page, agent, createUser }) => {
    const target = await createUser();
    await apiSignIn(page.request, agent);
    const res = await page.request.patch(`/api/users/${target.id}`, {
      data: { name: "Hacked Name", email: target.email },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  test("is unauthorized when signed out", async ({ page, createUser }) => {
    const target = await createUser();
    const res = await page.request.patch(`/api/users/${target.id}`, {
      data: { name: "Hacked Name", email: target.email },
    });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
