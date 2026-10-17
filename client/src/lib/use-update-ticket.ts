import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Ticket, TicketUpdate } from "@/lib/tickets";

// Saves changes to a ticket with PATCH /api/tickets/:id. The saved ticket replaces the cached
// detail, and cached list pages are marked stale so they show the change when next opened.
export function useUpdateTicket(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (update: TicketUpdate) => {
      const { data } = await api.patch<{ ticket: Ticket }>(`/tickets/${ticketId}`, update);
      return data.ticket;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["tickets", "detail", ticketId], updated);
      // List queries are keyed ["tickets", params]; detail and assignee keys use strings.
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) => queryKey[0] === "tickets" && typeof queryKey[1] === "object",
      });
    },
  });
}
