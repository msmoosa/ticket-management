import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
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

export const ticketsNavLink = (page: Page) => header(page).getByRole("link", { name: "Tickets" });
export const ticketsHeading = (page: Page) =>
  page.getByRole("heading", { name: "Tickets", level: 1 });

export type TicketStatus = "open" | "resolved" | "closed";
export type TicketCategory = "general_question" | "technical_question" | "refund_request";

/** A ticket as returned by the inbound email webhook (and, minus `body`, by GET /api/tickets). */
export interface Ticket {
  id: string;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  status: TicketStatus;
  /** Null until the ticket is classified (webhook-created tickets are always null). */
  category: TicketCategory | null;
  createdAt: string;
}

export interface InboundEmail {
  from?: string;
  fromName?: string;
  subject?: string;
  text?: string;
  messageId?: string;
}

/** The env the e2e API server runs with (server/.env.test). */
type ServerEnv = {
  DATABASE_URL: string;
  SUPPORT_EMAIL: string;
  INBOUND_EMAIL_SECRET: string;
};

function readServerEnv(configFile: string | undefined): ServerEnv {
  const root = configFile ? path.dirname(configFile) : process.cwd();
  const env = parseEnv(readFileSync(path.join(root, "server/.env.test"), "utf8"));
  const pick = (key: keyof ServerEnv) => {
    const value = env[key];
    if (!value) throw new Error(`${key} is not set in server/.env.test`);
    return value;
  };
  return {
    DATABASE_URL: pick("DATABASE_URL"),
    SUPPORT_EMAIL: pick("SUPPORT_EMAIL"),
    INBOUND_EMAIL_SECRET: pick("INBOUND_EMAIL_SECRET"),
  };
}

// There's no ticket delete or update API yet, so tests remove their tickets (and set fields no
// API sets, like `category`) straight in the test DB, with Bun's built-in Postgres client (as
// global-setup also shells out to bun). The script refuses to touch a database not named *_test.
const TICKET_DB_SCRIPT = `
const url = process.env.DATABASE_URL;
if (!new URL(url).pathname.slice(1).endsWith("_test")) throw new Error("Refusing to touch a non-test database");
const op = JSON.parse(process.env.TICKET_OP);
const sql = new Bun.SQL(url);
if (op.kind === "delete") {
  for (const id of op.ids) await sql\`DELETE FROM "ticket" WHERE "id" = \${id}\`;
} else if (op.kind === "setCategory") {
  const rows = await sql\`UPDATE "ticket" SET "category" = \${op.category}::"TicketCategory" WHERE "id" = \${op.id} RETURNING "id"\`;
  if (rows.length !== 1) throw new Error("No ticket " + op.id);
} else if (op.kind === "setStatus") {
  const rows = await sql\`UPDATE "ticket" SET "status" = \${op.status}::"TicketStatus" WHERE "id" = \${op.id} RETURNING "id"\`;
  if (rows.length !== 1) throw new Error("No ticket " + op.id);
}
await sql.close();
`;

type TicketDbOp =
  | { kind: "delete"; ids: string[] }
  | { kind: "setCategory"; id: string; category: TicketCategory | null }
  | { kind: "setStatus"; id: string; status: TicketStatus };

function runTicketDbOp(databaseUrl: string, op: TicketDbOp) {
  execFileSync("bun", ["-e", TICKET_DB_SCRIPT], {
    env: { ...process.env, DATABASE_URL: databaseUrl, TICKET_OP: JSON.stringify(op) },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function deleteTickets(databaseUrl: string, ids: string[]) {
  if (ids.length === 0) return;
  runTicketDbOp(databaseUrl, { kind: "delete", ids });
}

type WorkerFixtures = {
  serverEnv: ServerEnv;
};

type Fixtures = {
  /**
   * Create a ticket by posting an email to the inbound email webhook (as the email provider
   * would). Defaults give a unique subject, sender and Message-ID. Deleted again after the test.
   */
  createTicket: (email?: InboundEmail) => Promise<Ticket>;
  /**
   * Set a ticket's category directly in the test DB (no API sets it until AI classification
   * lands). Only use on tickets this test created.
   */
  setTicketCategory: (id: string, category: TicketCategory | null) => void;
  /**
   * Set a ticket's status directly in the test DB (there's no update-ticket API yet). Only use
   * on tickets this test created.
   */
  setTicketStatus: (id: string, status: TicketStatus) => void;
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

export const test = base.extend<Fixtures, WorkerFixtures>({
  serverEnv: [
    async ({}, use, workerInfo) => {
      await use(readServerEnv(workerInfo.config.configFile));
    },
    { scope: "worker" },
  ],

  createTicket: async ({ request, serverEnv }, use) => {
    const created: string[] = [];
    await use(async (email = {}) => {
      const tag = crypto.randomUUID();
      const res = await request.post("/api/webhooks/inbound-email", {
        headers: { "X-Webhook-Secret": serverEnv.INBOUND_EMAIL_SECRET },
        data: {
          from: email.from ?? `student-${tag}@example.com`,
          fromName: email.fromName,
          to: [serverEnv.SUPPORT_EMAIL],
          subject: email.subject ?? `Help needed ${tag}`,
          text: email.text ?? "I can't access my course materials.",
          messageId: email.messageId ?? `<e2e-${tag}@example.com>`,
        },
      });
      expect(res.status(), `create ticket: ${await res.text()}`).toBe(201);
      const { ticket } = (await res.json()) as { ticket: Ticket };
      created.push(ticket.id);
      return ticket;
    });
    deleteTickets(serverEnv.DATABASE_URL, created);
  },

  setTicketCategory: async ({ serverEnv }, use) => {
    await use((id, category) =>
      runTicketDbOp(serverEnv.DATABASE_URL, { kind: "setCategory", id, category }),
    );
  },

  setTicketStatus: async ({ serverEnv }, use) => {
    await use((id, status) => runTicketDbOp(serverEnv.DATABASE_URL, { kind: "setStatus", id, status }));
  },

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
