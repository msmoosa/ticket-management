import TicketFieldSelect, { type TicketFieldItem } from "@/components/TicketFieldSelect";
import { ticketCategories, ticketCategoryLabel, type Ticket, type TicketCategory } from "@/lib/tickets";
import { useUpdateTicket } from "@/lib/use-update-ticket";

const items: TicketFieldItem<TicketCategory | null>[] = [
  ...ticketCategories.map((value) => ({ value, label: ticketCategoryLabel[value] })),
  { value: null, label: "Uncategorized" },
];

type Props = { ticket: Ticket };

// Changes the ticket's category, or clears it. Saves as soon as a new category is chosen.
export default function TicketCategorySelect({ ticket }: Props) {
  const update = useUpdateTicket(ticket.id);
  return (
    <TicketFieldSelect
      label="Category"
      items={items}
      value={ticket.category}
      onChange={(category) => update.mutate({ category })}
      disabled={update.isPending}
      error={update.error}
      errorFallback="Failed to update category"
    />
  );
}
