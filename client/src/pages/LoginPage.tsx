import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate, type Location } from "react-router";
import { z } from "zod";
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
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Email</span>
          <input
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            {...register("email")}
            className="w-full rounded border border-gray-300 px-3 py-2 aria-invalid:border-red-600"
          />
          {errors.email && <p className="text-sm text-red-700">{errors.email.message}</p>}
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
            className="w-full rounded border border-gray-300 px-3 py-2 aria-invalid:border-red-600"
          />
          {errors.password && <p className="text-sm text-red-700">{errors.password.message}</p>}
        </label>
        {errors.root && <p className="text-sm text-red-700">{errors.root.message}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-blue-700 px-3 py-2 font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
