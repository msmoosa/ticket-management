import axios from "axios";

// Relative base URL: Vite proxies /api/* to the server in dev.
export const api = axios.create({ baseURL: "/api" });

// Server errors are `{ "error": string }`; fall back to a generic message.
export function apiErrorMessage(err: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: string }>(err)) {
    return err.response?.data?.error ?? fallback;
  }
  return fallback;
}
