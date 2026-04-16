import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiFetchRaw, apiFetch } from "../src/api-client.js";

describe("apiFetchRaw", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns ok + parsed body on 201 (new member invite)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        alreadyMember: false,
        id: "mem-1",
        role: "member",
        email: "new@example.com",
      }),
    }) as any;

    const result = await apiFetchRaw(
      "https://api.example.com",
      "secret",
      "/api/tenants/acme/members",
      { method: "POST", body: JSON.stringify({ email: "new@example.com" }) },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      alreadyMember: false,
      role: "member",
    });
  });

  it("returns ok + alreadyMember=true on 200 (idempotent invite)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        alreadyMember: true,
        id: "mem-1",
        role: "admin",
        email: "existing@example.com",
      }),
    }) as any;

    const result = await apiFetchRaw<{ alreadyMember?: boolean; role?: string }>(
      "https://api.example.com",
      "secret",
      "/api/tenants/acme/members",
      { method: "POST" },
    );

    expect(result.ok).toBe(true);
    expect(result.body.alreadyMember).toBe(true);
    expect(result.body.role).toBe("admin");
  });

  it("returns ok=false on 4xx/5xx so callers can branch on status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Tenant "nope" not found' }),
    }) as any;

    const result = await apiFetchRaw<{ error?: string }>(
      "https://api.example.com",
      "secret",
      "/api/tenants/nope/members",
      { method: "POST" },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Tenant "nope" not found');
  });

  it("sends Bearer auth + Content-Type + extra headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch as any;

    await apiFetchRaw(
      "https://api.example.com",
      "tw-dev-abcd",
      "/api/whatever",
      { method: "GET" },
      { "x-tenant-slug": "acme" },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/api/whatever",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer tw-dev-abcd",
          "x-tenant-slug": "acme",
        }),
      }),
    );
  });
});

describe("apiFetch (throwing variant)", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws on non-2xx, preserving server error message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    }) as any;

    await expect(
      apiFetch("https://api.example.com", "secret", "/api/x"),
    ).rejects.toThrow("forbidden");
  });

  it("falls back to `HTTP <status>` when server returns no error body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    }) as any;

    await expect(
      apiFetch("https://api.example.com", "secret", "/api/x"),
    ).rejects.toThrow("HTTP 500");
  });
});
