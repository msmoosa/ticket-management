import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";
import type { User } from "@/lib/users";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import EditUserDialog from "./EditUserDialog.tsx";

const user: User = {
  id: "u2",
  name: "Alan Agent",
  email: "alan@example.com",
  role: "agent",
  banned: false,
  createdAt: "2026-03-02T10:00:00.000Z",
};

// Records every PATCH /api/users/u2 body and answers with `respond` (200 by default).
function mockUpdate(respond: () => Response | Promise<Response> = () =>
  HttpResponse.json({ user })) {
  const bodies: unknown[] = [];
  server.use(
    http.patch("/api/users/u2", async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Edit Alan Agent" }));
  return within(await screen.findByRole("dialog", { name: "Edit user" }));
}

function fill(dialog: ReturnType<typeof within>, values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(dialog.getByLabelText(label), { target: { value } });
  }
}

function save(dialog: ReturnType<typeof within>) {
  fireEvent.click(dialog.getByRole("button", { name: "Save changes" }));
}

describe("EditUserDialog", () => {
  test("opens from the edit icon button with the user's details filled in", async () => {
    renderWithQuery(<EditUserDialog user={user} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const dialog = await openDialog();

    expect(dialog.getByLabelText("Name")).toHaveValue("Alan Agent");
    expect(dialog.getByLabelText("Email")).toHaveValue("alan@example.com");
    expect(dialog.getByLabelText("Password")).toHaveValue("");
    expect(dialog.getByLabelText("Password")).toHaveAccessibleDescription(
      "Leave blank to keep the current password.",
    );
  });

  test("leaves the password out when it is blank", async () => {
    const bodies = mockUpdate();
    renderWithQuery(<EditUserDialog user={user} />);

    const dialog = await openDialog();
    fill(dialog, { Name: "Alan Turing" });
    save(dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bodies).toEqual([{ name: "Alan Turing", email: "alan@example.com" }]);
  });

  test("sends the new password when one is entered", async () => {
    const bodies = mockUpdate();
    renderWithQuery(<EditUserDialog user={user} />);

    const dialog = await openDialog();
    fill(dialog, { Email: "turing@example.com", Password: "new-password" });
    save(dialog);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bodies).toEqual([
      { name: "Alan Agent", email: "turing@example.com", password: "new-password" },
    ]);
  });

  test.each([
    ["Name", "Al", "Name must be at least 3 characters"],
    ["Email", "not-an-email", "Enter a valid email address"],
    ["Password", "1234567", "Password must be at least 8 characters"],
  ])("rejects %s %j and sends nothing", async (label, value, message) => {
    const bodies = mockUpdate();
    renderWithQuery(<EditUserDialog user={user} />);

    const dialog = await openDialog();
    fill(dialog, { [label]: value });
    save(dialog);

    expect(await dialog.findByText(message)).toBeInTheDocument();
    expect(dialog.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    expect(bodies).toHaveLength(0);
  });

  test("shows progress while saving", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    mockUpdate(async () => {
      await pending;
      return HttpResponse.json({ user });
    });
    renderWithQuery(<EditUserDialog user={user} />);

    const dialog = await openDialog();
    save(dialog);

    expect(await dialog.findByRole("button", { name: "Saving…" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("shows the server's error and stays open", async () => {
    mockUpdate(() =>
      HttpResponse.json({ error: "A user with this email already exists" }, { status: 409 }),
    );
    renderWithQuery(<EditUserDialog user={user} />);

    const dialog = await openDialog();
    fill(dialog, { Email: "ada@example.com" });
    save(dialog);

    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "A user with this email already exists",
    );
    expect(dialog.getByLabelText("Email")).toHaveValue("ada@example.com");
  });

  test("falls back to a generic message on a network error", async () => {
    mockUpdate(() => HttpResponse.error());
    renderWithQuery(<EditUserDialog user={user} />);

    const dialog = await openDialog();
    save(dialog);

    expect(await dialog.findByRole("alert")).toHaveTextContent("Failed to update user");
  });

  test("discards unsaved changes when cancelled", async () => {
    renderWithQuery(<EditUserDialog user={user} />);

    const dialog = await openDialog();
    fill(dialog, { Name: "Scratch", Password: "half-typed" });
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const reopened = await openDialog();
    expect(reopened.getByLabelText("Name")).toHaveValue("Alan Agent");
    expect(reopened.getByLabelText("Password")).toHaveValue("");
  });
});
