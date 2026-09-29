import { Link, Route, Routes, useNavigate } from "react-router";
import GuestOnly from "./components/GuestOnly.tsx";
import RequireAdmin from "./components/RequireAdmin.tsx";
import RequireAuth from "./components/RequireAuth.tsx";
import { authClient } from "./lib/auth-client.ts";
import { queryClient } from "./lib/query-client.ts";
import HomePage from "./pages/HomePage.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import NotFoundPage from "./pages/NotFoundPage.tsx";
import UsersPage from "./pages/UsersPage.tsx";

export default function App() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();

  async function handleSignOut() {
    await authClient.signOut();
    // Drop cached data so the next user never sees the previous user's results.
    queryClient.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <Link to="/" className="font-semibold">
            Ticket Management
          </Link>
          {session?.user.role === "admin" && (
            <Link to="/users" className="text-sm text-gray-600 hover:text-gray-900">
              Users
            </Link>
          )}
          {session && (
            <div className="ml-auto flex items-center gap-4 text-sm">
              <span className="text-gray-600">{session.user.name}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-blue-700 hover:underline"
              >
                Sign out
              </button>
            </div>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="login" element={<LoginPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route index element={<HomePage />} />
            <Route element={<RequireAdmin />}>
              <Route path="users" element={<UsersPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
