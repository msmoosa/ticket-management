# Ticket Management

AI-powered support ticket system: incoming support emails become tickets that are auto-classified, summarized, and given AI-suggested replies. Agents work tickets in a React dashboard; admins manage users.

- Scope: @project-scope.md
- Stack decisions: @tech-stack.md
- Phased task list (check off items as they are completed): @implementation-plan.md

## Commands

Run from the repo root. Bun lives in `~/.bun/bin` — if `bun` is not found, use `export PATH="$HOME/.bun/bin:$PATH"`.

- Install: `bun install`
- Dev (client + server, watch mode): `bun run dev` — client at http://localhost:5173, API at http://localhost:3000
- Typecheck both apps: `bun run typecheck`
- Test (server + client): `bun run test` — server tests against the test database plus client component tests with Vitest (see Testing below)
- E2E (Playwright): `bun run test:e2e` (or `test:e2e:ui`)
- Build client: `bun run build`
- Single workspace: `bun run --filter server <script>` or `bun run --filter client <script>`
- Prisma (run in `server/`): `bun run db:generate`, `bun run db:migrate` (create + apply a migration; Prisma 7 does not regenerate the client, so run `db:generate` after it), `bun run db:studio`
- Seed (run in `server/`): `bun run db:seed` creates the admin user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (dev default: `admin@example.com` / `password123`); safe to re-run
- Sample tickets (run in `server/`): `bun run db:seed:tickets` adds 100 realistic tickets to the dev DB (`prisma/seed-tickets.ts`; mixed statuses, categories incl. uncategorized, senders, last 90 days); skips ones already there by `messageId`
- Test DB (run in `server/`): `bun run db:test:reset` applies migrations to `helpdesk_test` (creating it if needed), truncates every table, and seeds the admin. Run it once on a fresh machine and after adding migrations; `test:e2e` runs it automatically
- Better Auth schema (run in `server/`): `bun run auth:generate` rewrites the auth models in `prisma/schema.prisma` — rerun after changing auth plugins, check `git diff` that other models survived, then `db:migrate`

Always run `bun run typecheck` and `bun run test` after changes.

## Structure

Bun workspaces monorepo (`client`, `server`).

- `client/` — React 19 + Vite 8 + Tailwind CSS 4 + React Router 8 + shadcn/ui
  - `@/` aliases `client/src/` (set in `tsconfig.json`, `tsconfig.app.json`, and `vite.config.ts`)
  - `src/components/ui/` — shadcn components (generated; add more with `bunx --bun shadcn@latest add <name>` from `client/`); `src/lib/utils.ts` exports `cn`
  - `src/App.tsx` — layout and route table
  - `src/pages/` — one component per route
  - `src/lib/users.ts` / `src/lib/tickets.ts` — shared API types (`User`, `TicketSummary`, `Ticket`, `ticketStatusLabel`, `ticketStatusVariant`, `ticketCategoryLabel`)
  - `src/lib/auth-client.ts` — Better Auth React client (`authClient.useSession()`, `signIn.email`, `signOut`)
  - `src/components/RequireAuth.tsx` wraps signed-in routes (redirects to `/login`); `RequireAdmin.tsx` nests inside it for admin-only routes (redirects non-admins to `/`); `GuestOnly.tsx` wraps `/login`
  - Vite proxies `/api/*` to `http://localhost:3000`, so the client calls relative `/api/...` URLs and CORS is not needed in dev
  - Data fetching: TanStack Query (`useQuery` / `useMutation`) with the axios instance `api` from `src/lib/api.ts` (base URL `/api`; pass the query `signal`). `apiErrorMessage(err, fallback)` extracts the server's `{ error }`. The shared `queryClient` (`src/lib/query-client.ts`) skips retries on 4xx and is cleared on sign-out. Don't call `fetch` directly; Better Auth calls still go through `authClient`.
- `server/` — Express 5 running directly on Bun (no build step)
  - `src/app.ts` — `createApp()` builds the Express app (used by both `index.ts` and tests)
  - `src/index.ts` — starts the server on `PORT`
  - `src/routes/` — one `Router` per resource, mounted under `/api/<resource>` in `app.ts`
  - `src/middleware/error-handler.ts` — 404 handler, JSON error handler, `HttpError` class
  - `src/auth.ts` — Better Auth instance; `src/permissions.ts` — admin-plugin access control keyed by the `Role` enum
  - `src/middleware/auth.ts` — `requireAuth` (401 if no session; sets `res.locals.user` / `res.locals.session`), `requireRole(...roles)` (403; use after `requireAuth`), and `requireAdmin` (standalone: 401 without a session, 403 unless admin)
  - `GET /api/me` — the signed-in user
  - `GET /api/users` — admin-only user list (`id`, `name`, `email`, `role`, `banned`, `createdAt`), rendered by `client/src/pages/UsersPage.tsx`
  - `POST /api/users` — admin-only; creates an agent from `{ name, email, password }` (zod-validated: name ≥ 3, password ≥ 8; 409 on duplicate email) via `auth.api.createUser`. Used by `client/src/components/CreateUserDialog.tsx` on the users page
  - `PATCH /api/users/:id` — admin-only; updates `{ name, email, password? }` (same rules; omit `password` to keep it; 404 unknown user, 409 email taken) via `auth.api.adminUpdateUser` / `setUserPassword`, which need the admin's request `headers` (unlike `createUser`). Used by `client/src/components/EditUserDialog.tsx`; both dialogs render the shared `UserForm.tsx`
  - `DELETE /api/users/:id` — admin-only **soft delete** (204; 404 if unknown or already deleted): sets `User.deletedAt` and deletes the user's sessions. Any admin can delete any user, including admins and themselves (the client then signs out). Deleted users are hidden from `GET /api/users`, 404 on `PATCH`, can't sign in (session-create hook in `auth.ts`), and keep their email reserved (409 "This email belongs to a deleted user"). Any new user query should filter `deletedAt: null`. UI: `client/src/components/DeleteUserDialog.tsx` (shadcn `alert-dialog`)
  - `GET /api/tickets` — any signed-in user (agents and admins); `{ tickets, total, page, pageSize }`; tickets have `id`, `subject`, `fromEmail`, `fromName`, `status`, `category`, `createdAt` (no body); paginated with `?page=` (1-based, default 1) and `?pageSize=` (1–100, default 25; 400 otherwise), `total` counts every match across pages, and a page past the end returns no tickets; filtered on the server by `?status=open|resolved|closed`, `?category=<TicketCategory>|uncategorized` (null category) and `?search=` (trimmed, ≤ 200 chars; case-insensitive substring of subject, `fromEmail` or `fromName`), all combined with AND, and sorted by `?sortBy=subject|fromEmail|category|status|createdAt&sortOrder=asc|desc` (default `createdAt` desc; 400 on other values; ties fall back to `createdAt` desc then `id`; uncategorized last; enums sort in declaration order). Rendered by `client/src/pages/TicketsPage.tsx` at `/tickets` (nav link for every signed-in user) with TanStack Table v9 (`@tanstack/react-table`: `useTable` + `tableFeatures({ rowSortingFeature })`, `manualSorting`; column ids are the `sortBy` values). Sort, filters, page and page size live in the page URL (`useSearchParams`; defaults omitted, unknown values ignored; sorting/filtering resets to page 1, a page past the end redirects to the last) so filtered views are linkable, and the parsed params are the query key; the filter bar is `client/src/components/TicketFilters.tsx` (debounced search + shadcn `select`s) and the pager below the table is `client/src/components/TicketPagination.tsx` (rows-per-page 10/25/50/100)
  - `GET /api/tickets/:id` — any signed-in user; `{ ticket }` with the list fields plus `body`, `assignedTo` (`{ id, name }` or null) and `updatedAt` (404 "Ticket not found"). Rendered by `client/src/pages/TicketDetailPage.tsx` at `/tickets/:id` (type `Ticket` in `src/lib/tickets.ts`). Subjects in the list link there, passing the list's URL as `state.from` so "Back to tickets" returns to the same sort/filters/page
  - `GET /api/tickets/assignees` — any signed-in user; `{ users: [{ id, name, email }] }`, every active user (not deleted, not banned; agents and admins) sorted by name. Declared before `/:id` in the router
  - `PATCH /api/tickets/:id` — any signed-in user; any of `{ status?, category?, assignedToId? }` (fields left out are kept; 400 "Nothing to update" if none; `category: null` → uncategorized, `assignedToId: null` → unassigned; other keys ignored). 400 "Assignee must be an active user" (nothing is saved); 404 unknown ticket; returns `{ ticket }` like `GET /:id`. UI on the detail page: `TicketStatusSelect.tsx`, `TicketCategorySelect.tsx` and `TicketAssignee.tsx` in `client/src/components/`, each a `TicketFieldSelect` (shadcn `select` + error alert) that saves on change through `useUpdateTicket` (`src/lib/use-update-ticket.ts`), which writes the result into the detail query's cache and invalidates cached list pages
  - `POST /api/webhooks/inbound-email` — turns an email sent to the support address into an `open` `Ticket` (see Inbound email below)
  - `src/db.ts` — the shared `prisma` client; import it, never create another `PrismaClient`
  - `prisma/schema.prisma` — data models; `prisma/seed.ts` — seed script; `src/generated/prisma/` — generated client (gitignored)
  - Env vars in `server/.env` (Bun loads it automatically); document new vars in `server/.env.example`

## Conventions

- TypeScript strict mode everywhere. Relative imports include the `.ts` / `.tsx` extension.
- Server: named exports. Client: default export for page and top-level components.
- API responses are JSON. Errors are `{ "error": string }` with an appropriate status.
- To return a 4xx, `throw new HttpError(status, message)` — Express 5 forwards thrown errors and rejected promises from async handlers to the error handler automatically, so no try/catch or async wrapper is needed.
- Server tests use `bun:test`, live next to the code as `*.test.ts`, and start the app with `createApp().listen(0)` then call it with `fetch`.
- Client component tests use Vitest + React Testing Library + MSW and live next to the component as `*.test.tsx` (see Testing > Component tests).
- Styling: Tailwind utility classes only; no custom CSS beyond `client/src/index.css`. Use shadcn components for UI primitives (buttons, inputs, dialogs, …) and the theme tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, …) rather than raw colors.
- Forms: react-hook-form + `zodResolver` with a zod schema, rendered with shadcn `Field` / `FieldLabel` / `Input` / `FieldError` (set `data-invalid` on `Field` and `aria-invalid` on the input); server errors go in `setError("root", …)` and show as a destructive `Alert`. `src/pages/LoginPage.tsx` is the reference.
- `client/src/index.css` suppresses Chrome's autofill background/text color on all inputs (a delayed-transition hack, since the UA styles are `!important`) — keep it unlayered so it beats `transition-colors`.
- Use context7 mcp server to fetch upto date documentation for libraries

## Library gotchas (current versions)

- **React Router 8**: import everything from `react-router` (`react-router-dom` no longer exists; DOM-only APIs come from `react-router/dom`). The app uses declarative mode (`<BrowserRouter>`, `<Routes>`, `<Route>`).
- **Tailwind CSS 4**: configured via the `@tailwindcss/vite` plugin and `@import "tailwindcss"` in CSS. There is no `tailwind.config.js`; put theme customization in CSS with `@theme`. The shadcn theme (`base-nova` style, neutral base color, CSS variables in `:root` / `.dark`) lives in `client/src/index.css`.
- **shadcn/ui (`base-nova`)**: components are built on Base UI (`@base-ui/react`), not Radix — use Base UI's props (e.g. the `render` prop instead of Radix's `asChild`). `cn` comes from the `cn` package, not `clsx` + `tailwind-merge`.
- **Express 5**: path syntax changed from v4 (e.g. wildcards must be named: `/*splat`, not `*`).
- **Bun**: runs TypeScript natively. Use `bun`/`bunx`, not `npm`/`npx`/`node`.
- Look up current docs with context7 before using an API you are unsure about — these libraries are newer than most examples online.

## Auth

Better Auth 1.7 with email/password and database sessions (the `session` table; no secondary storage). The browser holds an HTTP-only `better-auth.session_token` cookie; the Vite proxy keeps it same-origin, so there are no tokens to manage on the client.

### Server

- `src/auth.ts` is the Better Auth instance: Prisma adapter, `emailAndPassword` with `disableSignUp`, the admin plugin, and `trustedOrigins` from `CLIENT_ORIGIN`. `Session` (exported type) is `typeof auth.$Infer.Session`.
- The handler is mounted at `/api/auth/*splat` **before** `express.json()` in `app.ts` — the body parser would otherwise consume the request. Better Auth serves sign-in (`POST /api/auth/sign-in/email`), sign-out (`POST /api/auth/sign-out`), `GET /api/auth/get-session`, and the admin endpoints; don't write custom login/logout routes.
- Protect app routes with the middleware in `src/middleware/auth.ts`:
  ```ts
  router.get("/", requireAuth, handler);                                  // 401 without a session
  router.delete("/:id", requireAuth, requireRole(Role.admin), handler);   // 403 for other roles
  router.delete("/:id", requireAdmin, handler);                           // same, shorthand for admin-only
  ```
  After `requireAuth`, `res.locals.user` and `res.locals.session` are typed (see the `Express.Locals` augmentation). To check a session elsewhere, call `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`.

### Users and roles

- Public sign-up is disabled. The first admin comes from `bun run db:seed`; every other user is created by an admin through the admin plugin.
- Admin plugin endpoints live under `/api/auth/admin/*` (`create-user`, `list-users`, `get-user`, `update-user`, `set-role`, `set-user-password`, `remove-user`, `ban-user` / `unban-user`, `list-user-sessions`, `revoke-user-session(s)`, `impersonate-user`). Over HTTP they require an admin session. Server-side, `auth.api.<method>` called **without** `headers` skips the session check (used by the seed and tests); pass `headers` to act as the signed-in user.
- Roles are the Prisma enum `Role` (`admin` | `agent`, default `agent`) on `User.role`. In server code import `Role` from `src/generated/prisma/enums.ts` rather than using string literals. `src/permissions.ts` keys the admin plugin's roles by this enum (`admin` → `adminAc`, `agent` → `userAc`), so the plugin rejects any other value. `auth:generate` keeps the enum type on existing fields.
- The admin plugin also added `User.banned` / `banReason` / `banExpires` and `Session.impersonatedBy`; banned users cannot sign in.
- `User.deletedAt` (soft delete) is a Better Auth `user.additionalFields` entry in `auth.ts` (`input: false`), so it survives `auth:generate`.
- `User` / `Session` / `Account` / `Verification` models are owned by Better Auth — change them via its config + `auth:generate`, not by hand. Passwords are hashed in `Account.password`, not on `User`.

### Client

- `src/lib/auth-client.ts` exports `authClient` (with `adminClient()`): `authClient.useSession()` → `{ data: { user, session } | null, isPending }`, `authClient.signIn.email(...)`, `authClient.signOut()`, and `authClient.admin.*` for user management. Calls return `{ data, error }` rather than throwing.
- Routing: signed-in routes go inside the `<Route element={<RequireAuth />}>` group in `App.tsx`, which redirects to `/login` with `state.from`; `/login` is inside `<GuestOnly />`, which sends signed-in users back to `from` (default `/`). After sign-in, `LoginPage` navigates to `from`; after sign-out, `App.tsx` navigates to `/login`. Admin-only routes (currently `/users`) go in the nested `<Route element={<RequireAdmin />}>` group, and their nav links are rendered only for admins.
- Role-gate UI with `session.user.role === "admin"`, but always enforce it on the server with `requireRole` — client checks are only for hiding UI.

### Env and testing

- Env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_ORIGIN` (in `trustedOrigins` because the Vite proxy forwards the browser's `Origin`), plus `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / optional `SEED_ADMIN_NAME` for the seed.
- Server tests (see `src/auth.test.ts`): create users with `auth.api.createUser`, sign in by POSTing to `/api/auth/sign-in/email` with a trusted `Origin` header (required on every POST to `/api/auth/*`), take the `better-auth.session_token=…` pair from `Set-Cookie`, and send it as `Cookie` on later requests. Use unique emails and delete the users in `afterAll`.

## Testing

Three layers: server tests (`bun:test`, real test DB), client component tests (Vitest + React Testing Library, mocked API), and e2e tests (Playwright, full stack). `bun run test` runs the first two; `bun run test:e2e` runs the third.

### Server tests

- Tests use a separate database, `helpdesk_test`, configured in `server/.env.test` (gitignored; copy `server/.env.test.example`). Bun loads `.env.test` automatically under `bun test` (`NODE_ENV=test`), so server tests never touch the dev DB.
- `server/prisma/reset-test-db.ts` (`db:test:reset`) refuses to run unless the database name ends in `_test`. It uses `migrate deploy` + `TRUNCATE` rather than `prisma migrate reset`, because Prisma blocks `migrate reset` when an AI agent runs it.

### Component tests (client)

Test a page or component in isolation: what it renders for each API response (loading, data, empty, error). Flows that span pages, auth, or the real server belong in e2e tests instead.

- **Stack:** Vitest 5 + jsdom, React Testing Library, `@testing-library/jest-dom` matchers, and MSW 3 to mock the API. Config is `client/vitest.config.ts`, which merges `vite.config.ts` so the `@/` alias works.
- **Run:** `bun run test` (root, with the server tests), `bun run --filter client test`, or `bun run test:watch` in `client/`. Don't run `bun test` in `client/` — that's Bun's own runner, not Vitest.
- **Where:** next to the component as `*.test.tsx` (e.g. `src/pages/UsersPage.test.tsx`, the reference). Import `describe` / `test` / `expect` from `vitest` (globals are off).
- **Helpers** in `client/src/test/`:
  - `setup.ts` — loads jest-dom matchers, starts MSW, and after each test runs RTL `cleanup()` and resets handlers. Unhandled requests are errors (MSW 3 renamed `onUnhandledRequest` to `onUnhandledFrame`).
  - `server.ts` — the MSW `server`, with no default handlers; each test registers what it needs with `server.use(...)`.
  - `render.tsx` — `renderWithQuery(ui)` renders inside a fresh `QueryClient` with retries off, so tests don't share cache and errors show immediately; it also returns that `queryClient` for cache assertions. Wrap in a `MemoryRouter` too if the component uses router hooks or `<Link>`.
- **Pattern:**
  ```tsx
  server.use(http.get("/api/users", () => HttpResponse.json({ users })));
  renderWithQuery(<UsersPage />);
  const row = within(await screen.findByRole("row", { name: /Ada Admin/ }));
  expect(row.getByText("Admin")).toBeInTheDocument();
  ```
  - Mock relative `/api/...` paths, exactly as the app requests them through the `api` axios instance. Error responses use the server's shape: `HttpResponse.json({ error: "Forbidden" }, { status: 403 })`; a network failure is `HttpResponse.error()`.
  - Query the way a user would: `getByRole` (with `name`) first, then `getByText`; scope to a row or section with `within`. Use `findBy…` to wait for data, `queryBy…` to assert absence. Avoid test IDs and class names.
  - Loading state: assert it synchronously right after `render`, before awaiting anything. Loading UIs expose `role="status"` / `aria-busy`, which is what tests should target.
  - Locale-dependent output (dates, numbers): build the expected string with the same `Intl` formatter rather than hard-coding it.
- Cover the success render plus the loading, empty, and error states. Check that a test fails when the behavior it guards is broken.

### E2E tests: use the `test-engineer` subagent

Don't write Playwright tests in the main session. Delegate them to the `test-engineer` subagent (`.claude/agents/test-engineer.md`), which knows the Playwright setup, ports, test DB, and conventions.

- **When:** after adding or changing a user-facing flow (a page, form, or role-gated route), to add a regression test for a UI bug, or when `bun run test:e2e` fails.
- **How:** launch it with the Agent tool (`subagent_type: "test-engineer"`). The prompt should include:
  - the feature and the files involved (client pages and components, server routes)
  - the scenarios to cover: the main success path plus the important failures, such as validation, wrong role, or signed out
  - anything special, e.g. which role each flow needs or data it must create
- **What it does:** it writes the specs in `e2e/`, runs them until they pass reliably, and runs `bun run typecheck`. It never changes application code. If it finds an app bug, it marks the test `test.fixme()` and includes the bug in its report.
- **Afterwards:** check its report and fix any app bugs it found. Remove the `fixme`, run `bun run test:e2e` to confirm, and tell the user the results.

## Inbound email

Email sent to the support address becomes a ticket. No email provider is wired up yet, so the webhook takes a provider-neutral payload.

- `server/src/routes/inbound-email.ts`: `POST /api/webhooks/inbound-email`, mounted in `app.ts` **before** `express.json()` because it parses JSON itself with a 1mb limit (emails exceed the 100kb default). No session: callers send the `X-Webhook-Secret` header, compared in constant time with `INBOUND_EMAIL_SECRET`. It returns 503 when the secret or `SUPPORT_EMAIL` is unset, and 401 for a wrong or missing secret.
- Payload: `{ from, fromName?, to: string[], subject?, text?, html?, messageId? }`. It returns 400 unless it has a non-empty `text` or `html`, and 422 unless `to` includes `SUPPORT_EMAIL` (case-insensitive; `Name <addr>` is accepted). `from` is lowercased; an empty subject becomes `(no subject)`; HTML-only mail is converted with `htmlToText` (`server/src/lib/email.ts`).
- It returns 201 `{ ticket }` for a new ticket. A repeated `messageId` returns 200 with the existing ticket, so provider retries don't duplicate. Every email creates a new ticket (no reply threading yet); `Ticket.messageId` is stored for that.
- Adding a provider (SendGrid/Mailgun): write a route that verifies the provider's signature, maps its payload to this shape, and calls the exported `createTicketFromEmail`.
- Local testing: with `bun run dev` running, `bun run email:simulate` (in `server/`) posts a sample email; pass `--from`, `--name`, `--subject`, `--text` or `--message-id` to vary it.
- `Ticket` (`prisma/schema.prisma`): `subject`, plain-text `body`, `fromEmail`, `fromName`, unique `messageId`, `status` (`TicketStatus` enum: `open` | `resolved` | `closed`, default `open`). `category` is the nullable `TicketCategory` enum (`general_question` | `technical_question` | `refund_request`; labels in `client/src/lib/tickets.ts`). Inbound email leaves it null (shown as "Uncategorized") until an agent sets it on the detail page (AI classification is planned). `assignedToId` (nullable FK to `User`, `onDelete: SetNull`) is who works the ticket; soft-deleting a user unassigns their tickets (in `DELETE /api/users/:id`). The `User.assignedTickets` back-relation isn't a Better Auth field — check it survives `auth:generate`.

## Planned but not yet added

Claude API integration, a SendGrid/Mailgun provider for inbound (behind the webhook above) and outbound email, Docker. Follow `tech-stack.md` when adding these, and update this file when they land.
