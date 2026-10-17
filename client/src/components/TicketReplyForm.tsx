import { useId } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { AlertCircleIcon } from "lucide-react";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { api, apiErrorMessage } from "@/lib/api";
import { maxReplyLength, type TicketReply } from "@/lib/tickets";

const replySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a reply first")
    .max(maxReplyLength, `Reply must be at most ${maxReplyLength} characters`),
});

type Props = { ticketId: string };

// Posts a reply to the ticket. The saved reply is appended to the cached thread and the form clears.
export default function TicketReplyForm({ ticketId }: Props) {
  const id = useId();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(replySchema), defaultValues: { body: "" } });

  const createReply = useMutation({
    mutationFn: async (body: string) => {
      const { data } = await api.post<{ reply: TicketReply }>(`/tickets/${ticketId}/replies`, {
        body,
      });
      return data.reply;
    },
    onSuccess: (reply) => {
      queryClient.setQueryData<TicketReply[]>(["tickets", "replies", ticketId], (replies) =>
        replies ? [...replies, reply] : replies,
      );
      void queryClient.invalidateQueries({ queryKey: ["tickets", "replies", ticketId] });
    },
  });

  async function submit({ body }: z.infer<typeof replySchema>) {
    try {
      await createReply.mutateAsync(body);
      reset();
    } catch (err) {
      setError("root", { message: apiErrorMessage(err, "Failed to send reply") });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <FieldGroup>
        {errors.root && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>{errors.root.message}</AlertDescription>
          </Alert>
        )}
        <Field data-invalid={errors.body ? true : undefined}>
          <FieldLabel htmlFor={`${id}-body`}>Reply</FieldLabel>
          <Textarea
            id={`${id}-body`}
            rows={5}
            className="min-h-28"
            placeholder="Write a reply…"
            aria-invalid={errors.body ? true : undefined}
            {...register("body")}
          />
          <FieldError errors={[errors.body]} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
