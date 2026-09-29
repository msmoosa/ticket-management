import { Navigate, Outlet, useLocation } from "react-router";
import { authClient } from "../lib/auth-client.ts";
import PageSkeleton from "./PageSkeleton.tsx";

export default function RequireAuth() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();

  if (isPending) return <PageSkeleton />;
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
