import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

export default function HomePage() {
  const { status } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.get("/health", { signal }).then(() => null),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="flex items-center gap-1 text-sm">
        API status:
        {status === "pending" ? (
          <Skeleton role="status" aria-label="Loading" className="h-4 w-8" />
        ) : (
          <span className={status === "success" ? "text-green-700" : "text-red-700"}>
            {status === "success" ? "ok" : "error"}
          </span>
        )}
      </p>
    </div>
  );
}
