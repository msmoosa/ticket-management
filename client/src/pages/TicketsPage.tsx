import { useCallback, useEffect, useMemo } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import TicketFilters, { type TicketFilterValues } from "@/components/TicketFilters";
import TicketPagination, { pageCount } from "@/components/TicketPagination";
import TicketStatusBadge from "@/components/TicketStatusBadge";
import WaitingTime from "@/components/WaitingTime";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, apiErrorMessage } from "@/lib/api";
import {
  defaultTicketPageSize,
  ticketCategories,
  ticketCategoryLabel,
  ticketPageSizes,
  ticketStatuses,
  type TicketCategoryFilter,
  type TicketListParams,
  type TicketListResponse,
  type TicketSummary,
} from "@/lib/tickets";

const receivedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const SKELETON_ROWS = 5;

// Placeholder row shaped like a real one: wait, subject, two-line sender, category, status, date.
function TicketRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-10" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-56" />
      </TableCell>
      <TableCell>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-14 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-32" />
      </TableCell>
    </TableRow>
  );
}

// Links to the ticket, passing the list's URL along so the detail page can go back to the same
// sort, filters and page.
function SubjectLink({ ticket }: { ticket: TicketSummary }) {
  const location = useLocation();
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      state={{ from: `${location.pathname}${location.search}` }}
      className="block max-w-md truncate font-medium hover:underline"
    >
      {ticket.subject}
    </Link>
  );
}

// Sorting happens on the server, so the table only tracks sorting state (no sorted row model).
const features = tableFeatures({ rowSortingFeature });
const column = createColumnHelper<typeof features, TicketSummary>();

// Column ids double as the server's `sortBy` values.
const columns = column.columns([
  column.accessor("awaitingReplySince", {
    id: "waiting",
    header: "Waiting",
    // Descending = longest wait first.
    sortDescFirst: true,
    // Only open tickets wait; "Replied" means the next move is the sender's.
    cell: ({ row: { original: ticket } }) =>
      ticket.status !== "open" ? null : ticket.awaitingReplySince ? (
        <WaitingTime since={ticket.awaitingReplySince} />
      ) : (
        <span className="text-muted-foreground">Replied</span>
      ),
  }),
  column.accessor("subject", {
    header: "Subject",
    cell: ({ row: { original: ticket } }) => <SubjectLink ticket={ticket} />,
  }),
  column.accessor("fromEmail", {
    header: "From",
    cell: ({ row: { original: ticket } }) =>
      ticket.fromName ? (
        <div className="flex flex-col">
          <span>{ticket.fromName}</span>
          <span className="text-xs text-muted-foreground">{ticket.fromEmail}</span>
        </div>
      ) : (
        ticket.fromEmail
      ),
  }),
  column.accessor("category", {
    header: "Category",
    cell: (info) => {
      const category = info.getValue();
      return category ? (
        ticketCategoryLabel[category]
      ) : (
        <span className="text-muted-foreground">Uncategorized</span>
      );
    },
  }),
  column.accessor("status", {
    header: "Status",
    cell: (info) => (
<TicketStatusBadge status={info.getValue()} />
    ),
  }),
  column.accessor("createdAt", {
    header: "Received",
    sortDescFirst: true,
    cell: (info) => (
      <span className="text-muted-foreground">
        {receivedFormat.format(new Date(info.getValue()))}
      </span>
    ),
  }),
]);

const noTickets: TicketSummary[] = [];

const ariaSort = { asc: "ascending", desc: "descending" } as const;

const sortFields: TicketListParams["sortBy"][] = [
  "waiting",
  "subject",
  "fromEmail",
  "category",
  "status",
  "createdAt",
];
const categoryFilters: TicketCategoryFilter[] = [...ticketCategories, "uncategorized"];

function oneOf<T extends string>(values: readonly T[], value: string | null): T | undefined {
  return values.find((v) => v === value);
}

function positiveInt(value: string | null) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

// Sort, filters and page live in the URL (`/tickets?status=open&sortBy=subject&page=2…`), so
// views can be linked to, survive a reload, and work with back/forward. Unknown values are
// ignored. Defaults (newest first, page 1, 25 per page) are left out of the URL.
function readParams(params: URLSearchParams): TicketListParams {
  const search = params.get("search")?.trim();
  const pageSize = positiveInt(params.get("pageSize"));
  return {
    sortBy: oneOf(sortFields, params.get("sortBy")) ?? "createdAt",
    sortOrder: params.get("sortOrder") === "asc" ? "asc" : "desc",
    status: oneOf(ticketStatuses, params.get("status")),
    category: oneOf(categoryFilters, params.get("category")),
    search: search || undefined,
    page: positiveInt(params.get("page")) ?? 1,
    pageSize: ticketPageSizes.find((size) => size === pageSize) ?? defaultTicketPageSize,
  };
}

function writeParams(list: TicketListParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(list)) {
    if (value !== undefined) params.set(key, String(value));
  }
  if (list.sortBy === "createdAt" && list.sortOrder === "desc") {
    params.delete("sortBy");
    params.delete("sortOrder");
  }
  if (list.page === 1) params.delete("page");
  if (list.pageSize === defaultTicketPageSize) params.delete("pageSize");
  return params;
}

export default function TicketsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => readParams(searchParams), [searchParams]);
  const { status, category, search } = params;
  const filtering = Boolean(status || category || search);

  const sorting: SortingState = useMemo(
    () => [{ id: params.sortBy, desc: params.sortOrder === "desc" }],
    [params.sortBy, params.sortOrder],
  );

  const setSorting = (updater: Updater<SortingState>) => {
    const [next] = typeof updater === "function" ? updater(sorting) : updater;
    if (!next) return;
    setSearchParams(
      writeParams({
        ...params,
        sortBy: oneOf(sortFields, next.id) ?? "createdAt",
        sortOrder: next.desc ? "desc" : "asc",
        // A new order starts back at the first page.
        page: 1,
      }),
    );
  };

  // Stable while the URL is unchanged, so the debounced search in TicketFilters doesn't reset.
  const filterValues = useMemo<TicketFilterValues>(
    () => ({ status, category, search }),
    [status, category, search],
  );
  // New filters start back at the first page.
  const setFilters = useCallback(
    (next: TicketFilterValues) =>
      setSearchParams((current) => {
        const { sortBy, sortOrder, pageSize } = readParams(current);
        return writeParams({ sortBy, sortOrder, pageSize, ...next, page: 1 });
      }),
    [setSearchParams],
  );

  const setPage = (page: number) => setSearchParams(writeParams({ ...params, page }));
  const setPageSize = (pageSize: number) =>
    setSearchParams(writeParams({ ...params, pageSize, page: 1 }));

  const { data, error, isPending, isPlaceholderData } = useQuery({
    queryKey: ["tickets", params],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketListResponse>("/tickets", { params, signal });
      return data;
    },
    // Keep showing the current rows while a new sort, filter or page loads.
    placeholderData: keepPreviousData,
  });
  const tickets = data?.tickets;

  // A page past the end (a stale link, or tickets removed since) jumps to the last page.
  const lastPage = data && !isPlaceholderData ? pageCount(data.total, params.pageSize) : undefined;
  useEffect(() => {
    if (lastPage !== undefined && params.page > lastPage) {
      setSearchParams(writeParams({ ...params, page: lastPage }), { replace: true });
    }
  }, [lastPage, params, setSearchParams]);

  const table = useTable({
    features,
    columns,
    data: tickets ?? noTickets,
    getRowId: (ticket) => ticket.id,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    enableMultiSort: false,
    // Clicking a sorted column flips its direction rather than clearing the sort.
    enableSortingRemoval: false,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          Every email to support becomes a ticket. Waiting shows how long the sender has had no
          answer.
        </p>
      </div>

      <TicketFilters filters={filterValues} onChange={setFilters} />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{apiErrorMessage(error, "Failed to load tickets")}</AlertDescription>
        </Alert>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader className="bg-muted/50">
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => {
                    if (!header.column.getCanSort()) {
                      return (
                        <TableHead key={header.id}>
                          <table.FlexRender header={header} />
                        </TableHead>
                      );
                    }
                    const sorted = header.column.getIsSorted();
                    const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
                    return (
                      <TableHead key={header.id} aria-sort={sorted ? ariaSort[sorted] : undefined}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2.5"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          <SortIcon
                            data-icon="inline-end"
                            aria-hidden
                            className={sorted ? undefined : "text-muted-foreground"}
                          />
                        </Button>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody
              aria-busy={isPending || isPlaceholderData}
              className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}
            >
              {!tickets ? (
                Array.from({ length: SKELETON_ROWS }, (_, i) => <TicketRowSkeleton key={i} />)
              ) : tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                    {filtering ? "No tickets match these filters." : "No tickets yet."}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getAllCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.total > 0 && !error && (
        <TicketPagination
          page={params.page}
          pageSize={params.pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
    </div>
  );
}
