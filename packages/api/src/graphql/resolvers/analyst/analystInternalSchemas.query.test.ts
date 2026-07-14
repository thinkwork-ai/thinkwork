/**
 * analystInternalSchemas resolver tests (THINK-283).
 *
 * Asserts the auth gate order, the pass-through to listInternalSchemas, and
 * the InternalSchemaDiscoveryError → BAD_USER_INPUT mapping.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const h = vi.hoisted(() => {
  class InternalSchemaDiscoveryError extends Error {}
  const calls: string[] = [];
  const state = {
    caller: { userId: "user-1", tenantId: "tenant-1" } as {
      userId: string | null;
      tenantId: string | null;
    },
    adminError: null as Error | null,
    listError: null as Error | null,
    schemas: [
      { name: "raw_jde", eligibleTableCount: 12, alreadyRegistered: false },
    ],
    listArgs: null as unknown,
  };
  return { calls, state, InternalSchemaDiscoveryError };
});

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: async () => {
    h.calls.push("requireAdmin");
    if (h.state.adminError) throw h.state.adminError;
    return "admin";
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: async () => h.state.caller,
}));

vi.mock("../../../lib/analyst/internal-clusters.js", () => ({
  InternalSchemaDiscoveryError: h.InternalSchemaDiscoveryError,
  listInternalSchemas: async (args: unknown) => {
    h.calls.push("list");
    h.state.listArgs = args;
    if (h.state.listError) throw h.state.listError;
    return h.state.schemas;
  },
}));

const ctx = { auth: { email: "op@example.com" } } as never;
const ARGS = { clusterId: "thinkwork-dev-aurora", database: "warehouse" };

async function load() {
  const mod = await import("./analystInternalSchemas.query.js");
  return mod.analystInternalSchemas;
}

describe("analystInternalSchemas (THINK-283)", () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.caller = { userId: "user-1", tenantId: "tenant-1" };
    h.state.adminError = null;
    h.state.listError = null;
    h.state.listArgs = null;
  });

  it("requires tenant context and admin before any discovery", async () => {
    h.state.caller = { userId: "user-1", tenantId: null };
    const resolver = await load();
    await expect(resolver(undefined, ARGS, ctx)).rejects.toThrow(
      "Tenant context required",
    );
    expect(h.calls).toEqual([]);

    h.state.caller = { userId: "user-1", tenantId: "tenant-1" };
    h.state.adminError = new GraphQLError("Tenant admin role required", {
      extensions: { code: "FORBIDDEN" },
    });
    await expect(resolver(undefined, ARGS, ctx)).rejects.toThrow(
      "Tenant admin role required",
    );
    expect(h.calls).toEqual(["requireAdmin"]);
  });

  it("passes tenant + selection through and returns the discovered schemas", async () => {
    const resolver = await load();
    const result = await resolver(undefined, ARGS, ctx);
    expect(result).toEqual(h.state.schemas);
    expect(h.state.listArgs).toMatchObject({
      tenantId: "tenant-1",
      clusterId: "thinkwork-dev-aurora",
      database: "warehouse",
    });
  });

  it("maps discovery errors to BAD_USER_INPUT and passes unknown errors through", async () => {
    const resolver = await load();
    h.state.listError = new h.InternalSchemaDiscoveryError(
      'database "warehouse" was not found on cluster "thinkwork-dev-aurora"',
    );
    const err = await resolver(undefined, ARGS, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(GraphQLError);
    expect((err as GraphQLError).extensions.code).toBe("BAD_USER_INPUT");
    expect((err as GraphQLError).message).toMatch(/was not found/);

    h.state.listError = new Error("ECONNRESET somewhere unexpected");
    await expect(resolver(undefined, ARGS, ctx)).rejects.toThrow(/ECONNRESET/);
  });
});
