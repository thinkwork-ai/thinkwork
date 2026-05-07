/**
 * Integration test — every admin-skill-key resolver wires through
 * `runWithIdempotency` (Unit 8c closes the set at 4 resolvers:
 * createAgent, createTeam, createAgentTemplate, inviteMember).
 *
 * Invariants per resolver, parametrically:
 *
 *   1. Apikey caller with `idempotencyKey` in input →
 *      mutation_idempotency INSERT fires with the plan's canonical
 *      composite key shape: (tenantId, invokerUserId=principalId,
 *      mutationName, idempotency_key=input.idempotencyKey).
 *   2. On conflict + prior status=succeeded → cached `resultJson`
 *      returned; core write (insert into the resolver's primary
 *      table) is NEVER called again.
 *
 * These mirror the per-resolver unit tests + the e2e smoke from
 * Unit 13 but collapse them into one table to catch drift if
 * somebody adds a new resolver without wiring idempotency.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  insertMutationIdempotencyMock,
  selectMutationIdempotencyMock,
  updateMutationIdempotencyMock,
  insertPrimaryMock,
  selectOtherMock,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  cognitoSendMock,
} = vi.hoisted(() => ({
  insertMutationIdempotencyMock: vi.fn(),
  selectMutationIdempotencyMock: vi.fn(),
  updateMutationIdempotencyMock: vi.fn(),
  insertPrimaryMock: vi.fn(),
  selectOtherMock: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  cognitoSendMock: vi.fn(),
}));

vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  const dbMock: any = {
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
        return {
          returning: () =>
            Promise.resolve(insertPrimaryMock(values, table) as unknown[]),
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
          return Promise.resolve(selectOtherMock() as unknown[]);
        },
      }),
    })),
  };
  // U5: createAgent now wraps its insert in db.transaction. Pass
  // the same mock surface through so the tx-scoped insert /
  // select calls match the existing assertions.
  dbMock.transaction = vi.fn(
    async (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock),
  );
  return {
    ...actual,
    db: dbMock,
    invokeJobScheduleManager: vi.fn(),
  };
});

// U5: emitAuditEvent is mocked at module scope so the in-tx audit
// row insert is a no-op for these admin-resolver tests.
vi.mock("../lib/compliance/emit.js", () => ({
  emitAuditEvent: vi.fn().mockResolvedValue({
    eventId: "evt-mock",
    outboxId: "outbox-mock",
    redactedFields: [],
  }),
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
  resolveCallerTenantId: vi.fn(async () => "tenant-A"),
}));

// inviteMember's Cognito client is a module-load construction — mock
// AdminCreateUser / AdminGetUser so the resolver can run without AWS.
vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = cognitoSendMock;
  },
  AdminCreateUserCommand: class {
    constructor(public input: unknown) {}
  },
  AdminGetUserCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../lib/workspace-copy.js", () => ({
  copyDefaultsToTemplate: () => Promise.resolve(),
}));

// eslint-disable-next-line import/first
import { createAgent } from "../graphql/resolvers/agents/createAgent.mutation.js";
// eslint-disable-next-line import/first
import { createTeam } from "../graphql/resolvers/teams/createTeam.mutation.js";
// eslint-disable-next-line import/first
import { createAgentTemplate } from "../graphql/resolvers/templates/createAgentTemplate.mutation.js";
// eslint-disable-next-line import/first
import { inviteMember } from "../graphql/resolvers/core/inviteMember.mutation.js";

function apikeyAdminCtx(): any {
  return {
    auth: {
      authType: "apikey",
      principalId: "admin-1",
      tenantId: "tenant-A",
      email: null,
      agentId: "agent-admin",
    },
  };
}

interface Case {
  label: string;
  mutationName: string;
  primaryRow: Record<string, unknown>;
  run: () => Promise<unknown>;
}

const CASES: Case[] = [
  {
    label: "createAgent",
    mutationName: "createAgent",
    primaryRow: {
      id: "a-1",
      tenant_id: "tenant-A",
      name: "Marco",
      slug: "marco",
    },
    run: () =>
      createAgent(
        null,
        {
          input: {
            tenantId: "tenant-A",
            templateId: "tpl-1",
            name: "Marco",
            role: "assistant",
            adapterType: "strands",
            idempotencyKey: "onboard-foo:agent",
          },
        },
        apikeyAdminCtx(),
      ),
  },
  {
    label: "createTeam",
    mutationName: "createTeam",
    primaryRow: { id: "team-1", tenant_id: "tenant-A", name: "Core" },
    run: () =>
      createTeam(
        null,
        {
          input: {
            tenantId: "tenant-A",
            name: "Core",
            idempotencyKey: "onboard-foo:team",
          },
        },
        apikeyAdminCtx(),
      ),
  },
  {
    label: "createAgentTemplate",
    mutationName: "createAgentTemplate",
    primaryRow: { id: "tpl-1", tenant_id: "tenant-A", name: "Onboarder" },
    run: () =>
      createAgentTemplate(
        null,
        {
          input: {
            tenantId: "tenant-A",
            name: "Onboarder",
            slug: "onboarder",
            idempotencyKey: "onboard-foo:template",
          },
        },
        apikeyAdminCtx(),
      ),
  },
];

describe("admin-skill resolvers wire through runWithIdempotency", () => {
  beforeEach(() => {
    insertMutationIdempotencyMock.mockReset();
    selectMutationIdempotencyMock.mockReset();
    updateMutationIdempotencyMock.mockReset();
    insertPrimaryMock.mockReset();
    selectOtherMock.mockReset();
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();
    cognitoSendMock.mockReset();

    mockRequireTenantAdmin.mockResolvedValue("admin");
    // Apikey path: principalId used directly; resolveCallerUserId
    // unused but stubbed to null for safety.
    mockResolveCallerUserId.mockResolvedValue(null);
  });

  it.each(CASES)(
    "$label inserts mutation_idempotency with canonical composite key",
    async ({ label, mutationName, primaryRow, run }) => {
      insertMutationIdempotencyMock.mockReturnValueOnce([{ id: "idemp-1" }]);
      insertPrimaryMock.mockReturnValueOnce([primaryRow]);

      await run();

      expect(insertMutationIdempotencyMock).toHaveBeenCalledOnce();
      const row = insertMutationIdempotencyMock.mock.calls[0]?.[0] as {
        tenant_id: string;
        invoker_user_id: string;
        mutation_name: string;
        idempotency_key: string;
      };
      expect(row.tenant_id).toBe("tenant-A");
      expect(row.invoker_user_id).toBe("admin-1");
      expect(row.mutation_name).toBe(mutationName);
      expect(row.idempotency_key).toContain("onboard-foo");
      // After success, exactly one complete() update.
      expect(updateMutationIdempotencyMock).toHaveBeenCalledOnce();
      expect(
        (
          updateMutationIdempotencyMock.mock.calls[0]?.[0] as {
            status: string;
          }
        ).status,
      ).toBe("succeeded");
    },
  );

  it.each(CASES)(
    "$label returns cached result on retry without re-running primary insert",
    async ({ primaryRow, run }) => {
      // Conflict path: insert returns [] (already existed), select
      // returns the cached succeeded row.
      insertMutationIdempotencyMock.mockReturnValueOnce([]);
      selectMutationIdempotencyMock.mockReturnValueOnce([
        {
          id: "idemp-1",
          status: "succeeded",
          result_json: primaryRow,
          failure_reason: null,
        },
      ]);

      await run();

      // Primary insert (agents / teams / agent_templates) NOT called.
      expect(insertPrimaryMock).not.toHaveBeenCalled();
      // No complete() / fail() on retry — row already terminal.
      expect(updateMutationIdempotencyMock).not.toHaveBeenCalled();
    },
  );

  // inviteMember exercises its own test case — the Cognito flow has
  // different side effects (AdminCreateUser) that matter for
  // idempotency. Retry must not re-send the invite email.
  it("inviteMember retry with cached result skips Cognito AdminCreateUser", async () => {
    insertMutationIdempotencyMock.mockReturnValueOnce([]);
    selectMutationIdempotencyMock.mockReturnValueOnce([
      {
        id: "idemp-1",
        status: "succeeded",
        result_json: {
          id: "member-1",
          tenant_id: "tenant-A",
          principal_id: "cognito-sub-1",
        },
        failure_reason: null,
      },
    ]);

    await inviteMember(
      null,
      {
        tenantId: "tenant-A",
        input: {
          email: "new@acme.com",
          name: "New Hire",
          role: "admin",
          idempotencyKey: "onboard-foo:invite-new-hire",
        },
      },
      apikeyAdminCtx(),
    );

    // This is the critical invariant for inviteMember idempotency —
    // Cognito AdminCreateUser sends a welcome email. A retry without
    // the cache would spam the invitee.
    expect(cognitoSendMock).not.toHaveBeenCalled();
    // No DB writes for member / user row either.
    expect(insertPrimaryMock).not.toHaveBeenCalled();
  });

  it("inviteMember fresh call runs the Cognito flow once", async () => {
    insertMutationIdempotencyMock.mockReturnValueOnce([{ id: "idemp-2" }]);
    cognitoSendMock.mockResolvedValueOnce({
      User: { Attributes: [{ Name: "sub", Value: "cognito-sub-2" }] },
    });
    selectOtherMock.mockReturnValueOnce([]); // no existing user
    selectOtherMock.mockReturnValueOnce([]); // no existing member
    // Only the tenant_members insert consumes .returning(); the users
    // insert is awaited directly and never calls the mock factory.
    insertPrimaryMock.mockReturnValueOnce([
      {
        id: "member-1",
        tenant_id: "tenant-A",
        principal_id: "cognito-sub-2",
      },
    ]);

    await inviteMember(
      null,
      {
        tenantId: "tenant-A",
        input: {
          email: "new@acme.com",
          role: "admin",
          idempotencyKey: "onboard-foo:invite-fresh",
        },
      },
      apikeyAdminCtx(),
    );

    // AdminCreateUser fired exactly once.
    expect(cognitoSendMock).toHaveBeenCalledOnce();
    // Idempotency row committed as succeeded.
    expect(
      (
        updateMutationIdempotencyMock.mock.calls[0]?.[0] as {
          status: string;
        }
      ).status,
    ).toBe("succeeded");
  });
});
