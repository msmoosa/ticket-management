import { setupServer } from "msw/node";

// Mock API for component tests. Add per-test handlers with `server.use(...)`.
export const server = setupServer();
