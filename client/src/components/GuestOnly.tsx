import { Navigate, Outlet, useLocation, type Location } from "react-router";
import { authClient } from "../lib/auth-client.ts";
import PageSkeleton from "./PageSkeleton.tsx";

// Wraps /login: signed-in users are sent back where they came from.
export default function GuestOnly() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";

  if (isPending) return <PageSkeleton />;
  if (session) return <Navigate to={from} replace />;
  return <Outlet />;
}
