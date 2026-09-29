import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const statusLabel = { pending: "loading", success: "ok", error: "error" } as const;

export default function HomePage() {
  const { status } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.get("/health", { signal }).then(() => null),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-sm">
        API status:{" "}
        <span
          className={
            status === "success"
              ? "text-green-700"
              : status === "error"
                ? "text-red-700"
                : "text-gray-500"
          }
        >
          {statusLabel[status]}
        </span>
      </p>
    </div>
  );
}
