import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import TicketsPerDayChart from "@/components/TicketsPerDayChart";
import TicketStatusBadge from "@/components/TicketStatusBadge";
import WaitingTime from "@/components/WaitingTime";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/api";
import {
  ticketCategories,
  ticketCategoryLabel,
  type TicketCategoryFilter,
  type TicketListParams,
  type TicketListResponse,
  type TicketStats,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";

const STATS_DAYS = 30;
const RECENT_COUNT = 6;

const receivedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const averageFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

const recentParams: TicketListParams = {
  sortBy: "createdAt",
  sortOrder: "desc",
  page: 1,
  pageSize: RECENT_COUNT,
};

function StatTile({
  label,
  value,
  to,
  marker,
}: {
  label: string;
  value: number | undefined;
  to: string;
  /** A small dot before the label, in the current text colour. */
  marker?: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {marker && <span aria-hidden className={cn("size-2 shrink-0 rounded-full", marker)} />}
        {label}
      </p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-8 w-14" />
      ) : (
        <p className="mt-1 text-3xl font-semibold tracking-tight">{value.toLocaleString()}</p>
      )}
    </Link>
  );
}

function ChartCard({ stats }: { stats: TicketStats | undefined }) {
  const total = stats?.perDay.reduce((sum, day) => sum + day.count, 0);
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="grid-cols-[1fr_auto]">
        <div className="space-y-1">
          <CardTitle>Tickets received</CardTitle>
          <CardDescription>Per day, last {STATS_DAYS} days</CardDescription>
        </div>
        {total !== undefined && stats && (
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight">{total.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">
              {averageFormat.format(total / stats.perDay.length)} a day on average
            </p>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-2">
        {stats ? (
          <TicketsPerDayChart perDay={stats.perDay} />
        ) : (
          <Skeleton className="h-58 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

const categoryRows: TicketCategoryFilter[] = [...ticketCategories, "uncategorized"];

function CategoryCard({ stats }: { stats: TicketStats | undefined }) {
  const total = stats ? categoryRows.reduce((sum, c) => sum + stats.category[c], 0) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>By category</CardTitle>
        <CardDescription>All tickets</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {categoryRows.map((category) => {
            const count = stats?.category[category];
            const share = count && total ? count / total : 0;
            return (
              <li key={category}>
                <Link
                  to={`/tickets?category=${category}`}
                  className="-mx-2 block rounded-md px-2 py-2 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className={cn(category === "uncategorized" && "text-muted-foreground")}>
                      {category === "uncategorized" ? "Uncategorized" : ticketCategoryLabel[category]}
                    </span>
                    {count === undefined ? (
                      <Skeleton className="h-4 w-8" />
                    ) : (
                      <span className="font-medium tabular-nums">{count.toLocaleString()}</span>
                    )}
                  </span>
                  <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-chart-2 transition-[width]"
                      style={{ width: `${share * 100}%` }}
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function RecentTickets() {
  const { data, error } = useQuery({
    queryKey: ["tickets", recentParams],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketListResponse>("/tickets", { params: recentParams, signal });
      return data;
    },
  });

  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto] items-center">
        <div className="space-y-1">
          <CardTitle>Recent tickets</CardTitle>
          <CardDescription>The newest emails to support</CardDescription>
        </div>
        <Link
          to="/tickets"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          View all
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{apiErrorMessage(error, "Failed to load tickets")}</AlertDescription>
          </Alert>
        ) : !data ? (
          <div role="status" aria-label="Loading recent tickets" className="space-y-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data.tickets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No tickets yet.</p>
        ) : (
          <ul aria-label="Recent tickets" className="-my-1 divide-y">
            {data.tickets.map((ticket) => (
              <li key={ticket.id} className="flex items-center gap-4 py-3">
                <span className="w-12 shrink-0 text-sm">
                  {ticket.status === "open" && ticket.awaitingReplySince && (
                    <WaitingTime since={ticket.awaitingReplySince} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/tickets/${ticket.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {ticket.subject}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {ticket.fromName ?? ticket.fromEmail} · {receivedFormat.format(new Date(ticket.createdAt))}
                  </p>
                </div>
                <TicketStatusBadge status={ticket.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data: stats, error, isPending } = useQuery({
    queryKey: ["tickets", "stats", { days: STATS_DAYS, tz }],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketStats>("/tickets/stats", {
        params: { days: STATS_DAYS, tz },
        signal,
      });
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Where the queue stands, and how much is coming in.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{apiErrorMessage(error, "Failed to load ticket stats")}</AlertDescription>
        </Alert>
      ) : (
        <div aria-busy={isPending} className="space-y-6">
          {isPending && <span role="status" aria-label="Loading ticket stats" className="sr-only" />}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Open" value={stats?.status.open} to="/tickets?status=open" marker="bg-primary" />
            <StatTile
              label="Waiting a day or more"
              value={stats?.waitingOverDay}
              to="/tickets?status=open"
              marker={stats?.waitingOverDay ? "bg-waiting-brick" : "border border-current"}
            />
            <StatTile label="Resolved" value={stats?.status.resolved} to="/tickets?status=resolved" />
            <StatTile label="Closed" value={stats?.status.closed} to="/tickets?status=closed" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard stats={stats} />
            <CategoryCard stats={stats} />
          </div>
        </div>
      )}

      <RecentTickets />
    </div>
  );
}
