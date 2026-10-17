import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.ts";

let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
let baseUrl: string;
const dir = mkdtempSync(path.join(tmpdir(), "client-dist-"));

beforeAll(() => {
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>App</title>");
  writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log(1)");
  writeFileSync(path.join(dir, "favicon.svg"), "<svg/>");
  process.env.CLIENT_DIST_DIR = dir;
  server = createApp().listen(0);
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  delete process.env.CLIENT_DIST_DIR;
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test("serves index.html for client routes, uncached", async () => {
  for (const route of ["/", "/tickets", "/tickets/abc?page=2"]) {
    const res = await fetch(`${baseUrl}${route}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("<title>App</title>");
  }
});

test("serves fingerprinted assets with a long cache, and other static files", async () => {
  const asset = await fetch(`${baseUrl}/assets/index-abc123.js`);
  expect(asset.status).toBe(200);
  expect(asset.headers.get("cache-control")).toContain("immutable");
  expect((await fetch(`${baseUrl}/favicon.svg`)).status).toBe(200);
  // A missing asset is a 404, not index.html (which would break as a script).
  expect((await fetch(`${baseUrl}/assets/missing.js`)).status).toBe(404);
});

test("unknown API paths still return the JSON 404", async () => {
  const res = await fetch(`${baseUrl}/api/nope`);
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: "Not Found" });
});
