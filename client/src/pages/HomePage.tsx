import { useEffect, useState } from "react";

type Status = "loading" | "ok" | "error";

export default function HomePage() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-sm">
        API status:{" "}
        <span
          className={
            status === "ok"
              ? "text-green-700"
              : status === "error"
                ? "text-red-700"
                : "text-gray-500"
          }
        >
          {status}
        </span>
      </p>
    </div>
  );
}
