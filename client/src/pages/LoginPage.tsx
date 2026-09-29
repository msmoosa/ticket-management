import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate, type Location } from "react-router";
import { AlertCircleIcon } from "lucide-react";
import { z } from "zod";
import { Alert, AlertDescription } from "../components/ui/alert.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.tsx";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field.tsx";
import { Input } from "../components/ui/input.tsx";
import { authClient } from "../lib/auth-client.ts";

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? "/";
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit({ email, password }: LoginValues) {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
      setError("root", { message: error.message ?? "Sign in failed" });
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Enter your email and password to access your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            {errors.root && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={errors.email ? true : undefined}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={errors.email ? true : undefined}
                {...register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field data-invalid={errors.password ? true : undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                {...register("password")}
              />
              <FieldError errors={[errors.password]} />
            </Field>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
