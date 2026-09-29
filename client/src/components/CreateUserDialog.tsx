import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
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
import type { UserInput } from "@/lib/users";

export default function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const createUser = useMutation({
    mutationFn: (values: UserInput) => api.post("/users", values),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        Create user
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>New users sign in as agents.</DialogDescription>
        </DialogHeader>
        <UserForm
          submitLabel="Create user"
          pendingLabel="Creating…"
          errorFallback="Failed to create user"
          onSubmit={createUser.mutateAsync}
        />
      </DialogContent>
    </Dialog>
  );
}
