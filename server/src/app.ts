import express from "express";
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
