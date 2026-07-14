/**
 * refreshAnalystDataSource resolver tests (THINK-283 U5).
 *
 * Asserts the tenant/operator auth gate order and the error-class mapping
 * (input → BAD_USER_INPUT, live lease → CONFLICT, step failure →
 * BAD_USER_INPUT with the sanitized step in extensions).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const h = vi.hoisted(() => {
  class AnalystRefreshConflictError extends Error {}
  class AnalystRefreshInputError extends Error {}
  class AnalystRefreshStepError extends Error {
    constructor(
      readonly step: string,
      message: string,
    ) {
      super(message);
    }
  }
  const calls: string[] = [];
  const state = {
    caller: { userId: "user-1", tenantId: "tenant-1" } as {
      userId: string | null;
      tenantId: string | null;
    },
    adminError: null as Error | null,
    runError: null as Error | null,
    runArgs: null as unknown,
    result: {
      serverId: "srv-1",
      slug: "warehouse",
      addedTables: ["raw_jde.shipments"],
      removedTables: [],
      tables: 2,
    },
  };
  return {
    calls,
    state,
    AnalystRefreshConflictError,
    AnalystRefreshInputError,
    AnalystRefreshStepError,
  };
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

vi.mock("../../../lib/analyst/refresh-data-source.js", () => ({
  AnalystRefreshConflictError: h.AnalystRefreshConflictError,
  AnalystRefreshInputError: h.AnalystRefreshInputError,
  AnalystRefreshStepError: h.AnalystRefreshStepError,
  refreshAnalystDataSource: async (args: unknown) => {
    h.calls.push("run");
    h.state.runArgs = args;
    if (h.state.runError) throw h.state.runError;
    return h.state.result;
  },
}));

const ctx = { auth: { email: "op@example.com" } } as never;

async function load() {
  const mod = await import("./refreshAnalystDataSource.mutation.js");
  return mod.refreshAnalystDataSource;
}

describe("refreshAnalystDataSource resolver (THINK-283 U5)", () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.state.caller = { userId: "user-1", tenantId: "tenant-1" };
    h.state.adminError = null;
    h.state.runError = null;
    h.state.runArgs = null;
  });

  it("requires tenant context and admin BEFORE running the refresh", async () => {
    const resolver = await load();
    h.state.caller = { userId: "user-1", tenantId: null };
    await expect(
      resolver(undefined, { serverId: "srv-1" }, ctx),
    ).rejects.toThrow("Tenant context required");
    expect(h.calls).toEqual([]);

    h.state.caller = { userId: "user-1", tenantId: "tenant-1" };
    h.state.adminError = new GraphQLError("Tenant admin role required", {
      extensions: { code: "FORBIDDEN" },
    });
    await expect(
      resolver(undefined, { serverId: "srv-1" }, ctx),
    ).rejects.toThrow("Tenant admin role required");
    expect(h.calls).toEqual(["requireAdmin"]);
  });

  it("passes tenant, serverId, and operator signature through and returns the result", async () => {
    const resolver = await load();
    const result = await resolver(undefined, { serverId: "srv-1" }, ctx);
    expect(result).toEqual(h.state.result);
    expect(h.state.runArgs).toEqual({
      tenantId: "tenant-1",
      serverId: "srv-1",
      signedBy: "operator:op@example.com",
    });
  });

  it("maps error classes to the established GraphQL codes", async () => {
    const resolver = await load();

    h.state.runError = new h.AnalystRefreshInputError(
      "analyst data source not found",
    );
    let err = await resolver(undefined, { serverId: "x" }, ctx).catch(
      (e: unknown) => e,
    );
    expect((err as GraphQLError).extensions.code).toBe("BAD_USER_INPUT");

    h.state.runError = new h.AnalystRefreshConflictError(
      "a refresh for this source is already running",
    );
    err = await resolver(undefined, { serverId: "x" }, ctx).catch(
      (e: unknown) => e,
    );
    expect((err as GraphQLError).extensions.code).toBe("CONFLICT");

    h.state.runError = new h.AnalystRefreshStepError(
      "artifacts",
      'refresh failed at step "artifacts": upload failed — retry the refresh',
    );
    err = await resolver(undefined, { serverId: "x" }, ctx).catch(
      (e: unknown) => e,
    );
    expect((err as GraphQLError).extensions.code).toBe("BAD_USER_INPUT");
    expect((err as GraphQLError).extensions.refreshStep).toBe("artifacts");
    expect((err as GraphQLError).message).toContain("retry");

    h.state.runError = new Error("unexpected infra failure");
    await expect(resolver(undefined, { serverId: "x" }, ctx)).rejects.toThrow(
      /unexpected infra failure/,
    );
  });
});
