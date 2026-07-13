/**
 * createConnectionProposal / admitConnectionProposal /
 * rejectConnectionProposal resolver tests (THINK-280 U2).
 *
 * The research/admission libs have their own suites; these tests cover
 * the resolver contract: admin gating on every mutation, AWSJSON input
 * tolerance, signing-unavailable fail-closed, exact-fingerprint mismatch
 * surfacing as 'rejected', forged-tenant isolation on reject, and audit
 * emission (applied outcomes only).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  writeOps,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockEmitAuditEvent,
  mockCreateConnectionProposalLib,
  mockAdmitConnectionProposalLib,
  mockResolveConfiguredCapabilitySigner,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  writeOps: [] as Array<{ op: string; args: unknown }>,
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockEmitAuditEvent: vi.fn(),
  mockCreateConnectionProposalLib: vi.fn(),
  mockAdmitConnectionProposalLib: vi.fn(),
  mockResolveConfiguredCapabilitySigner: vi.fn(),
}));

function takeRows(): unknown[] {
  return rowsQueue.shift() ?? [];
}

function selectChain() {
  const promise = Promise.resolve(takeRows());
  return {
    limit: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectChain() }) }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            writeOps.push({ op: "update", args: { table, values } });
            return Promise.resolve(takeRows());
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ label: "tx" }),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  or: (...preds: unknown[]) => ({ op: "or", preds }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
  agents: {
    tenant_id: "agents.tenant_id",
    is_platform_default: "agents.is_platform_default",
    slug: "agents.slug",
    workspace_folder_name: "agents.workspace_folder_name",
  },
  tenants: { id: "tenants.id", slug: "tenants.slug" },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  capabilityDefinitionVersions: {
    definition_id: "capabilityDefinitionVersions.definition_id",
  },
  capabilityConnectionProposals: {
    id: "capabilityConnectionProposals.id",
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

vi.mock("../../../lib/capabilities/research.js", () => ({
  createConnectionProposal: mockCreateConnectionProposalLib,
}));

vi.mock("../../../lib/capabilities/admission.js", () => ({
  admitConnectionProposal: mockAdmitConnectionProposalLib,
}));

vi.mock("../../../lib/capabilities/sidecar-signing.js", () => ({
  resolveConfiguredCapabilitySigner: mockResolveConfiguredCapabilitySigner,
}));

import {
  createConnectionProposal,
  admitConnectionProposal,
  rejectConnectionProposal,
} from "./connectionProposal.mutations.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "99999999-9999-9999-9999-999999999999";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const PROPOSAL_ID = "44444444-4444-4444-4444-444444444444";
const DEF_ID = "22222222-2222-2222-2222-222222222222";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";

const ctx = {} as GraphQLContext;

const FAKE_SIGNER = { signPayload: vi.fn() };

const PROPOSAL_ROW = {
  id: PROPOSAL_ID,
  tenant_id: TENANT_A,
  definition_id: null,
  payload_json: { descriptor: { slug: "github" } },
  payload_fingerprint: "c".repeat(64),
  provenance_json: { sourceUrls: ["https://docs.github.com"] },
  status: "draft",
  inbox_item_id: null,
  created_by_actor_type: "user",
  created_by_actor_id: USER_ID,
  decided_at: null,
  decided_by_user_id: null,
  created_at: new Date("2026-07-03T00:00:00.000Z"),
};

const DEFINITION_ROW = {
  id: DEF_ID,
  tenant_id: TENANT_A,
  namespace: "acme",
  class: "connection",
  slug: "github",
  display_name: "GitHub",
  status: "active",
  created_at: new Date("2026-07-01T00:00:00.000Z"),
};

const VERSION_ROW = {
  id: VERSION_ID,
  definition_id: DEF_ID,
  version: 1,
  lifecycle: "admitted",
  descriptor_json: { operations: "malformed-so-operations-render-empty" },
  descriptor_fingerprint: "b".repeat(64),
  contract_hashes_json: {},
  provenance_json: {},
  source_proposal_id: PROPOSAL_ID,
  admitted_at: new Date("2026-07-04T00:00:00.000Z"),
  admitted_by_user_id: USER_ID,
  created_at: new Date("2026-07-04T00:00:00.000Z"),
};

beforeEach(() => {
  rowsQueue.length = 0;
  writeOps.length = 0;
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerUserId.mockResolvedValue(USER_ID);
  mockEmitAuditEvent.mockResolvedValue({ eventId: "evt-1" });
  mockResolveConfiguredCapabilitySigner.mockResolvedValue(FAKE_SIGNER);
  mockCreateConnectionProposalLib.mockResolvedValue({
    outcome: "applied",
    proposal: PROPOSAL_ROW,
  });
  mockAdmitConnectionProposalLib.mockResolvedValue({
    outcome: "applied",
    definition: DEFINITION_ROW,
    version: VERSION_ROW,
    proposal: { ...PROPOSAL_ROW, status: "admitted" },
  });
});

describe("authz", () => {
  it("rejects non-admin callers on all three mutations before any work", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      createConnectionProposal(
        null,
        {
          input: {
            tenantId: TENANT_A,
            payload: {},
            sourceUrls: ["https://x.example"],
          },
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    await expect(
      admitConnectionProposal(
        null,
        {
          input: {
            tenantId: TENANT_A,
            proposalId: PROPOSAL_ID,
            reviewedFingerprint: "c".repeat(64),
          },
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    await expect(
      rejectConnectionProposal(
        null,
        { tenantId: TENANT_A, proposalId: PROPOSAL_ID },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    expect(mockCreateConnectionProposalLib).not.toHaveBeenCalled();
    expect(mockAdmitConnectionProposalLib).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("createConnectionProposal", () => {
  it("parses AWSJSON string payloads, passes the user actor, audits, and maps the proposal", async () => {
    const result = await createConnectionProposal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          payload: JSON.stringify({ descriptor: { slug: "github" } }),
          sourceUrls: ["https://docs.github.com"],
        },
      },
      ctx,
    );

    expect(mockCreateConnectionProposalLib).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_A,
        definitionId: null,
        payload: { descriptor: { slug: "github" } },
        sourceUrls: ["https://docs.github.com"],
        actor: { type: "user", id: USER_ID },
      }),
    );
    expect(result.outcome).toBe("applied");
    expect(result.proposal).toMatchObject({
      id: PROPOSAL_ID,
      tenantId: TENANT_A,
      status: "draft",
    });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT_A,
      actorId: USER_ID,
      actorType: "user",
      eventType: "agent.connection_proposal_created",
      source: "graphql",
      resourceType: "capability_proposal",
      resourceId: PROPOSAL_ID,
      action: "create",
    });
  });

  it("a rejected proposal emits no audit event", async () => {
    mockCreateConnectionProposalLib.mockResolvedValue({
      outcome: "rejected",
      reason: "sourceUrls: at least one official source URL is required",
    });
    const result = await createConnectionProposal(
      null,
      { input: { tenantId: TENANT_A, payload: {}, sourceUrls: [] } },
      ctx,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.proposal).toBeNull();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("admitConnectionProposal", () => {
  it("signing unavailable → 'rejected' reason 'signing_unavailable' and the lib is never reached", async () => {
    mockResolveConfiguredCapabilitySigner.mockResolvedValue(null);
    const result = await admitConnectionProposal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          proposalId: PROPOSAL_ID,
          reviewedFingerprint: "c".repeat(64),
        },
      },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "signing_unavailable",
    });
    expect(mockAdmitConnectionProposalLib).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("an identity-less service caller cannot ghost-sign an admission", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    const result = await admitConnectionProposal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          proposalId: PROPOSAL_ID,
          reviewedFingerprint: "c".repeat(64),
        },
      },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "admin_identity_required",
    });
    expect(mockAdmitConnectionProposalLib).not.toHaveBeenCalled();
  });

  it("a reviewed-fingerprint mismatch surfaces as 'rejected' with no audit event", async () => {
    mockAdmitConnectionProposalLib.mockResolvedValue({
      outcome: "rejected",
      reason: "fingerprint_mismatch",
    });
    const result = await admitConnectionProposal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          proposalId: PROPOSAL_ID,
          reviewedFingerprint: "f".repeat(64),
        },
      },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "fingerprint_mismatch",
    });
    expect(result.definition).toBeNull();
    expect(result.version).toBeNull();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("applied admission wires signer + folderWriter through, audits, and maps definition/version/proposal", async () => {
    const result = await admitConnectionProposal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          proposalId: PROPOSAL_ID,
          reviewedFingerprint: "c".repeat(64),
        },
      },
      ctx,
    );

    expect(mockAdmitConnectionProposalLib).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_A,
        proposalId: PROPOSAL_ID,
        reviewedFingerprint: "c".repeat(64),
        adminUserId: USER_ID,
        signer: FAKE_SIGNER,
        folderWriter: expect.objectContaining({
          write: expect.any(Function),
        }),
      }),
    );
    expect(result.outcome).toBe("applied");
    expect(result.definition).toMatchObject({ id: DEF_ID, slug: "github" });
    expect(result.version).toMatchObject({
      id: VERSION_ID,
      version: 1,
      lifecycle: "admitted",
      // Malformed descriptor fixture → fail-soft empty operations view.
      operations: [],
    });
    expect(result.proposal).toMatchObject({ status: "admitted" });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      eventType: "agent.connection_proposal_admitted",
      resourceType: "capability_definition",
      resourceId: DEF_ID,
      action: "admit",
      actorId: USER_ID,
    });
  });
});

describe("rejectConnectionProposal", () => {
  it("tenant B cannot reject tenant A's proposal (forged-tenant isolation)", async () => {
    rowsQueue.push([PROPOSAL_ROW]); // proposal belongs to TENANT_A
    const result = await rejectConnectionProposal(
      null,
      { tenantId: TENANT_B, proposalId: PROPOSAL_ID },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "proposal_not_found",
    });
    expect(writeOps).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("only draft|submitted proposals are rejectable", async () => {
    rowsQueue.push([{ ...PROPOSAL_ROW, status: "admitted" }]);
    const result = await rejectConnectionProposal(
      null,
      { tenantId: TENANT_A, proposalId: PROPOSAL_ID },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "proposal_already_decided",
    });
    expect(writeOps).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("marks a draft proposal rejected with decided_at/by and audits", async () => {
    rowsQueue.push([PROPOSAL_ROW]); // load
    rowsQueue.push([
      {
        ...PROPOSAL_ROW,
        status: "rejected",
        decided_at: new Date("2026-07-05T00:00:00.000Z"),
        decided_by_user_id: USER_ID,
      },
    ]); // update returning

    const result = await rejectConnectionProposal(
      null,
      { tenantId: TENANT_A, proposalId: PROPOSAL_ID, reason: "wrong vendor" },
      ctx,
    );

    expect(result.outcome).toBe("applied");
    expect(result.proposal).toMatchObject({
      id: PROPOSAL_ID,
      status: "rejected",
      decidedByUserId: USER_ID,
    });
    const update = writeOps.find((op) => op.op === "update");
    expect(update).toBeDefined();
    expect(
      (update!.args as { values: Record<string, unknown> }).values,
    ).toMatchObject({
      status: "rejected",
      decided_by_user_id: USER_ID,
    });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      eventType: "agent.connection_proposal_rejected",
      resourceType: "capability_proposal",
      resourceId: PROPOSAL_ID,
      action: "reject",
      payload: expect.objectContaining({ reason: "wrong vendor" }),
    });
  });
});
