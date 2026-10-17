import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, apiErrorMessage } from "@/lib/api";
import type { Assignee, Ticket, TicketUpdate } from "@/lib/tickets";

type Props = { ticket: Ticket };

// Picks who works the ticket. Saves as soon as a new assignee is chosen.
export default function TicketAssignee({ ticket }: Props) {
  const queryClient = useQueryClient();

  const { data: assignees, error: loadError } = useQuery({
    queryKey: ["tickets", "assignees"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ users: Assignee[] }>("/tickets/assignees", { signal });
      return data.users;
    },
  });

  const assign = useMutation({
    mutationFn: async (update: TicketUpdate) => {
      const { data } = await api.patch<{ ticket: Ticket }>(`/tickets/${ticket.id}`, update);
      return data.ticket;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["tickets", "detail", ticket.id], updated);
    },
  });

  const items = [
    { value: null, label: "Unassigned" },
    ...(assignees ?? []).map((user) => ({ value: user.id, label: user.name })),
  ] as { value: string | null; label: string }[];
  // Keep the current assignee selectable (and labelled) even if they're no longer listed.
  if (ticket.assignedTo && !items.some((item) => item.value === ticket.assignedTo?.id)) {
    items.push({ value: ticket.assignedTo.id, label: ticket.assignedTo.name });
  }

  const error = loadError ?? assign.error;

  return (
    <div className="space-y-2">
      <Select
        items={items}
        value={ticket.assignedTo?.id ?? null}
        onValueChange={(assignedToId) => {
          if (assignedToId !== (ticket.assignedTo?.id ?? null)) assign.mutate({ assignedToId });
        }}
        disabled={!assignees || assign.isPending}
      >
        <SelectTrigger aria-label="Assigned to" className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value ?? "unassigned"} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {apiErrorMessage(
              error,
              loadError ? "Failed to load assignees" : "Failed to assign ticket",
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
