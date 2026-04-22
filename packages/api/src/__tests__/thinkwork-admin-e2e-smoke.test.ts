/**
 * End-to-end smoke for the thinkwork-admin flow (Unit 13).
 *
 * Per-unit tests already pin each piece in isolation (Unit 2's authz
 * sweep, Unit 3's per-agent allowlist, Unit 4's idempotency helper,
 * Unit 8b's `runWithIdempotency` decision tree). This file is the
 * integration story: exercise the full `createAgent` resolver —
 * role-gate → invoker resolution → idempotency helper → core create
 * → complete — and assert the retry-cached path returns the prior
 * result without re-executing the core logic.
 *
 * Mocked DB because we can't hit Aurora in CI. The invariant under
 * test is "the pieces wire together correctly," not "Aurora dedupes
 * correctly" — that's enforced by the FULL unique index shipped in
 * Unit 4's migration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// One shared set of hoisted mocks used across two describe blocks.
const {
  insertAgentMock,
  insertCapabilityMock,
  insertMutationIdempotencyMock,
  selectMutationIdempotencyMock,
  updateMutationIdempotencyMock,
  tenantMembersRows,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
} = vi.hoisted(() => ({
  insertAgentMock: vi.fn(),
  insertCapabilityMock: vi.fn(),
  insertMutationIdempotencyMock: vi.fn(),
  selectMutationIdempotencyMock: vi.fn(),
  updateMutationIdempotencyMock: vi.fn(),
  tenantMembersRows: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
}));

vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  // Table-identity routing — same pattern as the authz tests.
  return {
    ...actual,
    db: {
      insert: vi.fn((table: unknown) => ({
        values: (values: unknown) => {
          if (table === actual.mutationIdempotency) {
            return {
              onConflictDoNothing: () => ({
                returning: () =>
                  Promise.resolve(
                    insertMutationIdempotencyMock(values) as unknown[],
                  ),
              }),
            };
          }
          if (table === actual.agentCapabilities) {
            insertCapabilityMock(values);
            return Promise.resolve();
          }
          return {
            returning: () =>
              Promise.resolve(insertAgentMock(values) as unknown[]),
          };
        },
      })),
      update: vi.fn((table: unknown) => ({
        set: (patch: unknown) => ({
          where: () => {
            if (table === actual.mutationIdempotency) {
              updateMutationIdempotencyMock(patch);
            }
            return Promise.resolve();
          },
        }),
      })),
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === actual.mutationIdempotency) {
              return Promise.resolve(
                selectMutationIdempotencyMock() as unknown[],
              );
            }
            return Promise.resolve(tenantMembersRows() as unknown[]);
          },
        }),
      })),
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({}),
      ),
    },
    invokeJobScheduleManager: vi.fn(),
  };
});

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
  resolveCallerTenantId: vi.fn(async () => "tenant-A"),
}));

// eslint-disable-next-line import/first
import { createAgent } from "../graphql/resolvers/agents/createAgent.mutation.js";

function apikeyAdminCtx(): any {
  return {
    auth: {
      authType: "apikey",
      principalId: "admin-1",
      tenantId: "tenant-A",
      email: null,
      agentId: "agent-with-admin-skill",
    },
  };
}

const BASE_INPUT = {
  tenantId: "tenant-A",
  templateId: "tpl-1",
  name: "Marco",
  role: "assistant",
  type: "AGENT",
  adapterType: "strands",
};

describe("thinkwork-admin e2e smoke — createAgent with idempotency", () => {
  beforeEach(() => {
    insertAgentMock.mockReset();
    insertCapabilityMock.mockReset();
    insertMutationIdempotencyMock.mockReset();
    selectMutationIdempotencyMock.mockReset();
    updateMutationIdempotencyMock.mockReset();
    tenantMembersRows.mockReset();
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();

    mockRequireTenantAdmin.mockResolvedValue("admin");
  });

  it("first call — full pipeline: authz → idempotency insert → core write → complete", async () => {
    mockResolveCallerUserId.mockResolvedValue(null); // apikey path uses principalId directly
    insertMutationIdempotencyMock.mockReturnValueOnce([{ id: "idemp-1" }]);
    const createdAgent = {
      id: "a-1",
      tenant_id: "tenant-A",
      name: "Marco",
      slug: "marco-slug",
    };
    insertAgentMock.mockReturnValueOnce([createdAgent]);

    const result = await createAgent(
      null,
      { input: { ...BASE_INPUT, idempotencyKey: "onboard-foo:marco" } },
      apikeyAdminCtx(),
    );

    // Authz ran.
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-A",
    );
    // Idempotency row inserted with the apikey principal as invoker.
    expect(insertMutationIdempotencyMock).toHaveBeenCalledOnce();
    const idempValues = insertMutationIdempotencyMock.mock.calls[0]?.[0] as {
      tenant_id: string;
      invoker_user_id: string;
      mutation_name: string;
      idempotency_key: string;
    };
    expect(idempValues.tenant_id).toBe("tenant-A");
    expect(idempValues.invoker_user_id).toBe("admin-1");
    expect(idempValues.mutation_name).toBe("createAgent");
    expect(idempValues.idempotency_key).toBe("onboard-foo:marco");
    // Core write ran.
    expect(insertAgentMock).toHaveBeenCalledOnce();
    // Completed to succeeded.
    expect(updateMutationIdempotencyMock).toHaveBeenCalledOnce();
    const completePatch = updateMutationIdempotencyMock.mock.calls[0]?.[0] as {
      status: string;
      result_json: unknown;
    };
    expect(completePatch.status).toBe("succeeded");
    // Resolver returns the camel-cased agent.
    expect(result).toMatchObject({ id: "a-1", name: "Marco" });
  });

  it("retry with same key returns cached result — core write NEVER runs again", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    // Simulate the prior row landing in the idempotency table.
    insertMutationIdempotencyMock.mockReturnValueOnce([]); // conflict
    const cachedResult = {
      id: "a-1",
      tenant_id: "tenant-A",
      name: "Marco",
      slug: "marco-slug",
    };
    selectMutationIdempotencyMock.mockReturnValueOnce([
      {
        id: "idemp-1",
        status: "succeeded",
        result_json: cachedResult,
        failure_reason: null,
      },
    ]);

    const result = await createAgent(
      null,
      { input: { ...BASE_INPUT, idempotencyKey: "onboard-foo:marco" } },
      apikeyAdminCtx(),
    );

    // Authz still runs — the role gate is NOT short-circuited by
    // idempotency (a cached row is per-caller; but role could have
    // been revoked mid-retry, so we re-check).
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-A",
    );
    // Core write DID NOT run — agents insert path untouched.
    expect(insertAgentMock).not.toHaveBeenCalled();
    expect(insertCapabilityMock).not.toHaveBeenCalled();
    // No complete/fail update — the stored row already has a terminal
    // status; only the existing row is read.
    expect(updateMutationIdempotencyMock).not.toHaveBeenCalled();
    // Result matches the stored cached row.
    expect(result).toEqual(cachedResult);
  });

  it("retry with prior status=failed throws the stored failure reason", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    insertMutationIdempotencyMock.mockReturnValueOnce([]); // conflict
    selectMutationIdempotencyMock.mockReturnValueOnce([
      {
        id: "idemp-1",
        status: "failed",
        result_json: null,
        failure_reason: "slug already taken",
      },
    ]);

    await expect(
      createAgent(
        null,
        { input: { ...BASE_INPUT, idempotencyKey: "onboard-foo:marco" } },
        apikeyAdminCtx(),
      ),
    ).rejects.toThrow("slug already taken");

    // Core write never ran.
    expect(insertAgentMock).not.toHaveBeenCalled();
  });

  it("no idempotency key + cognito caller → short-circuits to plain create (no idempotency row)", async () => {
    // Cognito path: principalId still resolves, but resolveCallerUserId
    // decides whether to short-circuit. Returning null here forces the
    // skip path.
    mockResolveCallerUserId.mockResolvedValue(null);
    insertAgentMock.mockReturnValueOnce([
      { id: "a-2", tenant_id: "tenant-A", name: "Marco", slug: "marco-2" },
    ]);

    const cognitoCtx = {
      auth: {
        authType: "cognito",
        principalId: "admin-uuid",
        tenantId: "tenant-A",
        email: "admin@example.com",
        agentId: null,
      },
    };
    await createAgent(null, { input: BASE_INPUT }, cognitoCtx as any);

    // Authz ran.
    expect(mockRequireTenantAdmin).toHaveBeenCalled();
    // Idempotency path skipped — core write hit directly.
    expect(insertMutationIdempotencyMock).not.toHaveBeenCalled();
    expect(updateMutationIdempotencyMock).not.toHaveBeenCalled();
    expect(insertAgentMock).toHaveBeenCalledOnce();
  });
});
