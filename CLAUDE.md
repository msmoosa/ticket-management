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
- Test (server): `bun run test`
- Build client: `bun run build`
- Single workspace: `bun run --filter server <script>` or `bun run --filter client <script>`
- Prisma (run in `server/`): `bun run db:generate`, `bun run db:migrate` (create + apply a migration), `bun run db:studio`
- Seed (run in `server/`): `bun run db:seed` creates the admin user from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (dev default: `admin@example.com` / `password123`); safe to re-run
- Better Auth schema (run in `server/`): `bun run auth:generate` rewrites the auth models in `prisma/schema.prisma` — rerun after changing auth plugins, check `git diff` that other models survived, then `db:migrate`

Always run `bun run typecheck` and `bun run test` after changes.

## Structure

Bun workspaces monorepo (`client`, `server`).

- `client/` — React 19 + Vite 8 + Tailwind CSS 4 + React Router 8 + shadcn/ui
  - `@/` aliases `client/src/` (set in `tsconfig.json`, `tsconfig.app.json`, and `vite.config.ts`)
  - `src/components/ui/` — shadcn components (generated; add more with `bunx --bun shadcn@latest add <name>` from `client/`); `src/lib/utils.ts` exports `cn`
  - `src/App.tsx` — layout and route table
  - `src/pages/` — one component per route
  - `src/lib/auth-client.ts` — Better Auth React client (`authClient.useSession()`, `signIn.email`, `signOut`)
  - `src/components/RequireAuth.tsx` wraps signed-in routes (redirects to `/login`); `RequireAdmin.tsx` nests inside it for admin-only routes (redirects non-admins to `/`); `GuestOnly.tsx` wraps `/login`
  - Vite proxies `/api/*` to `http://localhost:3000`, so the client calls relative `/api/...` URLs and CORS is not needed in dev
- `server/` — Express 5 running directly on Bun (no build step)
  - `src/app.ts` — `createApp()` builds the Express app (used by both `index.ts` and tests)
  - `src/index.ts` — starts the server on `PORT`
  - `src/routes/` — one `Router` per resource, mounted under `/api/<resource>` in `app.ts`
  - `src/middleware/error-handler.ts` — 404 handler, JSON error handler, `HttpError` class
  - `src/auth.ts` — Better Auth instance; `src/permissions.ts` — admin-plugin access control keyed by the `Role` enum
  - `src/middleware/auth.ts` — `requireAuth` (401 if no session; sets `res.locals.user` / `res.locals.session`) and `requireRole(...roles)` (403; use after `requireAuth`)
  - `GET /api/me` — the signed-in user
  - `src/db.ts` — the shared `prisma` client; import it, never create another `PrismaClient`
  - `prisma/schema.prisma` — data models; `prisma/seed.ts` — seed script; `src/generated/prisma/` — generated client (gitignored)
  - Env vars in `server/.env` (Bun loads it automatically); document new vars in `server/.env.example`

## Conventions

- TypeScript strict mode everywhere. Relative imports include the `.ts` / `.tsx` extension.
- Server: named exports. Client: default export for page and top-level components.
- API responses are JSON. Errors are `{ "error": string }` with an appropriate status.
- To return a 4xx, `throw new HttpError(status, message)` — Express 5 forwards thrown errors and rejected promises from async handlers to the error handler automatically, so no try/catch or async wrapper is needed.
- Server tests use `bun:test`, live next to the code as `*.test.ts`, and start the app with `createApp().listen(0)` then call it with `fetch`.
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
  ```
  After `requireAuth`, `res.locals.user` and `res.locals.session` are typed (see the `Express.Locals` augmentation). To check a session elsewhere, call `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`.

### Users and roles

- Public sign-up is disabled. The first admin comes from `bun run db:seed`; every other user is created by an admin through the admin plugin.
- Admin plugin endpoints live under `/api/auth/admin/*` (`create-user`, `list-users`, `get-user`, `update-user`, `set-role`, `set-user-password`, `remove-user`, `ban-user` / `unban-user`, `list-user-sessions`, `revoke-user-session(s)`, `impersonate-user`). Over HTTP they require an admin session. Server-side, `auth.api.<method>` called **without** `headers` skips the session check (used by the seed and tests); pass `headers` to act as the signed-in user.
- Roles are the Prisma enum `Role` (`admin` | `agent`, default `agent`) on `User.role`. In server code import `Role` from `src/generated/prisma/enums.ts` rather than using string literals. `src/permissions.ts` keys the admin plugin's roles by this enum (`admin` → `adminAc`, `agent` → `userAc`), so the plugin rejects any other value. `auth:generate` keeps the enum type on existing fields.
- The admin plugin also added `User.banned` / `banReason` / `banExpires` and `Session.impersonatedBy`; banned users cannot sign in.
- `User` / `Session` / `Account` / `Verification` models are owned by Better Auth — change them via its config + `auth:generate`, not by hand. Passwords are hashed in `Account.password`, not on `User`.

### Client

- `src/lib/auth-client.ts` exports `authClient` (with `adminClient()`): `authClient.useSession()` → `{ data: { user, session } | null, isPending }`, `authClient.signIn.email(...)`, `authClient.signOut()`, and `authClient.admin.*` for user management. Calls return `{ data, error }` rather than throwing.
- Routing: signed-in routes go inside the `<Route element={<RequireAuth />}>` group in `App.tsx`, which redirects to `/login` with `state.from`; `/login` is inside `<GuestOnly />`, which sends signed-in users back to `from` (default `/`). After sign-in, `LoginPage` navigates to `from`; after sign-out, `App.tsx` navigates to `/login`. Admin-only routes (currently `/users`) go in the nested `<Route element={<RequireAdmin />}>` group, and their nav links are rendered only for admins.
- Role-gate UI with `session.user.role === "admin"`, but always enforce it on the server with `requireRole` — client checks are only for hiding UI.

### Env and testing

- Env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_ORIGIN` (in `trustedOrigins` because the Vite proxy forwards the browser's `Origin`), plus `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / optional `SEED_ADMIN_NAME` for the seed.
- Tests (see `src/auth.test.ts`): create users with `auth.api.createUser`, sign in by POSTing to `/api/auth/sign-in/email` with a trusted `Origin` header (required on every POST to `/api/auth/*`), take the `better-auth.session_token=…` pair from `Set-Cookie`, and send it as `Cookie` on later requests. Use unique emails and delete the users in `afterAll`.

## Planned but not yet added

Claude API integration, SendGrid/Mailgun email, Docker. Follow `tech-stack.md` when adding these, and update this file when they land.
