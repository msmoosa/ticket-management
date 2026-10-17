import { useQuery } from "@tanstack/react-query";
import TicketReplyForm from "@/components/TicketReplyForm";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, apiErrorMessage } from "@/lib/api";
import type { Ticket, TicketReply } from "@/lib/tickets";
import { cn } from "@/lib/utils";

const sentFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

type Props = { ticket: Pick<Ticket, "id" | "fromEmail" | "fromName"> };

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
      <h2 id="ticket-replies-heading" className="text-lg font-semibold">
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
          {replies.map((reply) => (
            <li key={reply.id}>
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
