import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import CreateUserDialog from "./CreateUserDialog.tsx";

const valid = { Name: "Grace Agent", Email: "grace@example.com", Password: "password123" };

const createdUser = {
  id: "u1",
  name: "Grace Agent",
  email: "grace@example.com",
  role: "agent",
  banned: false,
  createdAt: "2026-05-01T10:00:00.000Z",
};

// Records every POST /api/users body and answers with `respond` (201 by default).
function mockCreate(respond: () => Response | Promise<Response> = () =>
  HttpResponse.json({ user: createdUser }, { status: 201 })) {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/users", async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

async function openDialog() {
  renderWithQuery(<CreateUserDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Create user" }));
  return within(await screen.findByRole("dialog", { name: "Create user" }));
}

function fill(dialog: ReturnType<typeof within>, values: Partial<typeof valid>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(dialog.getByLabelText(label), { target: { value } });
  }
}

function submit(dialog: ReturnType<typeof within>) {
  fireEvent.click(dialog.getByRole("button", { name: "Create user" }));
}

describe("CreateUserDialog form", () => {
  test("starts with empty name, email and password fields and no errors", async () => {
    const dialog = await openDialog();

    expect(dialog.getByLabelText("Name")).toHaveValue("");
    expect(dialog.getByLabelText("Email")).toHaveValue("");
    expect(dialog.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(dialog.getByLabelText("Password")).toHaveValue("");
    expect(dialog.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("shows an error for every field when submitted empty and sends nothing", async () => {
    const bodies = mockCreate();
    const dialog = await openDialog();

    submit(dialog);

    expect(await dialog.findByText("Name must be at least 3 characters")).toBeInTheDocument();
    expect(dialog.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(dialog.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    for (const label of ["Name", "Email", "Password"]) {
      expect(dialog.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    }
    expect(bodies).toHaveLength(0);
  });

  test.each([
    ["Name", "Al", "Name must be at least 3 characters"],
    ["Name", "  Al  ", "Name must be at least 3 characters"],
    ["Email", "not-an-email", "Enter a valid email address"],
    ["Email", "grace@", "Enter a valid email address"],
    ["Password", "1234567", "Password must be at least 8 characters"],
  ] as const)("rejects %s %j", async (label, value, message) => {
    const bodies = mockCreate();
    const dialog = await openDialog();

    fill(dialog, { ...valid, [label]: value });
    submit(dialog);

    expect(await dialog.findByText(message)).toBeInTheDocument();
    expect(dialog.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    // Only the invalid field is flagged.
    for (const other of ["Name", "Email", "Password"].filter((l) => l !== label)) {
      expect(dialog.getByLabelText(other)).not.toHaveAttribute("aria-invalid");
    }
    expect(bodies).toHaveLength(0);
  });

  test("accepts the minimum lengths: 3-character name and 8-character password", async () => {
    const bodies = mockCreate();
    const dialog = await openDialog();

    fill(dialog, { ...valid, Name: "Ada", Password: "12345678" });
    submit(dialog);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ name: "Ada", password: "12345678" });
  });

  test("clears a field's error once it is corrected", async () => {
    mockCreate();
    const dialog = await openDialog();

    fill(dialog, { ...valid, Name: "Al" });
    submit(dialog);
    expect(await dialog.findByText("Name must be at least 3 characters")).toBeInTheDocument();

    fill(dialog, { Name: "Alan" });

    await waitFor(() =>
      expect(dialog.queryByText("Name must be at least 3 characters")).not.toBeInTheDocument(),
    );
    expect(dialog.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });

  test("posts the trimmed name, email and password, then closes", async () => {
    const bodies = mockCreate();
    const dialog = await openDialog();

    fill(dialog, { ...valid, Name: "  Grace Agent  " });
    submit(dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bodies).toEqual([
      { name: "Grace Agent", email: "grace@example.com", password: "password123" },
    ]);
  });

  test("disables the submit button and shows progress while creating", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    mockCreate(async () => {
      await pending;
      return HttpResponse.json({ user: createdUser }, { status: 201 });
    });
    const dialog = await openDialog();

    fill(dialog, valid);
    submit(dialog);

    expect(await dialog.findByRole("button", { name: "Creating…" })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("shows the server's error, keeps the dialog open and keeps the typed values", async () => {
    mockCreate(() =>
      HttpResponse.json({ error: "A user with this email already exists" }, { status: 409 }),
    );
    const dialog = await openDialog();

    fill(dialog, valid);
    submit(dialog);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "A user with this email already exists",
    );
    expect(screen.getByRole("dialog", { name: "Create user" })).toBeInTheDocument();
    expect(dialog.getByLabelText("Name")).toHaveValue(valid.Name);
    expect(dialog.getByLabelText("Email")).toHaveValue(valid.Email);
    expect(dialog.getByRole("button", { name: "Create user" })).toBeEnabled();
  });

  test("falls back to a generic message on a network error", async () => {
    mockCreate(() => HttpResponse.error());
    const dialog = await openDialog();

    fill(dialog, valid);
    submit(dialog);

    expect(await dialog.findByRole("alert")).toHaveTextContent("Failed to create user");
  });

  test("succeeds on a retry after a server error", async () => {
    let attempt = 0;
    const bodies = mockCreate(() =>
      ++attempt === 1
        ? HttpResponse.json({ error: "A user with this email already exists" }, { status: 409 })
        : HttpResponse.json({ user: createdUser }, { status: 201 }),
    );
    const dialog = await openDialog();

    fill(dialog, { ...valid, Email: "taken@example.com" });
    submit(dialog);
    await dialog.findByRole("alert");

    fill(dialog, { Email: "grace@example.com" });
    submit(dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ email: "grace@example.com" });
  });

  test("is empty again when reopened after Cancel", async () => {
    const dialog = await openDialog();

    fill(dialog, { Name: "Al", Email: "half-typed" });
    submit(dialog);
    await dialog.findByText("Name must be at least 3 characters");
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    const reopened = within(await screen.findByRole("dialog", { name: "Create user" }));

    expect(reopened.getByLabelText("Name")).toHaveValue("");
    expect(reopened.getByLabelText("Email")).toHaveValue("");
    expect(reopened.queryByText("Name must be at least 3 characters")).not.toBeInTheDocument();
  });

  test("is empty again when reopened after creating a user", async () => {
    mockCreate();
    const dialog = await openDialog();

    fill(dialog, valid);
    submit(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    const reopened = within(await screen.findByRole("dialog", { name: "Create user" }));

    expect(reopened.getByLabelText("Name")).toHaveValue("");
    expect(reopened.getByLabelText("Email")).toHaveValue("");
    expect(reopened.getByLabelText("Password")).toHaveValue("");
  });
});
