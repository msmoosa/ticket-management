import { Navigate, Outlet } from "react-router";
import { authClient } from "../lib/auth-client.ts";

// Nest inside <RequireAuth />, which handles the pending and signed-out states.
export default function RequireAdmin() {
  const { data: session } = authClient.useSession();

  if (session?.user.role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}
