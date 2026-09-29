import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import type { User } from "@/lib/users";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import DeleteUserDialog from "./DeleteUserDialog.tsx";

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn(async () => ({ data: { success: true }, error: null })) },
}));

const user: User = {
  id: "u2",
  name: "Alan Agent",
  email: "alan@example.com",
  role: "agent",
  banned: false,
  createdAt: "2026-03-02T10:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(authClient.signOut).mockClear();
});

// Counts DELETE /api/users/u2 calls and answers with `respond` (204 by default).
function mockDelete(respond: () => Response | Promise<Response> = () =>
  new HttpResponse(null, { status: 204 })) {
  const calls = { count: 0 };
  server.use(
    http.delete("/api/users/u2", () => {
      calls.count++;
      return respond();
    }),
  );
  return calls;
}

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Delete Alan Agent" }));
  return within(await screen.findByRole("alertdialog", { name: "Delete Alan Agent?" }));
}

describe("DeleteUserDialog", () => {
  test("asks for confirmation, naming the user", async () => {
    const calls = mockDelete();
    renderWithQuery(<DeleteUserDialog user={user} isCurrentUser={false} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    const dialog = await openDialog();

    expect(dialog.getByText(/alan@example\.com will be removed/)).toBeInTheDocument();
    expect(dialog.queryByText(/This is your account/)).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(calls.count).toBe(0);
  });

  test("Cancel closes without deleting", async () => {
    const calls = mockDelete();
    renderWithQuery(<DeleteUserDialog user={user} isCurrentUser={false} />);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(calls.count).toBe(0);
  });

  test("Delete sends the request once and closes", async () => {
    const calls = mockDelete();
    renderWithQuery(<DeleteUserDialog user={user} isCurrentUser={false} />);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(calls.count).toBe(1);
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  test("disables the button while deleting", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    mockDelete(async () => {
      await pending;
      return new HttpResponse(null, { status: 204 });
    });
    renderWithQuery(<DeleteUserDialog user={user} isCurrentUser={false} />);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));

    expect(await dialog.findByRole("button", { name: "Deleting…" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  test("shows the server's error and stays open", async () => {
    mockDelete(() => HttpResponse.json({ error: "User not found" }, { status: 404 }));
    renderWithQuery(<DeleteUserDialog user={user} isCurrentUser={false} />);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));

    expect(await dialog.findByRole("alert")).toHaveTextContent("User not found");
    expect(dialog.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  test("falls back to a generic message on a network error, cleared on reopen", async () => {
    mockDelete(() => HttpResponse.error());
    renderWithQuery(<DeleteUserDialog user={user} isCurrentUser={false} />);

    const dialog = await openDialog();
    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Failed to delete user");

    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    const reopened = await openDialog();
    expect(reopened.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("warns when deleting your own account and signs out afterwards", async () => {
    const calls = mockDelete();
    renderWithQuery(<DeleteUserDialog user={user} isCurrentUser />);

    const dialog = await openDialog();
    expect(dialog.getByText(/This is your account, so you'll be signed out too\./)).toBeInTheDocument();

    fireEvent.click(dialog.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(authClient.signOut).toHaveBeenCalledOnce());
    expect(calls.count).toBe(1);
  });
});
