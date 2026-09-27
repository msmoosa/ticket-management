import { afterAll, beforeAll, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;

beforeAll(() => {
  server = createApp().listen(0);
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => {
  server.close();
});

test("GET /api/health reports API and database ok", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", database: "ok" });
});

test("unknown route returns 404 JSON", async () => {
  const res = await fetch(`${baseUrl}/api/nope`);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: "Not Found" });
});
