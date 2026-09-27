import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins/admin";
import { prisma } from "./db.ts";
import { Role } from "./generated/prisma/enums.ts";
import { ac, roles } from "./permissions.ts";

// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment.
// No secondaryStorage is configured, so sessions are stored in the database.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  // No public sign-up: admins create users (admin plugin), and the first admin comes from `bun run db:seed`.
  emailAndPassword: { enabled: true, disableSignUp: true },
  // The Vite dev server proxies /api, so browser requests carry the client's Origin.
  trustedOrigins: process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : [],
  plugins: [
    admin({
      ac,
      roles,
      defaultRole: Role.agent,
      adminRoles: [Role.admin],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
