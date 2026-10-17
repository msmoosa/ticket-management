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

## Deployment (Railway)

The app deploys as **one service** built from the root `Dockerfile`: Express serves the API and the built React client from the same origin, so the session cookie works with no CORS setup. `railway.json` configures the build, a pre-deploy step that runs `bun run db:deploy` (applies Prisma migrations, then creates the admin if `SEED_ADMIN_*` is set), and a healthcheck on `/api/health`.

1. In Railway, create a project from this GitHub repo. It picks up `railway.json` and builds the `Dockerfile`.
2. Add a **PostgreSQL** database to the project.
3. On the app service, under Settings → Networking, generate a public domain (target port `3000`).
4. Set the app service's variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |
   | `BETTER_AUTH_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (or your custom domain) |
   | `CLIENT_IP_HEADER` | `x-real-ip` (Railway's client IP header, for per-user sign-in rate limits) |
   | `SUPPORT_EMAIL` | the address customers write to |
   | `INBOUND_EMAIL_SECRET` | output of `openssl rand -base64 32` |
   | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | the first admin's login (optional `SEED_ADMIN_NAME`) |

5. Deploy. Once you've signed in as the admin, remove `SEED_ADMIN_PASSWORD`: the seed never changes an existing admin, so it isn't needed again.

`CLIENT_ORIGIN` isn't needed in production (the client is served from `BETTER_AUTH_URL`'s origin). If you add a custom domain, update `BETTER_AUTH_URL` to it.

To try the production image locally (needs a reachable Postgres and the variables above in an env file):

```sh
docker build -t ticket-management .
docker run --rm --env-file prod.env ticket-management bun run db:deploy   # migrations + admin
docker run --rm -p 3000:3000 --env-file prod.env ticket-management          # http://localhost:3000
```
