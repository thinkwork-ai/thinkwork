/**
 * Turn-bound identity resolution for the agent-facing `search` broker
 * (THINK-263 U8, R2/R3). The service-bearer path must derive BOTH tenant and
 * the invoking user SERVER-SIDE from the thread-turn reference and reject
 * mismatched tenant assertions, so the broker runs with the turn user's
 * per-user thread/memory scope (never unscoped, never caller-asserted).
 */

import { describe, expect, it, vi } from "vitest";

import { resolveServiceSearchScope } from "./search-auth.js";

const TENANT_A = "0015953e-aa13-4cab-8398-2e70f73dda63";
const TENANT_B = "84381488-f071-7073-6bc7-d6238c147538";
const USER_A = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const TURN_ID = "7c1f8a8e-1c1d-4e58-9a8e-0b1c2d3e4f5a";
const THREAD_ID = "9d2e7b6c-2d3e-4f5a-8b9c-1d2e3f4a5b6c";

function routeDb(routes: Array<{ match: string; rows: unknown[] }>) {
  const execute = vi.fn(async (query: unknown) => {
    const text = JSON.stringify(
      (query as { queryChunks?: unknown })?.queryChunks ?? query,
    );
    for (const route of routes) {
      if (text.includes(route.match)) return { rows: route.rows };
    }
    return { rows: [] };
  });
  return { execute };
}

function serviceCtx(args: {
  routes: Array<{ match: string; rows: unknown[] }>;
  headers?: Record<string, string>;
  assertedTenantId?: string | null;
}) {
  const { execute } = routeDb(args.routes);
  return {
    auth: { authType: "service", tenantId: args.assertedTenantId ?? null },
    db: { execute },
    headers: args.headers ?? {},
  } as any;
}

describe("resolveServiceSearchScope", () => {
  it("derives tenant + user from a live thread-turn reference", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [
        {
          match: "thread_turns",
          rows: [{ tenant_id: TENANT_A, user_id: USER_A }],
        },
      ],
    });
    const scope = await resolveServiceSearchScope(ctx, { tenantId: TENANT_A });
    expect(scope).toEqual({ tenantId: TENANT_A, userId: USER_A });
  });

  it("falls back to the thread reference when no turn id is present", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-id": THREAD_ID },
      routes: [
        {
          match: "FROM threads",
          rows: [{ tenant_id: TENANT_A, user_id: USER_A }],
        },
      ],
    });
    const scope = await resolveServiceSearchScope(ctx, {});
    expect(scope).toEqual({ tenantId: TENANT_A, userId: USER_A });
  });

  it("rejects a finished/unknown turn (stale credential)", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [{ match: "thread_turns", rows: [] }],
    });
    await expect(
      resolveServiceSearchScope(ctx, { tenantId: TENANT_A }),
    ).rejects.toThrow(/not an active turn/);
  });

  it("rejects a caller-asserted tenant that disagrees with the derivation", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [
        {
          match: "thread_turns",
          rows: [{ tenant_id: TENANT_A, user_id: USER_A }],
        },
      ],
    });
    await expect(
      resolveServiceSearchScope(ctx, { tenantId: TENANT_B }),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("rejects a turn whose thread has no owning user (no per-user scope)", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [
        {
          match: "thread_turns",
          rows: [{ tenant_id: TENANT_A, user_id: null }],
        },
      ],
    });
    await expect(
      resolveServiceSearchScope(ctx, { tenantId: TENANT_A }),
    ).rejects.toThrow(/no owning user/);
  });

  it("rejects a malformed turn reference before touching the database", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": "not-a-uuid" },
      routes: [],
    });
    await expect(
      resolveServiceSearchScope(ctx, { tenantId: TENANT_A }),
    ).rejects.toThrow(/Invalid thread turn reference/);
    expect(ctx.db.execute).not.toHaveBeenCalled();
  });

  it("rejects a service caller that supplies no turn-bound reference", async () => {
    const ctx = serviceCtx({ headers: {}, routes: [] });
    await expect(
      resolveServiceSearchScope(ctx, { tenantId: TENANT_A }),
    ).rejects.toThrow(/turn-bound thread reference/);
  });
});
