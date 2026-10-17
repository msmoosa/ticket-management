import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";
import TicketDetail from "@/components/TicketDetail";
import TicketProperties from "@/components/TicketProperties";
import TicketReplies from "@/components/TicketReplies";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/api";
import type { Ticket } from "@/lib/tickets";

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
        // Below `lg` everything stacks, with the properties panel between the sender details and
        // the message. On wide screens the panel is a side column spanning every row (the last,
        // `1fr` row absorbs its height) and the rest stays in the left column.
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:grid-rows-[auto_auto_1fr]">
          <TicketDetail ticket={ticket}>
            <TicketProperties
              ticket={ticket}
              className="lg:col-start-2 lg:row-span-3 lg:row-start-1"
            />
          </TicketDetail>
          <div className="lg:col-start-1">
            <TicketReplies ticket={ticket} />
          </div>
        </div>
      )}
    </div>
  );
}
