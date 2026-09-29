import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { AlertCircleIcon, PlusIcon } from "lucide-react";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, apiErrorMessage } from "@/lib/api";

const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type CreateUserValues = z.infer<typeof createUserSchema>;

export default function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const createUser = useMutation({
    mutationFn: (values: CreateUserValues) => api.post("/users", values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  async function onSubmit(values: CreateUserValues) {
    try {
      await createUser.mutateAsync(values);
    } catch (err) {
      setError("root", { message: apiErrorMessage(err, "Failed to create user") });
      return;
    }
    handleOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Start fresh the next time the dialog opens.
    if (!next) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        Create user
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>New users sign in as agents.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            {errors.root && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="new-user-name">Name</FieldLabel>
              <Input
                id="new-user-name"
                autoComplete="off"
                aria-invalid={errors.name ? true : undefined}
                {...register("name")}
              />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={errors.email ? true : undefined}>
              <FieldLabel htmlFor="new-user-email">Email</FieldLabel>
              <Input
                id="new-user-email"
                type="email"
                autoComplete="off"
                aria-invalid={errors.email ? true : undefined}
                {...register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={errors.password ? true : undefined}>
              <FieldLabel htmlFor="new-user-password">Password</FieldLabel>
              <Input
                id="new-user-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={errors.password ? true : undefined}
                {...register("password")}
              />
              <FieldError errors={[errors.password]} />
            </Field>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create user"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
