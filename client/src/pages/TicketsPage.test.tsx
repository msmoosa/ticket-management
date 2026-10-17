import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { describe, expect, test } from "vitest";
import type { TicketListResponse, TicketSummary } from "@/lib/tickets";
import { renderWithQuery } from "@/test/render.tsx";
import { server } from "@/test/server.ts";
import TicketsPage from "./TicketsPage.tsx";

// Newest first, as the server sends them.
const tickets: TicketSummary[] = [
  {
    id: "t3",
    subject: "Refund for double charge",
    fromEmail: "parent@example.com",
    fromName: null,
    status: "open",
    category: "refund_request",
    awaitingReplySince: null,
    createdAt: "2026-05-03T14:30:00.000Z",
  },
  {
    id: "t2",
    subject: "Course video won't play",
    fromEmail: "sam@example.com",
    fromName: "Sam Student",
    status: "resolved",
    category: "technical_question",
    awaitingReplySince: null,
    createdAt: "2026-05-02T09:15:00.000Z",
  },
  {
    id: "t1",
    subject: "Old question",
    fromEmail: "old@example.com",
    fromName: "Olivia Old",
    status: "closed",
    category: null,
    awaitingReplySince: null,
    createdAt: "2026-05-01T08:00:00.000Z",
  },
];

// A GET /api/tickets response: one page holding `list`.
function listResponse(list: TicketSummary[], extra: Partial<TicketListResponse> = {}) {
  return { tickets: list, total: list.length, page: 1, pageSize: 25, ...extra };
}

function mockTickets(response: Parameters<typeof HttpResponse.json>[0], status = 200) {
  server.use(http.get("/api/tickets", () => HttpResponse.json(response, { status })));
}

const formatReceived = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

function renderPage(url = "/tickets") {
  return renderWithQuery(
    <MemoryRouter initialEntries={[url]}>
      <TicketsPage />
    </MemoryRouter>,
  );
}

// Records each GET /api/tickets query string and answers with `tickets` (or a function of the params).
function recordRequests(
  respond: (params: URLSearchParams) => TicketSummary[] | TicketListResponse = () => tickets,
) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get("/api/tickets", ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      const response = respond(params);
      return HttpResponse.json(Array.isArray(response) ? listResponse(response) : response);
    }),
  );
  return requests;
}

const bodyRows = () => within(screen.getAllByRole("rowgroup")[1]!).getAllByRole("row");

describe("TicketsPage", () => {
  test("shows skeleton rows while loading", async () => {
    mockTickets(listResponse(tickets));
    renderPage();

    expect(screen.getByRole("heading", { name: "Tickets", level: 1 })).toBeInTheDocument();
    const body = screen.getAllByRole("rowgroup")[1]!;
    expect(body).toHaveAttribute("aria-busy", "true");
    const placeholders = within(body).getAllByRole("row");
    expect(placeholders).toHaveLength(5);
    // One placeholder per column, so the layout doesn't jump when data arrives.
    for (const row of placeholders) expect(within(row).getAllByRole("cell")).toHaveLength(6);
    expect(screen.queryByText("No tickets yet.")).not.toBeInTheDocument();

    await screen.findByText("Refund for double charge");
    expect(body).toHaveAttribute("aria-busy", "false");
  });

  test("lists tickets newest first, in the order the server returns them", async () => {
    mockTickets(listResponse(tickets));
    renderPage();

    await screen.findByText("Refund for double charge");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Waiting",
      "Subject",
      "From",
      "Category",
      "Status",
      "Received",
    ]);
    expect(bodyRows().map((row) => within(row).getAllByRole("cell")[1]!.textContent)).toEqual([
      "Refund for double charge",
      "Course video won't play",
      "Old question",
    ]);
  });

  test("shows how long each open ticket's sender has waited, by urgency", async () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const HOUR = 3_600_000;
    mockTickets(
      listResponse([
        { ...tickets[0]!, id: "w1", subject: "Waiting briefly", awaitingReplySince: ago(2 * HOUR) },
        { ...tickets[0]!, id: "w2", subject: "Waiting a while", awaitingReplySince: ago(5 * HOUR) },
        { ...tickets[0]!, id: "w3", subject: "Waiting too long", awaitingReplySince: ago(30 * HOUR) },
        { ...tickets[0]!, id: "w4", subject: "Already answered", awaitingReplySince: null },
        { ...tickets[1]!, id: "w5", subject: "Resolved one", awaitingReplySince: ago(HOUR) },
      ]),
    );
    renderPage();
    const waiting = (subject: string) =>
      within(screen.getByRole("row", { name: new RegExp(subject) })).getAllByRole("cell")[0]!;

    await screen.findByText("Waiting briefly");
    expect(waiting("Waiting briefly")).toHaveTextContent(/^2h$/);
    expect(waiting("Waiting a while")).toHaveTextContent(/^5h$/);
    expect(waiting("Waiting too long")).toHaveTextContent(/^30h$/);
    expect(waiting("Already answered")).toHaveTextContent(/^Replied$/);
    // Only open tickets wait.
    expect(waiting("Resolved one")).toHaveTextContent(/^$/);
    // The exact start is on hover.
    expect(within(waiting("Waiting briefly")).getByTitle(/^Waiting since /)).toBeInTheDocument();
    // Waiting can't be sorted (yet), so its heading isn't a button.
    expect(screen.queryByRole("button", { name: "Waiting" })).not.toBeInTheDocument();
  });

  test("links each subject to its ticket", async () => {
    mockTickets(listResponse(tickets));
    renderPage();

    expect(await screen.findByRole("link", { name: "Course video won't play" })).toHaveAttribute(
      "href",
      "/tickets/t2",
    );
  });

  test("shows sender, status and received time for each ticket", async () => {
    mockTickets(listResponse(tickets));
    renderPage();

    const named = within(await screen.findByRole("row", { name: /Course video/ }));
    expect(named.getByText("Sam Student")).toBeInTheDocument();
    expect(named.getByText("sam@example.com")).toBeInTheDocument();
    expect(named.getByText("Resolved")).toBeInTheDocument();
    expect(named.getByText(formatReceived(tickets[1]!.createdAt))).toBeInTheDocument();

    // Without a name, the email address stands alone.
    const unnamed = within(screen.getByRole("row", { name: /Refund/ }));
    expect(unnamed.getByText("parent@example.com")).toBeInTheDocument();
    expect(unnamed.getByText("Open")).toBeInTheDocument();

    expect(within(screen.getByRole("row", { name: /Old question/ })).getByText("Closed"))
      .toBeInTheDocument();
  });

  test("shows each ticket's category, or Uncategorized", async () => {
    mockTickets(
      listResponse([
        ...tickets,
        {
          ...tickets[2]!,
          id: "t0",
          subject: "General enquiry",
          category: "general_question",
        },
      ]),
    );
    renderPage();

    const category = (subject: RegExp) =>
      within(screen.getByRole("row", { name: subject })).getAllByRole("cell")[3]!;

    await screen.findByText("Refund for double charge");
    expect(category(/Refund for double charge/)).toHaveTextContent("Refund");
    expect(category(/Course video/)).toHaveTextContent("Technical");
    expect(category(/General enquiry/)).toHaveTextContent("General question");
    expect(category(/Old question/)).toHaveTextContent("Uncategorized");
  });

  test("requests newest first by default and marks Received as sorted", async () => {
    const requests: string[] = [];
    server.use(
      http.get("/api/tickets", ({ request }) => {
        requests.push(new URL(request.url).search);
        return HttpResponse.json(listResponse(tickets));
      }),
    );
    renderPage();

    await screen.findByText("Refund for double charge");
    expect(requests).toEqual(["?sortBy=createdAt&sortOrder=desc&page=1&pageSize=25"]);
    expect(screen.getByRole("columnheader", { name: /Received/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByRole("columnheader", { name: /Subject/ })).not.toHaveAttribute("aria-sort");
  });

  test("sorts on the server when a column heading is clicked", async () => {
    const requests: string[] = [];
    server.use(
      http.get("/api/tickets", ({ request }) => {
        const params = new URL(request.url).searchParams;
        requests.push(`${params.get("sortBy")} ${params.get("sortOrder")}`);
        // Echo a different order for subject sorts, as the server would.
        const sorted =
          params.get("sortBy") === "subject"
            ? [...tickets].sort((a, b) => a.subject.localeCompare(b.subject))
            : tickets;
        if (params.get("sortOrder") === "desc" && params.get("sortBy") === "subject") sorted.reverse();
        return HttpResponse.json(listResponse(sorted));
      }),
    );
    renderPage();
    await screen.findByText("Refund for double charge");

    const subjects = () => bodyRows().map((row) => within(row).getAllByRole("cell")[1]!.textContent);

    // Text columns start ascending.
    fireEvent.click(screen.getByRole("button", { name: "Subject" }));
    await waitFor(() =>
      expect(subjects()).toEqual(["Course video won't play", "Old question", "Refund for double charge"]),
    );
    expect(screen.getByRole("columnheader", { name: /Subject/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /Received/ })).not.toHaveAttribute("aria-sort");

    // A second click flips the direction instead of clearing the sort.
    fireEvent.click(screen.getByRole("button", { name: "Subject" }));
    await waitFor(() =>
      expect(subjects()).toEqual(["Refund for double charge", "Old question", "Course video won't play"]),
    );
    expect(screen.getByRole("columnheader", { name: /Subject/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    // Received starts newest first.
    fireEvent.click(screen.getByRole("button", { name: "Received" }));
    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: /Received/ })).toHaveAttribute(
        "aria-sort",
        "descending",
      ),
    );

    expect(requests).toEqual([
      "createdAt desc",
      "subject asc",
      "subject desc",
      "createdAt desc",
    ]);
  });

  test("keeps the current rows visible while a new sort order loads", async () => {
    mockTickets(listResponse(tickets));
    renderPage();
    await screen.findByText("Refund for double charge");

    server.use(http.get("/api/tickets", () => new Promise<never>(() => {})));
    fireEvent.click(screen.getByRole("button", { name: "Status" }));

    const body = screen.getAllByRole("rowgroup")[1]!;
    await waitFor(() => expect(body).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByText("Refund for double charge")).toBeInTheDocument();
  });

  test("shows an empty state when there are no tickets", async () => {
    mockTickets(listResponse([]));
    renderPage();

    expect(await screen.findByText("No tickets yet.")).toBeInTheDocument();
  });

  test("shows the server's error message", async () => {
    mockTickets({ error: "Unauthorized" }, 401);
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("falls back to a generic message on a network error", async () => {
    server.use(http.get("/api/tickets", () => HttpResponse.error()));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load tickets");
  });

  describe("filters", () => {
    test("reads sort and filters from the URL", async () => {
      const requests = recordRequests();
      renderPage("/tickets?status=open&category=uncategorized&search=refund&sortBy=subject&sortOrder=asc");

      await screen.findByText("Refund for double charge");
      expect(Object.fromEntries(requests[0]!)).toEqual({
        status: "open",
        category: "uncategorized",
        search: "refund",
        sortBy: "subject",
        sortOrder: "asc",
        page: "1",
        pageSize: "25",
      });
      expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Open");
      expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent("Uncategorized");
      expect(screen.getByRole("searchbox", { name: "Search tickets" })).toHaveValue("refund");
      expect(screen.getByRole("columnheader", { name: /Subject/ })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
    });

    test("ignores unknown filter values in the URL", async () => {
      const requests = recordRequests();
      renderPage("/tickets?status=pending&category=billing&sortBy=body");

      await screen.findByText("Refund for double charge");
      expect(Object.fromEntries(requests[0]!)).toEqual({
        sortBy: "createdAt",
        sortOrder: "desc",
        page: "1",
        pageSize: "25",
      });
      expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("All statuses");
      expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent("All categories");
    });

    test("filters by status and category on the server", async () => {
      const user = userEvent.setup();
      const requests = recordRequests();
      renderPage();
      await screen.findByText("Refund for double charge");

      await user.click(screen.getByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByRole("option", { name: "Resolved" }));
      await waitFor(() => expect(requests.at(-1)!.get("status")).toBe("resolved"));
      expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Resolved");

      await user.click(screen.getByRole("combobox", { name: "Category" }));
      await user.click(await screen.findByRole("option", { name: "Refund" }));
      await waitFor(() => expect(requests.at(-1)!.get("category")).toBe("refund_request"));
      // Filters combine.
      expect(requests.at(-1)!.get("status")).toBe("resolved");

      // "All statuses" removes that filter only.
      await user.click(screen.getByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByRole("option", { name: "All statuses" }));
      await waitFor(() => expect(requests.at(-1)!.has("status")).toBe(false));
      expect(requests.at(-1)!.get("category")).toBe("refund_request");
    });

    test("searches once typing pauses, not on every keystroke", async () => {
      const user = userEvent.setup();
      const requests = recordRequests();
      renderPage();
      await screen.findByText("Refund for double charge");

      await user.type(screen.getByRole("searchbox", { name: "Search tickets" }), "  video ");
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]!.get("search")).toBe("video");
      // The trailing space the user typed stays in the box.
      expect(screen.getByRole("searchbox", { name: "Search tickets" })).toHaveValue("  video ");
    });

    test("keeps filters when sorting and keeps the sort when filtering", async () => {
      const user = userEvent.setup();
      const requests = recordRequests();
      renderPage("/tickets?status=open");
      await screen.findByText("Refund for double charge");

      await user.click(screen.getByRole("button", { name: "Subject" }));
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(Object.fromEntries(requests[1]!)).toEqual({
        status: "open",
        sortBy: "subject",
        sortOrder: "asc",
        page: "1",
        pageSize: "25",
      });

      await user.click(screen.getByRole("combobox", { name: "Category" }));
      await user.click(await screen.findByRole("option", { name: "Technical" }));
      await waitFor(() => expect(requests).toHaveLength(3));
      expect(Object.fromEntries(requests[2]!)).toEqual({
        status: "open",
        category: "technical_question",
        sortBy: "subject",
        sortOrder: "asc",
        page: "1",
        pageSize: "25",
      });
    });

    test("shows a filtered empty state and clears all filters", async () => {
      const user = userEvent.setup();
      const requests = recordRequests((params) => (params.has("search") ? [] : tickets));
      renderPage("/tickets?search=nothing&status=closed&sortBy=subject&sortOrder=asc");

      expect(await screen.findByText("No tickets match these filters.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Clear filters" }));

      await screen.findByText("Refund for double charge");
      // The sort is kept.
      expect(Object.fromEntries(requests.at(-1)!)).toEqual({
        sortBy: "subject",
        sortOrder: "asc",
        page: "1",
        pageSize: "25",
      });
      expect(screen.getByRole("searchbox", { name: "Search tickets" })).toHaveValue("");
      expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("All statuses");
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });

    test("hides Clear filters when no filter is set", async () => {
      mockTickets(listResponse(tickets));
      renderPage();
      await screen.findByText("Refund for double charge");
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    // 60 tickets, served 25 (or `pageSize`) at a time like the server would.
    const many: TicketSummary[] = Array.from({ length: 60 }, (_, i) => ({
      ...tickets[0]!,
      id: `m${i + 1}`,
      subject: `Ticket ${i + 1}`,
    }));
    const servePages = (params: URLSearchParams): TicketListResponse => {
      const page = Number(params.get("page"));
      const pageSize = Number(params.get("pageSize"));
      return {
        tickets: many.slice((page - 1) * pageSize, page * pageSize),
        total: many.length,
        page,
        pageSize,
      };
    };
    const pagination = () => within(screen.getByRole("navigation", { name: "Pagination" }));

    test("shows the range, page count and disables going back from the first page", async () => {
      recordRequests(servePages);
      renderPage();

      await screen.findByText("Ticket 1");
      expect(bodyRows()).toHaveLength(25);
      expect(pagination().getByText("Showing 1–25 of 60")).toBeInTheDocument();
      expect(pagination().getByText("Page 1 of 3")).toBeInTheDocument();
      expect(pagination().getByRole("button", { name: "First page" })).toBeDisabled();
      expect(pagination().getByRole("button", { name: "Previous page" })).toBeDisabled();
      expect(pagination().getByRole("button", { name: "Next page" })).toBeEnabled();
      expect(pagination().getByRole("combobox", { name: "Rows per page" })).toHaveTextContent("25");
    });

    test("moves between pages on the server", async () => {
      const user = userEvent.setup();
      const requests = recordRequests(servePages);
      renderPage();
      await screen.findByText("Ticket 1");

      await user.click(pagination().getByRole("button", { name: "Next page" }));
      await screen.findByText("Ticket 26");
      expect(requests.at(-1)!.get("page")).toBe("2");
      expect(pagination().getByText("Showing 26–50 of 60")).toBeInTheDocument();

      await user.click(pagination().getByRole("button", { name: "Last page" }));
      await screen.findByText("Ticket 51");
      expect(bodyRows()).toHaveLength(10);
      expect(pagination().getByText("Showing 51–60 of 60")).toBeInTheDocument();
      expect(pagination().getByRole("button", { name: "Next page" })).toBeDisabled();
      expect(pagination().getByRole("button", { name: "Last page" })).toBeDisabled();

      await user.click(pagination().getByRole("button", { name: "Previous page" }));
      await screen.findByText("Ticket 26");

      await user.click(pagination().getByRole("button", { name: "First page" }));
      await screen.findByText("Ticket 1");
      expect(requests.map((r) => r.get("page"))).toEqual(["1", "2", "3", "2", "1"]);
    });

    test("reads the page and page size from the URL", async () => {
      const requests = recordRequests(servePages);
      renderPage("/tickets?page=2&pageSize=10");

      await screen.findByText("Ticket 11");
      expect(requests[0]!.get("page")).toBe("2");
      expect(requests[0]!.get("pageSize")).toBe("10");
      expect(pagination().getByText("Page 2 of 6")).toBeInTheDocument();
    });

    test("ignores an invalid page or page size in the URL", async () => {
      const requests = recordRequests(servePages);
      renderPage("/tickets?page=-2&pageSize=7");

      await screen.findByText("Ticket 1");
      expect(requests[0]!.get("page")).toBe("1");
      expect(requests[0]!.get("pageSize")).toBe("25");
    });

    test("changing the page size goes back to the first page", async () => {
      const user = userEvent.setup();
      const requests = recordRequests(servePages);
      renderPage("/tickets?page=2");
      await screen.findByText("Ticket 26");

      await user.click(pagination().getByRole("combobox", { name: "Rows per page" }));
      await user.click(await screen.findByRole("option", { name: "50" }));

      await screen.findByText("Ticket 1");
      expect(bodyRows()).toHaveLength(50);
      expect(requests.at(-1)!.get("page")).toBe("1");
      expect(requests.at(-1)!.get("pageSize")).toBe("50");
      expect(pagination().getByText("Page 1 of 2")).toBeInTheDocument();
    });

    test("sorting or filtering goes back to the first page and keeps the page size", async () => {
      const user = userEvent.setup();
      const requests = recordRequests(servePages);
      renderPage("/tickets?page=3&pageSize=10");
      await screen.findByText("Ticket 21");

      await user.click(screen.getByRole("button", { name: "Subject" }));
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]!.get("page")).toBe("1");
      expect(requests[1]!.get("pageSize")).toBe("10");

      await user.click(pagination().getByRole("button", { name: "Next page" }));
      await waitFor(() => expect(requests).toHaveLength(3));

      await user.click(screen.getByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByRole("option", { name: "Open" }));
      await waitFor(() => expect(requests).toHaveLength(4));
      expect(Object.fromEntries(requests[3]!)).toEqual({
        status: "open",
        sortBy: "subject",
        sortOrder: "asc",
        page: "1",
        pageSize: "10",
      });
    });

    test("jumps to the last page when the URL's page is past the end", async () => {
      const requests = recordRequests(servePages);
      renderPage("/tickets?page=9");

      await screen.findByText("Ticket 51");
      expect(requests.map((r) => r.get("page"))).toEqual(["9", "3"]);
      expect(pagination().getByText("Page 3 of 3")).toBeInTheDocument();
    });

    test("is hidden when there are no tickets", async () => {
      mockTickets(listResponse([]));
      renderPage();

      await screen.findByText("No tickets yet.");
      expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
    });
  });
});
