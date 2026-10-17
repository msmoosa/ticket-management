import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import UsersPage from "./UsersPage.tsx";

// Signed in as Ada Admin (u1).
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u1", role: "admin" } }, isPending: false }),
    signOut: vi.fn(async () => ({ data: { success: true }, error: null })),
  },
}));

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
    ).toEqual(["Name", "Email", "Role", "Status", "Created", "Actions"]);

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

  test("offers delete for agents but not for admins", async () => {
    mockUsers({ users });
    renderWithQuery(<UsersPage />);

    const admin = within(await screen.findByRole("row", { name: /Ada Admin/ }));
    expect(admin.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(admin.getByRole("button", { name: /Edit/ })).toBeInTheDocument();
    const agent = within(screen.getByRole("row", { name: /Alan Agent/ }));
    expect(agent.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
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

    test("is hidden until the Create user button is clicked", async () => {
      mockUsers({ users });
      renderWithQuery(<UsersPage />);

      await screen.findByText("Ada Admin");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      const dialog = await openDialog();
      expect(dialog.getByLabelText("Name")).toBeInTheDocument();
      expect(dialog.getByLabelText("Email")).toBeInTheDocument();
      expect(dialog.getByLabelText("Password")).toBeInTheDocument();
    });

    test("closes when Escape is pressed", async () => {
      mockUsers({ users });
      renderWithQuery(<UsersPage />);

      await openDialog();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    test("closes when clicking outside the dialog", async () => {
      mockUsers({ users });
      renderWithQuery(<UsersPage />);

      await openDialog();
      // Full pointer + mouse sequence of a real click; Base UI dismisses on the outside click, not pointerdown alone.
      fireEvent.pointerDown(document.body);
      fireEvent.mouseDown(document.body);
      fireEvent.pointerUp(document.body);
      fireEvent.mouseUp(document.body);
      fireEvent.click(document.body);

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
  });

  describe("edit user dialog", () => {
    test("each row has an edit button", async () => {
      mockUsers({ users });
      renderWithQuery(<UsersPage />);

      await screen.findByText("Ada Admin");
      for (const { name } of users) {
        expect(
          within(rowFor(name)).getByRole("button", { name: `Edit ${name}` }),
        ).toBeInTheDocument();
      }
    });

    test("opens with the row's user and refreshes the list after saving", async () => {
      let current = users;
      server.use(http.get("/api/users", () => HttpResponse.json({ users: current })));
      server.use(
        http.patch("/api/users/u2", async ({ request }) => {
          const body = (await request.json()) as { name: string; email: string };
          current = current.map((u) => (u.id === "u2" ? { ...u, ...body } : u));
          return HttpResponse.json({ user: current[1] });
        }),
      );
      renderWithQuery(<UsersPage />);

      await screen.findByText("Alan Agent");
      fireEvent.click(screen.getByRole("button", { name: "Edit Alan Agent" }));
      const dialog = within(await screen.findByRole("dialog", { name: "Edit user" }));
      expect(dialog.getByLabelText("Email")).toHaveValue("alan@example.com");

      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Alan Turing" } });
      fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByRole("row", { name: /Alan Turing/ })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.queryByText("Alan Agent")).not.toBeInTheDocument();
    });
  });

  describe("delete user dialog", () => {
    test("each row has a delete button", async () => {
      mockUsers({ users });
      renderWithQuery(<UsersPage />);

      await screen.findByText("Ada Admin");
      for (const { name } of users) {
        expect(
          within(rowFor(name)).getByRole("button", { name: `Delete ${name}` }),
        ).toBeInTheDocument();
      }
    });

    test("removes the row after confirming", async () => {
      let current = users;
      server.use(http.get("/api/users", () => HttpResponse.json({ users: current })));
      server.use(
        http.delete("/api/users/u2", () => {
          current = current.filter((u) => u.id !== "u2");
          return new HttpResponse(null, { status: 204 });
        }),
      );
      renderWithQuery(<UsersPage />);

      await screen.findByText("Alan Agent");
      fireEvent.click(screen.getByRole("button", { name: "Delete Alan Agent" }));
      const dialog = within(await screen.findByRole("alertdialog", { name: "Delete Alan Agent?" }));
      expect(dialog.queryByText(/This is your account/)).not.toBeInTheDocument();
      fireEvent.click(dialog.getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(screen.queryByText("Alan Agent")).not.toBeInTheDocument());
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByText("Ada Admin")).toBeInTheDocument();
      expect(authClient.signOut).not.toHaveBeenCalled();
    });

    test("warns that deleting your own row signs you out", async () => {
      mockUsers({ users });
      server.use(http.delete("/api/users/u1", () => new HttpResponse(null, { status: 204 })));
      renderWithQuery(<UsersPage />);

      await screen.findByText("Ada Admin");
      fireEvent.click(screen.getByRole("button", { name: "Delete Ada Admin" }));
      const dialog = within(await screen.findByRole("alertdialog", { name: "Delete Ada Admin?" }));
      expect(dialog.getByText(/This is your account/)).toBeInTheDocument();

      fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(authClient.signOut).toHaveBeenCalledOnce());
    });
  });
});
