import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.ts";
import { healthRouter } from "./routes/health.ts";
import { meRouter } from "./routes/me.ts";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.ts";

export function createApp() {
  const app = express();

  // Must come before express.json(), which would consume the request body.
  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(express.json());

  app.use("/api/health", healthRouter);
  app.use("/api/me", meRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
