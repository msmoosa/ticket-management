import { Badge } from "@/components/ui/badge";
import { ticketStatusLabel, type TicketStatus } from "@/lib/tickets";

// Open is the only status in colour: it's the one that still needs work.
const statusClass: Record<TicketStatus, string> = {
  open: "bg-accent text-accent-foreground",
  resolved: "bg-secondary text-secondary-foreground",
  closed: "border-border text-muted-foreground",
};

export default function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={statusClass[status]}>
      {ticketStatusLabel[status]}
    </Badge>
  );
}
