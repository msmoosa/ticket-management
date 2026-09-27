import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { Role } from "./generated/prisma/enums.ts";

export const ac = createAccessControl(defaultStatements);

// Keyed by the Prisma `Role` enum, so the admin plugin only accepts roles the database allows.
export const roles = {
  [Role.admin]: ac.newRole(adminAc.statements),
  [Role.agent]: ac.newRole(userAc.statements),
};
