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

Always run `bun run typecheck` and `bun run test` after changes.

## Structure

Bun workspaces monorepo (`client`, `server`).

- `client/` — React 19 + Vite 8 + Tailwind CSS 4 + React Router 8
  - `src/App.tsx` — layout and route table
  - `src/pages/` — one component per route
  - Vite proxies `/api/*` to `http://localhost:3000`, so the client calls relative `/api/...` URLs and CORS is not needed in dev
- `server/` — Express 5 running directly on Bun (no build step)
  - `src/app.ts` — `createApp()` builds the Express app (used by both `index.ts` and tests)
  - `src/index.ts` — starts the server on `PORT`
  - `src/routes/` — one `Router` per resource, mounted under `/api/<resource>` in `app.ts`
  - `src/middleware/error-handler.ts` — 404 handler, JSON error handler, `HttpError` class
  - `src/db.ts` — the shared `prisma` client (Prisma 7 + `@prisma/adapter-pg`); import it, never create another `PrismaClient`
  - `prisma/schema.prisma` — data models; `prisma.config.ts` — CLI config (schema path, migrations, `DATABASE_URL`)
  - `src/generated/prisma/` — generated client, gitignored; regenerate with `bun run db:generate` after schema changes
  - Env vars in `server/.env` (Bun loads it automatically); document new vars in `server/.env.example`

## Conventions

- TypeScript strict mode everywhere. Relative imports include the `.ts` / `.tsx` extension.
- Server: named exports. Client: default export for page and top-level components.
- API responses are JSON. Errors are `{ "error": string }` with an appropriate status.
- To return a 4xx, `throw new HttpError(status, message)` — Express 5 forwards thrown errors and rejected promises from async handlers to the error handler automatically, so no try/catch or async wrapper is needed.
- Server tests use `bun:test`, live next to the code as `*.test.ts`, and start the app with `createApp().listen(0)` then call it with `fetch`.
- Styling: Tailwind utility classes only; no custom CSS beyond `client/src/index.css`.

## Library gotchas (current versions)

- **React Router 8**: import everything from `react-router` (`react-router-dom` no longer exists; DOM-only APIs come from `react-router/dom`). The app uses declarative mode (`<BrowserRouter>`, `<Routes>`, `<Route>`).
- **Tailwind CSS 4**: configured via the `@tailwindcss/vite` plugin and `@import "tailwindcss"` in CSS. There is no `tailwind.config.js`; put theme customization in CSS with `@theme`.
- **Express 5**: path syntax changed from v4 (e.g. wildcards must be named: `/*splat`, not `*`).
- **Prisma 7** (pinned to 7.10.0; npm `latest` is a Prisma 8 RC with a different workflow — don't upgrade): the datasource URL lives in `prisma.config.ts`, not `schema.prisma`; generator is `prisma-client` with an explicit `output`; import `PrismaClient` from `./generated/prisma/client.ts`, not `@prisma/client`. Always run the CLI via the `db:*` scripts — Bun's automatic `.env` loading does not reach the Prisma CLI, so the scripts pass `--env-file=.env`.
- **Bun**: runs TypeScript natively. Use `bun`/`bunx`, not `npm`/`npx`/`node`.
- Look up current docs with context7 before using an API you are unsure about — these libraries are newer than most examples online.

## Database

Local PostgreSQL 18 via Homebrew (`brew services start postgresql@18`), database `helpdesk`. `GET /api/health` runs `SELECT 1` and returns 503 if the database is unreachable. Server tests hit the real local database.

## Planned but not yet added

Database-backed sessions for auth, Claude API integration, SendGrid/Mailgun email, Docker. Follow `tech-stack.md` when adding these, and update this file when they land.
