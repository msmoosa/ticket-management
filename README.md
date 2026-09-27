# Ticket Management

AI-powered support ticket management. See [project-scope.md](project-scope.md), [tech-stack.md](tech-stack.md) and [implementation-plan.md](implementation-plan.md).

## Structure

- `client/` — React + TypeScript + Vite + Tailwind CSS + React Router
- `server/` — Express + TypeScript, running on Bun, with Prisma 7 + PostgreSQL

## Getting started

Requires [Bun](https://bun.sh) and PostgreSQL.

```sh
bun install
createdb helpdesk
cp server/.env.example server/.env   # then set DATABASE_URL
bun run --filter server db:generate  # generate the Prisma client
bun run dev        # client on http://localhost:5173, API on http://localhost:3000
```

The Vite dev server proxies `/api/*` to the Express server.

## Scripts (from the repo root)

| Command | What it does |
| --- | --- |
| `bun run dev` | Start client and server in watch mode |
| `bun run build` | Typecheck and build the client |
| `bun run typecheck` | Typecheck both workspaces |
| `bun run test` | Run server tests with `bun test` |
