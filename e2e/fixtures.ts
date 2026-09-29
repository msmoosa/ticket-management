import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

// Must match CLIENT_ORIGIN in server/.env.test (Better Auth's trustedOrigins) and baseURL in playwright.config.ts.
export const CLIENT_ORIGIN = "http://localhost:5174";

export type Role = "admin" | "agent";

export interface Credentials {
  email: string;
  password: string;
}

export interface TestUser extends Credentials {
  id: string;
  name: string;
  role: Role;
}

// Seeded by server/prisma/reset-test-db.ts. Never modify or delete this user.
export const ADMIN: Credentials & { name: string } = {
  email: "admin@example.com",
  password: "password123",
  name: "Admin",
};

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

/** POST to a Better Auth endpoint with the trusted Origin header it requires. */
export function authPost(
  request: APIRequestContext,
  path: string,
  data: unknown,
): Promise<APIResponse> {
  return request.post(`/api/auth/${path}`, {
    data,
    headers: { Origin: CLIENT_ORIGIN },
  });
}

/**
 * Sign in through the API. Pass `page.request` to sign a page in (it shares the page's cookie jar),
 * then `page.goto(...)`.
 */
export async function apiSignIn(request: APIRequestContext, { email, password }: Credentials) {
  const res = await authPost(request, "sign-in/email", { email, password });
  expect(res.status(), `sign in as ${email}: ${await res.text()}`).toBe(200);
}

/** Fill and submit the login form on the current page. */
export async function signInViaForm(page: Page, { email, password }: Credentials) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Create a user as the admin signed in on `adminApi`. */
export async function createUser(
  adminApi: APIRequestContext,
  options: Partial<Omit<TestUser, "id">> = {},
): Promise<TestUser> {
  const role = options.role ?? "agent";
  const user = {
    email: options.email ?? uniqueEmail(role),
    password: options.password ?? "password123",
    name: options.name ?? `Test ${role} ${crypto.randomUUID().slice(0, 8)}`,
    role,
  };
  const res = await authPost(adminApi, "admin/create-user", user);
  expect(res.status(), `create user ${user.email}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  return { ...user, id: body.user.id };
}

export const header = (page: Page) => page.getByRole("banner");
export const signOutButton = (page: Page) =>
  header(page).getByRole("button", { name: "Sign out" });
export const usersNavLink = (page: Page) => header(page).getByRole("link", { name: "Users" });
export const dashboardHeading = (page: Page) =>
  page.getByRole("heading", { name: "Dashboard", level: 1 });
/** The login form is showing (its Email field is the stable marker). */
export const loginEmailField = (page: Page) => page.getByLabel("Email");

type Fixtures = {
  /** A standalone API context signed in as the seeded admin (separate from `page`'s cookies). */
  adminApi: APIRequestContext;
  /** Create a user (default role: agent) via the admin API; removed again after the test. */
  createUser: (options?: Partial<Omit<TestUser, "id">>) => Promise<TestUser>;
  /** A fresh agent user created for this test. */
  agent: TestUser;
  /** `page`, signed in as the seeded admin and opened at `/`. */
  adminPage: Page;
  /** `page`, signed in as `agent` and opened at `/`. */
  agentPage: Page;
};

export const test = base.extend<Fixtures>({
  adminApi: async ({ baseURL }, use) => {
    const api = await playwrightRequest.newContext({ baseURL });
    await apiSignIn(api, ADMIN);
    await use(api);
    await api.dispose();
  },

  createUser: async ({ adminApi }, use) => {
    const created: TestUser[] = [];
    await use(async (options) => {
      const user = await createUser(adminApi, options);
      created.push(user);
      return user;
    });
    for (const user of created) {
      await authPost(adminApi, "admin/remove-user", { userId: user.id });
    }
  },

  agent: async ({ createUser }, use) => {
    await use(await createUser({ role: "agent" }));
  },

  adminPage: async ({ page }, use) => {
    await apiSignIn(page.request, ADMIN);
    await page.goto("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await use(page);
  },

  agentPage: async ({ page, agent }, use) => {
    await apiSignIn(page.request, agent);
    await page.goto("/");
    await expect(dashboardHeading(page)).toBeVisible();
    await use(page);
  },
});

export { expect };
