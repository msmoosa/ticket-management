import path from "node:path";
import express, { type Express } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.ts";
import { healthRouter } from "./routes/health.ts";
import { inboundEmailRouter } from "./routes/inbound-email.ts";
import { meRouter } from "./routes/me.ts";
import { ticketsRouter } from "./routes/tickets.ts";
import { usersRouter } from "./routes/users.ts";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.ts";

export function createApp() {
  const app = express();

  // Must come before express.json(), which would consume the request body.
  app.all("/api/auth/*splat", toNodeHandler(auth));

  // Has its own larger JSON body limit, so it also comes before the app-wide parser.
  app.use("/api/webhooks/inbound-email", inboundEmailRouter);

  app.use(express.json());

  app.use("/api/health", healthRouter);
  app.use("/api/me", meRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/tickets", ticketsRouter);

  const clientDir = process.env.CLIENT_DIST_DIR;
  if (clientDir) serveClient(app, path.resolve(clientDir));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// In production the built client (`client/dist`) is served from the same origin as the API, so
// the session cookie and relative `/api` URLs work as in dev (where Vite proxies instead).
function serveClient(app: Express, dir: string) {
  // Vite fingerprints everything under /assets, so it can be cached forever.
  app.use(
    "/assets",
    express.static(path.join(dir, "assets"), { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static(dir, { index: false }));
  // Client-side routes (/tickets/123, …) all load index.html. Unknown /api paths and missing
  // assets fall through to the JSON 404 (index.html in place of a script would fail confusingly).
  app.get("/{*splat}", (req, res, next) => {
    if (/^\/(api|assets)(\/|$)/.test(req.path)) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(dir, "index.html"));
  });
}
