import { Navigate, Outlet, useLocation, type Location } from "react-router";
import { authClient } from "../lib/auth-client.ts";

// Wraps /login and /signup: signed-in users are sent back where they came from.
export default function GuestOnly() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";

  if (isPending) return <p className="text-sm text-gray-500">Loading…</p>;
  if (session) return <Navigate to={from} replace />;
  return <Outlet />;
}
