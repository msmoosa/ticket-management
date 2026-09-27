import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth, type Session } from "../auth.ts";
import type { Role } from "../generated/prisma/enums.ts";
import { HttpError } from "./error-handler.ts";

declare global {
  namespace Express {
    interface Locals {
      session: Session["session"];
      user: Session["user"];
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session) throw new HttpError(401, "Unauthorized");
  res.locals.session = session.session;
  res.locals.user = session.user;
  next();
};

// Use after requireAuth.
export function requireRole(...roles: Role[]): RequestHandler {
  return (_req, res, next) => {
    if (!roles.includes(res.locals.user.role as Role)) {
      throw new HttpError(403, "Forbidden");
    }
    next();
  };
}
