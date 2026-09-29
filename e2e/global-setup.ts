import { execSync } from "node:child_process";

// Migrate, empty, and seed the test database before the run.
export default function globalSetup() {
  execSync("bun run --filter server db:test:reset", { stdio: "inherit" });
}
