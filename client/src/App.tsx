import { Inbox, LayoutDashboard, LogOut, Users } from "lucide-react";
import { NavLink, Route, Routes, useNavigate } from "react-router";
import GuestOnly from "./components/GuestOnly.tsx";
import RequireAdmin from "./components/RequireAdmin.tsx";
import RequireAuth from "./components/RequireAuth.tsx";
import Wordmark from "./components/Wordmark.tsx";
import { Button } from "./components/ui/button.tsx";
import { authClient } from "./lib/auth-client.ts";
import { queryClient } from "./lib/query-client.ts";
import { cn } from "./lib/utils.ts";
import DashboardPage from "./pages/DashboardPage.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import NotFoundPage from "./pages/NotFoundPage.tsx";
import TicketDetailPage from "./pages/TicketDetailPage.tsx";
import TicketsPage from "./pages/TicketsPage.tsx";
import UsersPage from "./pages/UsersPage.tsx";

function NavItem({ to, icon: Icon, children }: { to: string; icon: typeof Inbox; children: string }) {
  return (
    <NavLink
      to={to}
      // "/" would otherwise match every page.
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )
      }
    >
      <Icon aria-hidden className="size-4" />
      {children}
    </NavLink>
  );
}

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
    <div className="min-h-screen bg-background text-foreground">
      {/* One element for both layouts: a top bar on narrow screens, a fixed sidebar from `lg`. */}
      {session && (
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-sidebar-border bg-sidebar px-4 py-3 lg:fixed lg:inset-y-0 lg:left-0 lg:w-60 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-6 lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
          <div className="lg:px-2.5">
            <Wordmark />
          </div>
          <nav
            aria-label="Main"
            className="order-last flex w-full gap-1 overflow-x-auto lg:order-none lg:w-auto lg:flex-col"
          >
            <NavItem to="/" icon={LayoutDashboard}>
              Dashboard
            </NavItem>
            <NavItem to="/tickets" icon={Inbox}>
              Tickets
            </NavItem>
            {session.user.role === "admin" && (
              <NavItem to="/users" icon={Users}>
                Users
              </NavItem>
            )}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2 lg:mt-auto lg:ml-0 lg:border-t lg:border-sidebar-border lg:pt-4 lg:pl-2.5">
            <p className="min-w-0 truncate text-sm font-medium">{session.user.name}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSignOut}
              className="ml-auto text-muted-foreground"
            >
              <LogOut data-icon="inline-start" aria-hidden />
              Sign out
            </Button>
          </div>
        </header>
      )}
      <main className={cn(session && "lg:pl-60")}>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="login" element={<LoginPage />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route index element={<DashboardPage />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="tickets/:id" element={<TicketDetailPage />} />
              <Route element={<RequireAdmin />}>
                <Route path="users" element={<UsersPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
