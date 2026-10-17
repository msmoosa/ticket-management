import TicketAssignee from "@/components/TicketAssignee";
import TicketCategorySelect from "@/components/TicketCategorySelect";
import TicketStatusSelect from "@/components/TicketStatusSelect";
import { Card, CardContent } from "@/components/ui/card";
import type { Ticket } from "@/lib/tickets";

type Props = { ticket: Ticket; className?: string };

// The ticket's editable fields (status, category, assignee), each saved as soon as it changes.
// Three across from `sm`, stacked again from `lg` where the detail page shows it as a side column.
export default function TicketProperties({ ticket, className }: Props) {
  return (
    <aside aria-label="Ticket properties" className={className}>
      <Card>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-1">
            <div className="min-w-0 space-y-1.5">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <TicketStatusSelect ticket={ticket} />
              </dd>
            </div>
            <div className="min-w-0 space-y-1.5">
              <dt className="text-muted-foreground">Category</dt>
              <dd>
                <TicketCategorySelect ticket={ticket} />
              </dd>
            </div>
            <div className="min-w-0 space-y-1.5">
              <dt className="text-muted-foreground">Assigned to</dt>
              <dd>
                <TicketAssignee ticket={ticket} />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </aside>
  );
}
