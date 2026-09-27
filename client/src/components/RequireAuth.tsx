import { Navigate, Outlet, useLocation } from "react-router";
import { authClient } from "../lib/auth-client.ts";

export default function RequireAuth() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();

  if (isPending) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
