import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";
import TicketAssignee from "@/components/TicketAssignee";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/api";
import {
  ticketCategoryLabel,
  ticketStatusLabel,
  ticketStatusVariant,
  type Ticket,
} from "@/lib/tickets";

const receivedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function TicketDetailSkeleton() {
  return (
    <div role="status" aria-label="Loading ticket" className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-5 w-40" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  // The list passes its URL (with sort, filters and page) so "Back" returns to the same view.
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/tickets";

  const { data: ticket, error } = useQuery({
    queryKey: ["tickets", "detail", id],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ ticket: Ticket }>(`/tickets/${id}`, { signal });
      return data.ticket;
    },
  });

  return (
    <div className="space-y-6">
      <Link
        to={from}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to tickets
      </Link>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{apiErrorMessage(error, "Failed to load ticket")}</AlertDescription>
        </Alert>
      ) : !ticket ? (
        <TicketDetailSkeleton />
      ) : (
        <>
          <div className="space-y-3">
            <h1 className="text-2xl font-bold break-words">{ticket.subject}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={ticketStatusVariant[ticket.status]}>
                {ticketStatusLabel[ticket.status]}
              </Badge>
              {ticket.category ? (
                <Badge variant="outline">{ticketCategoryLabel[ticket.category]}</Badge>
              ) : (
                <span className="text-muted-foreground">Uncategorized</span>
              )}
            </div>
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-muted-foreground">From</dt>
              <dd>
                {ticket.fromName ? (
                  <>
                    {ticket.fromName}{" "}
                    <span className="text-muted-foreground">&lt;{ticket.fromEmail}&gt;</span>
                  </>
                ) : (
                  ticket.fromEmail
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Received</dt>
              <dd>{receivedFormat.format(new Date(ticket.createdAt))}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground">Assigned to</dt>
              <dd>
                <TicketAssignee ticket={ticket} />
              </dd>
            </div>
          </dl>

          <Card>
            <CardContent>
              <p className="text-sm break-words whitespace-pre-wrap">{ticket.body}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
