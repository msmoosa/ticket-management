# One image for the whole app: Express serves the API and the built React client on one origin.
# Used by Railway (see railway.json); also runs locally, see "Deployment" in README.md.
ARG BUN_VERSION=1.4.2

# --- Build: install everything, generate the Prisma client, build the client ---
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY client/package.json client/
COPY server/package.json server/
RUN bun install --frozen-lockfile
COPY client client
COPY server server
# prisma.config.ts reads DATABASE_URL, but generating the client never connects.
RUN cd server && DATABASE_URL=postgresql://build@localhost/build bun --bun prisma generate
RUN bun run --filter client build

# --- Production dependencies of the server only ---
# `bun install --production --filter server` still installs every workspace's packages, so drop
# the client from the workspace list instead. Versions still come from bun.lock (not frozen,
# since the lockfile lists the client too; `--production` would imply frozen).
# Peers are omitted too: bun would add TypeScript (Prisma) and React (Better Auth), unused here.
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json server/
RUN bun -e 'const p = await Bun.file("package.json").json(); p.workspaces = ["server"]; delete p.devDependencies; await Bun.write("package.json", JSON.stringify(p))' \
 && bun install --omit=dev --omit=peer --no-save

# --- Runtime ---
FROM oven/bun:${BUN_VERSION}-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    CLIENT_DIST_DIR=/app/client/dist
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/server/node_modules server/node_modules
COPY server server
COPY --from=build /app/server/src/generated server/src/generated
COPY --from=build /app/client/dist client/dist
USER bun
WORKDIR /app/server
EXPOSE 3000
# Migrations run separately before each deploy (`bun run db:deploy`, Railway's pre-deploy command).
CMD ["bun", "src/index.ts"]
