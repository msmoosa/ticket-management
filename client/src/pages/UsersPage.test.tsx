import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import UsersPage from "./UsersPage.tsx";

const users = [
  {
    id: "u1",
    name: "Ada Admin",
    email: "ada@example.com",
    role: "admin",
    banned: false,
    createdAt: "2026-01-15T10:00:00.000Z",
  },
  {
    id: "u2",
    name: "Alan Agent",
    email: "alan@example.com",
    role: "agent",
    banned: null,
    createdAt: "2026-03-02T10:00:00.000Z",
  },
  {
    id: "u3",
    name: "Barred Agent",
    email: "barred@example.com",
    role: "agent",
    banned: true,
    createdAt: "2026-04-20T10:00:00.000Z",
  },
];

function mockUsers(response: Parameters<typeof HttpResponse.json>[0], status = 200) {
  server.use(http.get("/api/users", () => HttpResponse.json(response, { status })));
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) });
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));

describe("UsersPage", () => {
  test("shows skeleton rows while loading", async () => {
    mockUsers({ users });
    renderWithQuery(<UsersPage />);

    expect(screen.getByRole("heading", { name: "Users", level: 1 })).toBeInTheDocument();
    const body = screen.getAllByRole("rowgroup")[1]!;
    expect(body).toHaveAttribute("aria-busy", "true");
    expect(within(body).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByText("Ada Admin")).not.toBeInTheDocument();

    await screen.findByText("Ada Admin");
    expect(body).toHaveAttribute("aria-busy", "false");
  });

  test("renders a row per user with role, status and created date", async () => {
    mockUsers({ users });
    renderWithQuery(<UsersPage />);

    await screen.findByText("Ada Admin");
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["Name", "Email", "Role", "Status", "Created"]);

    const admin = within(rowFor("Ada Admin"));
    expect(admin.getByText("ada@example.com")).toBeInTheDocument();
    expect(admin.getByText("Admin")).toBeInTheDocument();
    expect(admin.getByText("Active")).toBeInTheDocument();
    expect(admin.getByText(formatDate(users[0]!.createdAt))).toBeInTheDocument();

    const agent = within(rowFor("Alan Agent"));
    expect(agent.getByText("alan@example.com")).toBeInTheDocument();
    expect(agent.getByText("Agent")).toBeInTheDocument();
    // `banned: null` (never banned) counts as active.
    expect(agent.getByText("Active")).toBeInTheDocument();
  });

  test("shows banned users as Banned", async () => {
    mockUsers({ users });
    renderWithQuery(<UsersPage />);

    const banned = within(await screen.findByRole("row", { name: /Barred Agent/ }));
    expect(banned.getByText("Banned")).toBeInTheDocument();
    expect(banned.queryByText("Active")).not.toBeInTheDocument();
  });

  test("shows an empty state when there are no users", async () => {
    mockUsers({ users: [] });
    renderWithQuery(<UsersPage />);

    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
  });

  test("shows the server's error message", async () => {
    mockUsers({ error: "Forbidden" }, 403);
    renderWithQuery(<UsersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("falls back to a generic message on a network error", async () => {
    server.use(http.get("/api/users", () => HttpResponse.error()));
    renderWithQuery(<UsersPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load users");
  });

  describe("create user dialog", () => {
    const newUser = {
      id: "u4",
      name: "Grace Agent",
      email: "grace@example.com",
      role: "agent",
      banned: false,
      createdAt: "2026-05-01T10:00:00.000Z",
    };

    async function openDialog() {
      await screen.findByText("Ada Admin");
      fireEvent.click(screen.getByRole("button", { name: "Create user" }));
      return within(await screen.findByRole("dialog", { name: "Create user" }));
    }

    function fill(dialog: ReturnType<typeof within>, values: Record<string, string>) {
      for (const [label, value] of Object.entries(values)) {
        fireEvent.change(dialog.getByLabelText(label), { target: { value } });
      }
      fireEvent.click(dialog.getByRole("button", { name: "Create user" }));
    }

    test("shows validation errors and does not submit invalid input", async () => {
      mockUsers({ users });
      let posted = false;
      server.use(
        http.post("/api/users", () => {
          posted = true;
          return HttpResponse.json({ user: newUser }, { status: 201 });
        }),
      );
      renderWithQuery(<UsersPage />);

      const dialog = await openDialog();
      fill(dialog, { Name: "Al", Email: "not-an-email", Password: "short" });

      expect(await dialog.findByText("Name must be at least 3 characters")).toBeInTheDocument();
      expect(dialog.getByText("Enter a valid email address")).toBeInTheDocument();
      expect(dialog.getByText("Password must be at least 8 characters")).toBeInTheDocument();
      expect(dialog.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
      expect(posted).toBe(false);
    });

    test("creates the user, closes the dialog and refreshes the list", async () => {
      let current = users;
      server.use(http.get("/api/users", () => HttpResponse.json({ users: current })));
      let body: unknown;
      server.use(
        http.post("/api/users", async ({ request }) => {
          body = await request.json();
          current = [...users, newUser];
          return HttpResponse.json({ user: newUser }, { status: 201 });
        }),
      );
      renderWithQuery(<UsersPage />);

      const dialog = await openDialog();
      fill(dialog, { Name: "Grace Agent", Email: "grace@example.com", Password: "password123" });

      expect(await screen.findByRole("row", { name: /Grace Agent/ })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(body).toEqual({
        name: "Grace Agent",
        email: "grace@example.com",
        password: "password123",
      });
    });

    test("shows the server's error and keeps the dialog open", async () => {
      mockUsers({ users });
      server.use(
        http.post("/api/users", () =>
          HttpResponse.json({ error: "A user with this email already exists" }, { status: 409 }),
        ),
      );
      renderWithQuery(<UsersPage />);

      const dialog = await openDialog();
      fill(dialog, { Name: "Ada Again", Email: "ada@example.com", Password: "password123" });

      expect(await dialog.findByRole("alert")).toHaveTextContent(
        "A user with this email already exists",
      );
      expect(screen.getByRole("dialog", { name: "Create user" })).toBeInTheDocument();
    });
  });
});
