import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { prisma } from "./db.ts";
import { ac, admin, agent } from "./permissions.ts";

// BETTER_AUTH_SECRET and BETTER_AUTH_URL are read from the environment.
// No secondaryStorage is configured, so sessions are stored in the database.
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  // The Vite dev server proxies /api, so browser requests carry the client's Origin.
  trustedOrigins: process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : [],
  plugins: [
    adminPlugin({
      ac,
      roles: { admin, agent },
      defaultRole: "agent",
      adminRoles: ["admin"],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
