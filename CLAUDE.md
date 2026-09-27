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

- `client/` — React 19 + Vite 8 + Tailwind CSS 4 + React Router 8
  - `src/App.tsx` — layout and route table
  - `src/pages/` — one component per route
  - `src/lib/auth-client.ts` — Better Auth React client (`authClient.useSession()`, `signIn.email`, `signOut`)
  - `src/components/RequireAuth.tsx` wraps signed-in routes (redirects to `/login`); `GuestOnly.tsx` wraps `/login`
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
- Styling: Tailwind utility classes only; no custom CSS beyond `client/src/index.css`.
- Use context7 mcp server to fetch upto date documentation for libraries

## Library gotchas (current versions)

- **React Router 8**: import everything from `react-router` (`react-router-dom` no longer exists; DOM-only APIs come from `react-router/dom`). The app uses declarative mode (`<BrowserRouter>`, `<Routes>`, `<Route>`).
- **Tailwind CSS 4**: configured via the `@tailwindcss/vite` plugin and `@import "tailwindcss"` in CSS. There is no `tailwind.config.js`; put theme customization in CSS with `@theme`.
- **Express 5**: path syntax changed from v4 (e.g. wildcards must be named: `/*splat`, not `*`).
- **Bun**: runs TypeScript natively. Use `bun`/`bunx`, not `npm`/`npx`/`node`.
- Look up current docs with context7 before using an API you are unsure about — these libraries are newer than most examples online.

## Auth

- Better Auth 1.7, email/password, sessions stored in the `session` table (no secondary storage).
- The handler is mounted at `/api/auth/*splat` **before** `express.json()` in `app.ts` — the body parser would otherwise consume the request.
- Public sign-up is disabled (`disableSignUp`). Users are created with the admin plugin: `auth.api.createUser` called server-side without headers needs no session (used by the seed and tests); over HTTP, `/api/auth/admin/*` requires an admin session.
- Roles are the Prisma enum `Role` (`admin` | `agent`, default `agent`) on `User.role`. In server code import `Role` from `src/generated/prisma/enums.ts` rather than using string literals. `src/permissions.ts` keys the admin plugin's roles by this enum, so the plugin rejects any other value. `auth:generate` keeps the enum type on existing fields.
- `User` / `Session` / `Account` / `Verification` models are owned by Better Auth — change them via its config + `auth:generate`, not by hand.
- Env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CLIENT_ORIGIN` (in `trustedOrigins` because the Vite proxy forwards the browser's `Origin`). Tests that POST to `/api/auth/*` must send a trusted `Origin` header.

## Planned but not yet added

Claude API integration, SendGrid/Mailgun email, Docker. Follow `tech-stack.md` when adding these, and update this file when they land.
