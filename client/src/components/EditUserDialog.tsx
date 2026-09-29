import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import UserForm from "@/components/UserForm";
import { api } from "@/lib/api";
import type { User, UserInput } from "@/lib/users";

export default function EditUserDialog({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const updateUser = useMutation({
    mutationFn: (values: UserInput) => api.patch(`/users/${user.id}`, values),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${user.name}`} />}
      >
        <PencilIcon />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Update {user.name}'s details.</DialogDescription>
        </DialogHeader>
        <UserForm
          user={user}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          errorFallback="Failed to update user"
          onSubmit={updateUser.mutateAsync}
        />
      </DialogContent>
    </Dialog>
  );
}
