import TicketFieldSelect from "@/components/TicketFieldSelect";
import { ticketStatuses, ticketStatusLabel, type Ticket } from "@/lib/tickets";
import { useUpdateTicket } from "@/lib/use-update-ticket";

const items = ticketStatuses.map((value) => ({ value, label: ticketStatusLabel[value] }));

type Props = { ticket: Ticket };

// Changes the ticket's status. Saves as soon as a new status is chosen.
export default function TicketStatusSelect({ ticket }: Props) {
  const update = useUpdateTicket(ticket.id);
  return (
    <TicketFieldSelect
      label="Status"
      items={items}
      value={ticket.status}
      onChange={(status) => update.mutate({ status })}
      disabled={update.isPending}
      error={update.error}
      errorFallback="Failed to update status"
    />
  );
}
