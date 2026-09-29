import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // The e2e stack points this at the test API (see playwright.config.ts).
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:3000",
    },
  },
});
