import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

// Same origin as the app: Vite proxies /api/auth to the server.
export const authClient = createAuthClient({
  plugins: [adminClient()],
});
