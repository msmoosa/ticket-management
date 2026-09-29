import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, Trash2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api, apiErrorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { User } from "@/lib/users";

type DeleteUserDialogProps = {
  user: User;
  /** The signed-in admin is deleting their own account. */
  isCurrentUser: boolean;
};

export default function DeleteUserDialog({ user, isCurrentUser }: DeleteUserDialogProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const deleteUser = useMutation({
    mutationFn: () => api.delete(`/users/${user.id}`),
    onSuccess: async () => {
      if (isCurrentUser) {
        // The server already ended this session; signing out clears the cookie and the
        // session store, so RequireAuth sends us to /login.
        await authClient.signOut();
        queryClient.clear();
        return;
      }
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Drop a previous attempt's error so reopening starts clean.
    if (!next) deleteUser.reset();
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`Delete ${user.name}`} />}
      >
        <Trash2Icon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {user.email} will be removed from the users list and signed out, and won't be able
            to sign in again.
            {isCurrentUser && " This is your account, so you'll be signed out too."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteUser.isError && (
          <Alert variant="destructive">
            <AlertCircleIcon />
            <AlertDescription>
              {apiErrorMessage(deleteUser.error, "Failed to delete user")}
            </AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteUser.isPending}
            onClick={() => deleteUser.mutate()}
          >
            {deleteUser.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
