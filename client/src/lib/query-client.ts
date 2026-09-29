import { QueryClient } from "@tanstack/react-query";
import axios from "axios";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry once on network/5xx errors; 4xx responses won't succeed on retry.
      retry: (failureCount, err) => {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status !== undefined && status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});
