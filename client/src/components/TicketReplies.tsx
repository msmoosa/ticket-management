import { useQuery } from "@tanstack/react-query";
import TicketReplyForm from "@/components/TicketReplyForm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/api";
import type { Ticket, TicketReply } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/waiting";

const sentFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Props = { ticket: Pick<Ticket, "id" | "fromEmail" | "fromName" | "createdAt"> };

const HOUR = 3_600_000;

// "2 days later" between messages an hour or more apart, so response times are visible.
function Gap({ from, to }: { from: string; to: string }) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < HOUR) return null;
  return (
    <p className="mb-3 flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
      {formatDuration(ms)} later
    </p>
  );
}

// The ticket's reply thread (oldest first): agents' replies and the sender's emailed replies,
// followed by the form to add a reply.
export default function TicketReplies({ ticket }: Props) {
  const ticketId = ticket.id;
  const customerName = ticket.fromName ?? ticket.fromEmail;
  const { data: replies, error } = useQuery({
    queryKey: ["tickets", "replies", ticketId],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ replies: TicketReply[] }>(`/tickets/${ticketId}/replies`, {
        signal,
      });
      return data.replies;
    },
  });

  return (
    <section aria-labelledby="ticket-replies-heading" className="space-y-4">
      <h2 id="ticket-replies-heading" className="text-lg font-semibold tracking-tight">
        Replies
      </h2>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{apiErrorMessage(error, "Failed to load replies")}</AlertDescription>
        </Alert>
      ) : !replies ? (
        <div role="status" aria-label="Loading replies">
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : replies.length === 0 ? (
        <p className="text-sm text-muted-foreground">No replies yet.</p>
      ) : (
        <ol aria-label="Reply thread" className="space-y-3">
          {replies.map((reply, i) => (
            <li key={reply.id}>
              <Gap from={i === 0 ? ticket.createdAt : replies[i - 1]!.createdAt} to={reply.createdAt} />
              <Card size="sm" className={cn(reply.sender === "customer" && "bg-muted")}>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                    {reply.sender === "customer" ? (
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{customerName}</span>
                        <Badge variant="outline">Customer</Badge>
                      </span>
                    ) : (
                      <span className="font-medium">{reply.author?.name ?? "Deleted user"}</span>
                    )}
                    <time dateTime={reply.createdAt} className="text-muted-foreground">
                      {sentFormat.format(new Date(reply.createdAt))}
                    </time>
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap">{reply.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      <TicketReplyForm ticketId={ticketId} />
    </section>
  );
}
