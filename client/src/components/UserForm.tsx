import { useId } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { AlertCircleIcon } from "lucide-react";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/api";
import type { User, UserInput } from "@/lib/users";

const PASSWORD_MESSAGE = "Password must be at least 8 characters";

const baseSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, PASSWORD_MESSAGE),
});

// Editing: a blank password keeps the current one.
const editSchema = baseSchema.extend({
  password: z.string().refine((value) => value === "" || value.length >= 8, PASSWORD_MESSAGE),
});

type UserFormValues = z.infer<typeof baseSchema>;

type UserFormProps = {
  /** The user being edited; omit to create a new one. */
  user?: User;
  submitLabel: string;
  pendingLabel: string;
  /** Sends the values; a rejection is shown as the form's error. */
  onSubmit: (values: UserInput) => Promise<unknown>;
  errorFallback: string;
};

// Name / email / password form for the user dialogs. Render it inside a DialogContent:
// it unmounts when the dialog closes, so every open starts from `user`'s current values.
export default function UserForm({
  user,
  submitLabel,
  pendingLabel,
  onSubmit,
  errorFallback,
}: UserFormProps) {
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(user ? editSchema : baseSchema),
    defaultValues: { name: user?.name ?? "", email: user?.email ?? "", password: "" },
  });

  async function submit({ name, email, password }: UserFormValues) {
    try {
      await onSubmit(password ? { name, email, password } : { name, email });
    } catch (err) {
      setError("root", { message: apiErrorMessage(err, errorFallback) });
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
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            {...register("name")}
          />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            aria-invalid={errors.email ? true : undefined}
            {...register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>
        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor={`${id}-password`}>Password</FieldLabel>
          <Input
            id={`${id}-password`}
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={user ? `${id}-password-hint` : undefined}
            {...register("password")}
          />
          {user && (
            <FieldDescription id={`${id}-password-hint`}>
              Leave blank to keep the current password.
            </FieldDescription>
          )}
          <FieldError errors={[errors.password]} />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? pendingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
