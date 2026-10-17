import type { ReactNode } from "react";
import WaitingTime from "@/components/WaitingTime";
import { Card, CardContent } from "@/components/ui/card";
import type { Ticket } from "@/lib/tickets";

const receivedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type Props = {
  ticket: Ticket;
  /** Rendered between the sender details and the message (the detail page's properties panel). */
  children?: ReactNode;
};

// A ticket's original email: subject, sender, received date and message. Rendered as a fragment,
// so the header, `children` and message are laid out by the parent (the detail page's grid).
export default function TicketDetail({ ticket, children }: Props) {
  const waitingSince = ticket.status === "open" ? ticket.awaitingReplySince : null;
  return (
    <>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight break-words">{ticket.subject}</h1>

        <dl className={`grid gap-4 text-sm ${waitingSince ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
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
          {waitingSince && (
            <div className="space-y-1">
              <dt className="text-muted-foreground">Waiting</dt>
              <dd>
                <WaitingTime since={waitingSince} format="long" />
              </dd>
            </div>
          )}
        </dl>
      </div>

      {children}

      <Card>
        <CardContent>
          <p className="text-sm break-words whitespace-pre-wrap">{ticket.body}</p>
        </CardContent>
      </Card>
    </>
  );
}
