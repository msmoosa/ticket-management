import { defineConfig, devices } from "@playwright/test";

// The e2e stack runs on its own ports against the test database (server/.env.test),
// so it can run alongside `bun run dev` (5173 / 3000).
const API_URL = "http://localhost:3100";
const CLIENT_URL = "http://localhost:5174";

export default defineConfig({
  testDir: "./e2e",
  // One shared database, so tests run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Keep generated output inside e2e/ (both gitignored).
  outputDir: "./e2e/test-results",
  reporter: [["html", { outputFolder: "./e2e/playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: CLIENT_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "bun run --filter server start:test",
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "bun run --filter client dev --port 5174 --strictPort",
      url: CLIENT_URL,
      env: { API_PROXY_TARGET: API_URL },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
