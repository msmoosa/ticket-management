import { useQuery } from "@tanstack/react-query";
import TicketFieldSelect, { type TicketFieldItem } from "@/components/TicketFieldSelect";
import { api } from "@/lib/api";
import type { Assignee, Ticket } from "@/lib/tickets";
import { useUpdateTicket } from "@/lib/use-update-ticket";

type Props = { ticket: Ticket };

// Picks who works the ticket. Saves as soon as a new assignee is chosen.
export default function TicketAssignee({ ticket }: Props) {
  const { data: assignees, error: loadError } = useQuery({
    queryKey: ["tickets", "assignees"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ users: Assignee[] }>("/tickets/assignees", { signal });
      return data.users;
    },
  });
  const update = useUpdateTicket(ticket.id);

  const items: TicketFieldItem<string | null>[] = [
    { value: null, label: "Unassigned" },
    ...(assignees ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];
  // Keep the current assignee selectable (and labelled) even if they're no longer listed.
  if (ticket.assignedTo && !items.some((item) => item.value === ticket.assignedTo?.id)) {
    items.push({ value: ticket.assignedTo.id, label: ticket.assignedTo.name });
  }

  return (
    <TicketFieldSelect
      label="Assigned to"
      items={items}
      value={ticket.assignedTo?.id ?? null}
      onChange={(assignedToId) => update.mutate({ assignedToId })}
      disabled={!assignees || update.isPending}
      error={loadError ?? update.error}
      errorFallback={loadError ? "Failed to load assignees" : "Failed to assign ticket"}
    />
  );
}
