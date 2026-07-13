/**
 * createCredentialBinding / verifyCredentialBinding /
 * revokeCredentialBinding resolver tests (THINK-280 U2).
 *
 * The readiness lib has its own suite; these tests cover the resolver
 * contract: admin gating, secret-resolver + probe-runner wiring, the
 * probe-unavailable fail-honest path ('rejected' reason
 * 'probe_unavailable', never a crash), audit emission on applied
 * outcomes only — and that credential references never appear in ANY
 * response.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockEmitAuditEvent,
  mockCreateCredentialBindingLib,
  mockVerifyCredentialBindingLib,
  mockRevokeCredentialBindingLib,
  mockStubProbe,
  mockReadTenantCredentialSecret,
} = vi.hoisted(() => ({
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockEmitAuditEvent: vi.fn(),
  mockCreateCredentialBindingLib: vi.fn(),
  mockVerifyCredentialBindingLib: vi.fn(),
  mockRevokeCredentialBindingLib: vi.fn(),
  mockStubProbe: vi.fn(),
  mockReadTenantCredentialSecret: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve([]) }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ label: "tx" }),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  or: (...preds: unknown[]) => ({ op: "or", preds }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  capabilityDefinitionVersions: {
    definition_id: "capabilityDefinitionVersions.definition_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: mockEmitAuditEvent,
}));

vi.mock("../../../lib/capabilities/readiness.js", () => ({
  createCredentialBinding: mockCreateCredentialBindingLib,
  verifyCredentialBinding: mockVerifyCredentialBindingLib,
  revokeCredentialBinding: mockRevokeCredentialBindingLib,
  readOnlyHttpProbeRunner: { probe: mockStubProbe },
}));

vi.mock("../../../lib/tenant-credentials/secret-store.js", () => ({
  readTenantCredentialSecret: mockReadTenantCredentialSecret,
}));

import {
  createCredentialBinding,
  verifyCredentialBinding,
  revokeCredentialBinding,
} from "./credentialBinding.mutations.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";
const BINDING_ID = "77777777-7777-7777-7777-777777777777";
const SECRET_REF = "tenant-credential:88888888-8888-8888-8888-888888888888";

const ctx = {} as GraphQLContext;

const BINDING_ROW = {
  id: BINDING_ID,
  tenant_id: TENANT_A,
  definition_version_id: VERSION_ID,
  principal_mode: "service",
  service_principal_id: "sp-1",
  subject_user_id: null,
  credential_refs_json: { api_key: SECRET_REF },
  readiness: "pending_setup",
  readiness_evidence_json: {},
  last_verified_at: null,
  revoked_at: null,
  created_by_user_id: USER_ID,
  created_at: new Date("2026-07-09T00:00:00.000Z"),
  updated_at: new Date("2026-07-09T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerUserId.mockResolvedValue(USER_ID);
  mockEmitAuditEvent.mockResolvedValue({ eventId: "evt-1" });
  mockCreateCredentialBindingLib.mockResolvedValue({
    outcome: "applied",
    binding: BINDING_ROW,
  });
  mockVerifyCredentialBindingLib.mockResolvedValue({
    outcome: "applied",
    binding: { ...BINDING_ROW, readiness: "ready" },
  });
  mockRevokeCredentialBindingLib.mockResolvedValue({
    outcome: "applied",
    binding: { ...BINDING_ROW, readiness: "revoked", revoked_at: new Date() },
  });
  mockStubProbe.mockRejectedValue(new Error("not-implemented-in-U2a"));
});

describe("authz", () => {
  it("rejects non-admin callers on all three mutations before any work", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      createCredentialBinding(
        null,
        {
          input: {
            tenantId: TENANT_A,
            definitionVersionId: VERSION_ID,
            principalMode: "service",
            servicePrincipalId: "sp-1",
            credentialRefs: { api_key: SECRET_REF },
          },
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    await expect(
      verifyCredentialBinding(
        null,
        { tenantId: TENANT_A, bindingId: BINDING_ID },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    await expect(
      revokeCredentialBinding(
        null,
        { tenantId: TENANT_A, bindingId: BINDING_ID },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    expect(mockCreateCredentialBindingLib).not.toHaveBeenCalled();
    expect(mockVerifyCredentialBindingLib).not.toHaveBeenCalled();
    expect(mockRevokeCredentialBindingLib).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("createCredentialBinding", () => {
  it("parses AWSJSON refs, passes creator identity, audits — and never echoes credential refs", async () => {
    const result = await createCredentialBinding(
      null,
      {
        input: {
          tenantId: TENANT_A,
          definitionVersionId: VERSION_ID,
          principalMode: "service",
          servicePrincipalId: "sp-1",
          credentialRefs: JSON.stringify({ api_key: SECRET_REF }),
        },
      },
      ctx,
    );

    expect(mockCreateCredentialBindingLib).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_A,
        definitionVersionId: VERSION_ID,
        principalMode: "service",
        servicePrincipalId: "sp-1",
        credentialRefs: { api_key: SECRET_REF },
        createdByUserId: USER_ID,
      }),
    );
    expect(result.outcome).toBe("applied");
    expect(result.binding).toMatchObject({
      id: BINDING_ID,
      tenantId: TENANT_A,
      principalMode: "service",
      readiness: "pending_setup",
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("credential_refs");
    expect(serialized).not.toContain("credentialRefs");
    expect(serialized).not.toContain(SECRET_REF);

    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      eventType: "agent.credential_binding_created",
      resourceType: "capability_credential_binding",
      resourceId: BINDING_ID,
      action: "create",
    });
    // Refs never enter the audit payload either.
    expect(JSON.stringify(mockEmitAuditEvent.mock.calls[0]![1])).not.toContain(
      SECRET_REF,
    );
  });

  it("a rejected binding emits no audit event", async () => {
    mockCreateCredentialBindingLib.mockResolvedValue({
      outcome: "rejected",
      reason: "servicePrincipalId: required for service mode",
    });
    const result = await createCredentialBinding(
      null,
      {
        input: {
          tenantId: TENANT_A,
          definitionVersionId: VERSION_ID,
          principalMode: "service",
          credentialRefs: {},
        },
      },
      ctx,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.binding).toBeNull();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("verifyCredentialBinding", () => {
  it("wires the secret resolver over readTenantCredentialSecret and the U2a probe stub", async () => {
    await verifyCredentialBinding(
      null,
      { tenantId: TENANT_A, bindingId: BINDING_ID },
      ctx,
    );

    expect(mockVerifyCredentialBindingLib).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_A,
        bindingId: BINDING_ID,
        secretResolver: expect.objectContaining({
          resolve: expect.any(Function),
        }),
        probeRunner: expect.objectContaining({ probe: expect.any(Function) }),
      }),
    );
    const { secretResolver } = mockVerifyCredentialBindingLib.mock
      .calls[0]![1] as {
      secretResolver: { resolve: (ref: string) => Promise<unknown> };
    };
    mockReadTenantCredentialSecret.mockResolvedValue({ apiKey: "k" });
    await secretResolver.resolve(SECRET_REF);
    expect(mockReadTenantCredentialSecret).toHaveBeenCalledWith(SECRET_REF);
  });

  it("a probe stub throw surfaces as 'rejected' reason 'probe_unavailable' — never a crash", async () => {
    // Simulate the lib exercising the injected probe runner (its real
    // behavior absorbs the throw into a degraded settle).
    mockVerifyCredentialBindingLib.mockImplementation(
      async (_db: unknown, input: Record<string, unknown>) => {
        const runner = input.probeRunner as {
          probe: (i: unknown) => Promise<unknown>;
        };
        try {
          await runner.probe({
            descriptor: {},
            probeConfig: { readOnly: true },
            credential: {},
          });
        } catch {
          // lib absorbs
        }
        return {
          outcome: "applied",
          reason: "probe_error",
          binding: { ...BINDING_ROW, readiness: "degraded" },
        };
      },
    );

    const result = await verifyCredentialBinding(
      null,
      { tenantId: TENANT_A, bindingId: BINDING_ID },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "probe_unavailable",
    });
    expect(mockStubProbe).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("an applied verification (probe never reached the stub) audits with the readiness result", async () => {
    const result = await verifyCredentialBinding(
      null,
      { tenantId: TENANT_A, bindingId: BINDING_ID },
      ctx,
    );
    expect(result.outcome).toBe("applied");
    expect(result.binding).toMatchObject({ readiness: "ready" });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      eventType: "agent.credential_binding_verified",
      action: "verify",
      resourceId: BINDING_ID,
      payload: expect.objectContaining({ readiness: "ready" }),
    });
  });

  it("a rejected verification (e.g. forged tenant → binding_not_found) emits no audit event", async () => {
    mockVerifyCredentialBindingLib.mockResolvedValue({
      outcome: "rejected",
      reason: "binding_not_found",
    });
    const result = await verifyCredentialBinding(
      null,
      { tenantId: TENANT_A, bindingId: BINDING_ID },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "binding_not_found",
    });
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("revokeCredentialBinding", () => {
  it("applied revocation audits; noop does not", async () => {
    const applied = await revokeCredentialBinding(
      null,
      { tenantId: TENANT_A, bindingId: BINDING_ID },
      ctx,
    );
    expect(applied.outcome).toBe("applied");
    expect(applied.binding).toMatchObject({ readiness: "revoked" });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      eventType: "agent.credential_binding_revoked",
      action: "revoke",
    });

    mockEmitAuditEvent.mockClear();
    mockRevokeCredentialBindingLib.mockResolvedValue({
      outcome: "noop",
      binding: { ...BINDING_ROW, readiness: "revoked" },
    });
    const noop = await revokeCredentialBinding(
      null,
      { tenantId: TENANT_A, bindingId: BINDING_ID },
      ctx,
    );
    expect(noop.outcome).toBe("noop");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("revocation responses never contain credential refs", async () => {
    const result = await revokeCredentialBinding(
      null,
      { tenantId: TENANT_A, bindingId: BINDING_ID },
      ctx,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("credential_refs");
    expect(serialized).not.toContain(SECRET_REF);
  });
});
