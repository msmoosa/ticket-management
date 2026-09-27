import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";

export const ac = createAccessControl(defaultStatements);

export const admin = ac.newRole(adminAc.statements);
export const agent = ac.newRole(userAc.statements);
