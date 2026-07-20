/**
 * Turn-bound identity resolution for the agent-facing entity-identity
 * routing surface (THINK-321 U5). The service-bearer path must derive
 * tenant, the turn's owning user, AND the thread SERVER-SIDE from the
 * thread-turn reference, reject mismatched tenant/threadRef assertions, and
 * refuse consent writes without an owning user — a prompt-injected turn can
 * never widen scope or ghost-attribute a confirmation by parameter.
 */

import { describe, expect, it, vi } from "vitest";

import { coerceEntityRef } from "./resolveEntities.query.js";
import {
  requireConsentUserId,
  resolveConsentThreadRef,
  resolveIdentityRoutingScope,
} from "./routing-auth.js";

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

describe("resolveIdentityRoutingScope (service callers)", () => {
  it("derives tenant + user + thread from a live thread-turn reference", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [
        {
          match: "thread_turns",
          rows: [
            { tenant_id: TENANT_A, user_id: USER_A, thread_id: THREAD_ID },
          ],
        },
      ],
    });
    const scope = await resolveIdentityRoutingScope(ctx, {
      tenantId: TENANT_A,
    });
    expect(scope).toEqual({
      tenantId: TENANT_A,
      userId: USER_A,
      threadId: THREAD_ID,
    });
  });

  it("falls back to the thread reference when no turn id is present", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-id": THREAD_ID },
      routes: [
        {
          match: "FROM threads",
          rows: [
            { tenant_id: TENANT_A, user_id: USER_A, thread_id: THREAD_ID },
          ],
        },
      ],
    });
    const scope = await resolveIdentityRoutingScope(ctx, {});
    expect(scope).toEqual({
      tenantId: TENANT_A,
      userId: USER_A,
      threadId: THREAD_ID,
    });
  });

  it("rejects a finished/unknown turn (stale credential)", async () => {
    const ctx = serviceCtx({
      headers: { "x-thread-turn-id": TURN_ID },
      routes: [{ match: "thread_turns", rows: [] }],
    });
    await expect(
      resolveIdentityRoutingScope(ctx, { tenantId: TENANT_A }),
    ).rejects.toThrow(/not an active turn/);
  });

  it("rejects a caller-asserted tenant that disagrees with the derivation (arg and header)", async () => {
    const routes = [
      {
        match: "thread_turns",
        rows: [{ tenant_id: TENANT_A, user_id: USER_A, thread_id: THREAD_ID }],
      },
    ];
    await expect(
      resolveIdentityRoutingScope(
        serviceCtx({ headers: { "x-thread-turn-id": TURN_ID }, routes }),
        { tenantId: TENANT_B },
      ),
    ).rejects.toThrow(/tenant mismatch/);
    await expect(
      resolveIdentityRoutingScope(
        serviceCtx({
          headers: { "x-thread-turn-id": TURN_ID },
          routes,
          assertedTenantId: TENANT_B,
        }),
        {},
      ),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("rejects a service call with no turn-bound reference or a malformed one", async () => {
    await expect(
      resolveIdentityRoutingScope(serviceCtx({ routes: [] }), {}),
    ).rejects.toThrow(/turn-bound thread reference/);
    await expect(
      resolveIdentityRoutingScope(
        serviceCtx({
          headers: { "x-thread-turn-id": "not-a-uuid" },
          routes: [],
        }),
        {},
      ),
    ).rejects.toThrow(/Invalid thread turn reference/);
  });
});

describe("consent binding helpers", () => {
  const turnScope = {
    tenantId: TENANT_A,
    userId: USER_A,
    threadId: THREAD_ID,
  };

  it("uses the server-derived thread and rejects a mismatched asserted threadRef", () => {
    expect(resolveConsentThreadRef(turnScope, undefined)).toBe(THREAD_ID);
    expect(resolveConsentThreadRef(turnScope, THREAD_ID)).toBe(THREAD_ID);
    expect(() =>
      resolveConsentThreadRef(turnScope, "some-other-thread"),
    ).toThrow(/threadRef mismatch/);
  });

  it("requires an asserted threadRef for non-turn-bound (admin) callers", () => {
    const adminScope = { tenantId: TENANT_A, userId: USER_A, threadId: null };
    expect(resolveConsentThreadRef(adminScope, THREAD_ID)).toBe(THREAD_ID);
    expect(() => resolveConsentThreadRef(adminScope, undefined)).toThrow(
      /threadRef is required/,
    );
  });

  it("refuses a consent write when the turn has no owning user", () => {
    expect(requireConsentUserId(turnScope)).toBe(USER_A);
    expect(() => requireConsentUserId({ ...turnScope, userId: null })).toThrow(
      /no owning user/,
    );
  });
});

describe("coerceEntityRef", () => {
  it("applies precedence: canonicalId, then source pair, then name+type; else invalid", () => {
    expect(coerceEntityRef({ canonicalId: "ce-1", name: "x" })).toEqual({
      canonicalId: "ce-1",
    });
    expect(
      coerceEntityRef({
        sourceSystem: "lastmile",
        externalId: "CUST-9",
        namespace: " ",
      }),
    ).toEqual({
      sourceSystem: "lastmile",
      namespace: undefined,
      externalId: "CUST-9",
    });
    expect(
      coerceEntityRef({ name: "Acme Fuel", entityTypeSlug: "customer" }),
    ).toEqual({ name: "Acme Fuel", entityTypeSlug: "customer" });
    // A ref matching no shape becomes an empty object → explicit
    // invalid_ref miss in the routing lib, never a silent drop.
    expect(coerceEntityRef({ sourceSystem: "lastmile" })).toEqual({});
    expect(coerceEntityRef({})).toEqual({});
  });
});
