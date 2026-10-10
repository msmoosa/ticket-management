import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  ticketCategoryLabel,
  ticketStatusLabel,
  type TicketStatus,
  type TicketSummary,
} from "@/lib/tickets";

const receivedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusVariant: Record<TicketStatus, "default" | "secondary" | "outline"> = {
  open: "default",
  resolved: "secondary",
  closed: "outline",
};

const SKELETON_ROWS = 5;

// Placeholder row shaped like a real one: subject, two-line sender, category, status badge, date.
function TicketRowSkeleton() {
  return (
    <TableRow>
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

export default function TicketsPage() {
  const { data: tickets, error, isPending } = useQuery({
    queryKey: ["tickets"],
    queryFn: async ({ signal }) => {
      // The server returns tickets newest first.
      const { data } = await api.get<{ tickets: TicketSummary[] }>("/tickets", { signal });
      return data.tickets;
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          Support requests from email, newest first.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{apiErrorMessage(error, "Failed to load tickets")}</AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody aria-busy={isPending}>
              {isPending ? (
                Array.from({ length: SKELETON_ROWS }, (_, i) => <TicketRowSkeleton key={i} />)
              ) : tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No tickets yet.
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="max-w-md truncate font-medium">{ticket.subject}</TableCell>
                    <TableCell>
                      {ticket.fromName ? (
                        <div className="flex flex-col">
                          <span>{ticket.fromName}</span>
                          <span className="text-xs text-muted-foreground">{ticket.fromEmail}</span>
                        </div>
                      ) : (
                        ticket.fromEmail
                      )}
                    </TableCell>
                    <TableCell>
                      {ticket.category ? (
                        ticketCategoryLabel[ticket.category]
                      ) : (
                        <span className="text-muted-foreground">Uncategorized</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[ticket.status]}>
                        {ticketStatusLabel[ticket.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {receivedFormat.format(new Date(ticket.createdAt))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
