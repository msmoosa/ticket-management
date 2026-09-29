import { ADMIN, CLIENT_ORIGIN, authPost, expect, test, uniqueEmail } from "./fixtures.ts";

// API-level auth guarantees worth checking end to end through the Vite proxy.
test.describe("auth API hardening", () => {
  test("public sign-up is disabled", async ({ page }) => {
    const email = uniqueEmail("signup");
    const res = await authPost(page.request, "sign-up/email", {
      email,
      password: "password123",
      name: "Should Not Exist",
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" });

    // No account was created.
    const signIn = await authPost(page.request, "sign-in/email", { email, password: "password123" });
    expect(signIn.status()).toBe(401);
  });

  test("sign-in from an untrusted Origin is rejected", async ({ page }) => {
    const res = await page.request.post("/api/auth/sign-in/email", {
      data: { email: ADMIN.email, password: ADMIN.password },
      headers: { Origin: "http://evil.example.com" },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("cookie-authenticated POSTs without an Origin header are rejected", async ({
    agentPage: page,
  }) => {
    // CSRF protection: with a session cookie present, Better Auth requires an Origin.
    const res = await page.request.post("/api/auth/sign-out", { data: {} });
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ code: "MISSING_OR_NULL_ORIGIN" });

    // The session is still valid.
    expect((await page.request.get("/api/me")).status()).toBe(200);
  });

  test("cookie-authenticated POSTs from an untrusted Origin are rejected", async ({
    agentPage: page,
  }) => {
    const res = await page.request.post("/api/auth/sign-out", {
      data: {},
      headers: { Origin: "http://evil.example.com" },
    });
    expect(res.status()).toBe(403);
    expect((await page.request.get("/api/me")).status()).toBe(200);

    // Sanity check: the trusted Origin works.
    const ok = await page.request.post("/api/auth/sign-out", {
      data: {},
      headers: { Origin: CLIENT_ORIGIN },
    });
    expect(ok.status()).toBe(200);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });
});
