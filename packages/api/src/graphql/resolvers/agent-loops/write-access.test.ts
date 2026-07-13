import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  requireTenantAdmin: vi.fn(),
  requireTenantMember: vi.fn(),
  requireAgentAllowsOperation: vi.fn(),
  assertCanvasAccess: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
      };
      return chain;
    },
  },
  tenantMembers: {},
  users: {},
  artifacts: {},
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mocks.requireTenantAdmin,
  requireTenantMember: mocks.requireTenantMember,
  requireAgentAllowsOperation: mocks.requireAgentAllowsOperation,
}));

vi.mock("../../../lib/artifacts/canvas-access.js", () => ({
  assertCanvasAccess: mocks.assertCanvasAccess,
}));

// eslint-disable-next-line import/first
import { requireAgentLoopWriteAccess } from "./write-access.js";
// eslint-disable-next-line import/first
import { normalizeTargetSpec } from "@thinkwork/agent-loops-core";

const TENANT = "tenant-1";
const MEMBER = "member-user-1";

function apikeyCtx(principalId: string | null = MEMBER) {
  return {
    auth: {
      authType: "apikey" as const,
      principalId,
      tenantId: TENANT,
      email: null,
      agentId: "agent-1",
    },
  } as never;
}

function cognitoCtx() {
  return {
    auth: {
      authType: "cognito" as const,
      principalId: "sub-1",
      tenantId: TENANT,
      email: "member@x.com",
      agentId: null,
    },
  } as never;
}

function serviceCtx() {
  return {
    auth: {
      authType: "service" as const,
      principalId: null,
      tenantId: TENANT,
      email: null,
      agentId: null,
    },
  } as never;
}

const memberBoundSpec = normalizeTargetSpec({
  kind: "agent_thread",
  agentThread: { instructions: "Refresh", threadMode: "new_per_run" },
  documentBinding: {
    mode: "create",
    genre: "report",
    title: "Weekly",
    spaceId: "space-1",
  },
  delivery: { recipients: ["member@x.com"] },
});

beforeEach(() => {
  mocks.selectQueue.length = 0;
  mocks.requireTenantAdmin.mockReset().mockResolvedValue(undefined);
  mocks.requireTenantMember.mockReset().mockResolvedValue("admin");
  mocks.requireAgentAllowsOperation.mockReset().mockResolvedValue(undefined);
  mocks.assertCanvasAccess.mockReset().mockResolvedValue(undefined);
});

describe("requireAgentLoopWriteAccess (THINK-227 U11)", () => {
  it("keeps the default Cognito surface owner-scoped even for tenant admins", async () => {
    await expect(
      requireAgentLoopWriteAccess(cognitoCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: "admin-user",
        accessScope: "USER",
        existing: {
          ownerUserId: "someone-else",
          runAsUserId: "someone-else",
        },
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/only change automations they own/i);
    expect(mocks.requireTenantMember).toHaveBeenCalledTimes(1);
    expect(mocks.requireTenantAdmin).not.toHaveBeenCalled();
  });

  it("allows an explicitly requested operator write only after the admin gate", async () => {
    await requireAgentLoopWriteAccess(cognitoCtx(), TENANT, {
      operationName: "save_agent_loop",
      actorId: "any-admin",
      accessScope: "OPERATOR",
      targetSpec: memberBoundSpec,
    });
    expect(mocks.requireTenantAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.selectQueue).toHaveLength(0);
  });

  it("admin apikey callers keep general access (role + allowlist gates only)", async () => {
    mocks.selectQueue.push([{ role: "admin" }]);
    await requireAgentLoopWriteAccess(apikeyCtx("admin-user"), TENANT, {
      operationName: "save_agent_loop",
      actorId: "admin-user",
      submittedRunAsUserId: "someone-else", // admins may set any run-as
      targetSpec: memberBoundSpec,
    });
    expect(mocks.requireAgentAllowsOperation).toHaveBeenCalledWith(
      expect.anything(),
      "save_agent_loop",
    );
  });

  it("the per-agent allowlist gates the member branch too", async () => {
    mocks.requireAgentAllowsOperation.mockRejectedValue(
      new Error("Agent identity required for admin-skill operations"),
    );
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/Agent identity required/);
  });

  it("member creates a self-scoped automation → allowed", async () => {
    mocks.selectQueue.push([{ role: "member" }]); // role lookup
    mocks.selectQueue.push([{ email: "Member@X.com" }]); // users email (case-insensitive)
    await requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
      operationName: "save_agent_loop",
      actorId: MEMBER,
      targetSpec: memberBoundSpec,
    });
  });

  it("member with a third-party recipient → forbidden with the operator-path relay (AE7)", async () => {
    mocks.selectQueue.push([{ role: "member" }]);
    mocks.selectQueue.push([{ email: "member@x.com" }]);
    const spec = normalizeTargetSpec({
      ...memberBoundSpec,
      delivery: { recipients: ["member@x.com", "colleague@x.com"] },
    });
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        targetSpec: spec,
      }),
    ).rejects.toThrow(/only email scheduled reports to themselves.*operator/is);
  });

  it("recipient compared against the DB email, never an input-claimed one", async () => {
    mocks.selectQueue.push([{ role: "member" }]);
    mocks.selectQueue.push([{ email: "real@x.com" }]); // DB says real@x.com
    const spec = normalizeTargetSpec({
      ...memberBoundSpec,
      delivery: { recipients: ["member@x.com"] }, // claimed address ≠ DB email
    });
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        targetSpec: spec,
      }),
    ).rejects.toThrow(/operator/i);
  });

  it("member updating an operator-owned automation → forbidden", async () => {
    mocks.selectQueue.push([{ role: "member" }]);
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        targetSpec: memberBoundSpec,
        existing: { ownerUserId: "operator-1", runAsUserId: "operator-1" },
      }),
    ).rejects.toThrow(/only change automations they own/i);
  });

  it("member spoofing another owner on create → forbidden", async () => {
    mocks.selectQueue.push([{ role: "member" }]);
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        submittedOwnerUserId: "someone-else",
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/own themselves/i);
  });

  it("member with a mismatched run-as → forbidden", async () => {
    mocks.selectQueue.push([{ role: "member" }]);
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        submittedRunAsUserId: "someone-else",
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/run as the member/i);
  });

  it("member deleting their own automation → allowed; someone else's → forbidden", async () => {
    mocks.selectQueue.push([{ role: "member" }]);
    await requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
      operationName: "delete_agent_loop",
      actorId: MEMBER,
      existing: { ownerUserId: MEMBER, runAsUserId: MEMBER },
    });

    mocks.selectQueue.push([{ role: "member" }]);
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "delete_agent_loop",
        actorId: MEMBER,
        existing: { ownerUserId: "operator-1", runAsUserId: "operator-1" },
      }),
    ).rejects.toThrow(/only change automations they own/i);
  });

  it("member binding an unreadable existing artifact → forbidden", async () => {
    mocks.selectQueue.push([{ role: "member" }]);
    mocks.selectQueue.push([{ email: "member@x.com" }]);
    mocks.selectQueue.push([{ id: "art-9", tenant_id: TENANT }]); // artifact row
    mocks.assertCanvasAccess.mockRejectedValue(new Error("Forbidden"));
    const spec = normalizeTargetSpec({
      kind: "agent_thread",
      agentThread: { instructions: "Refresh", threadMode: "new_per_run" },
      documentBinding: { mode: "existing", artifactId: "art-9" },
      delivery: { recipients: ["member@x.com"] },
    });
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        targetSpec: spec,
      }),
    ).rejects.toThrow(/Forbidden/);
    expect(mocks.assertCanvasAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "art-9" }),
      "read",
    );
  });

  it("admin binding a nonexistent existing artifact → rejected at save time", async () => {
    mocks.selectQueue.push([]); // artifact lookup: no row
    const spec = normalizeTargetSpec({
      kind: "agent_thread",
      agentThread: { instructions: "Refresh", threadMode: "new_per_run" },
      documentBinding: { mode: "existing", artifactId: "no-such-artifact" },
      delivery: { recipients: ["anyone@x.com"] },
    });
    await expect(
      requireAgentLoopWriteAccess(cognitoCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: "any-admin",
        accessScope: "OPERATOR",
        targetSpec: spec,
      }),
    ).rejects.toThrow(/not found in this tenant.*no-such-artifact/is);
    expect(mocks.assertCanvasAccess).not.toHaveBeenCalled();
  });

  it("admin apikey caller gets the same existence check; a real artifact passes without a canvas-read gate", async () => {
    const spec = normalizeTargetSpec({
      kind: "agent_thread",
      agentThread: { instructions: "Refresh", threadMode: "new_per_run" },
      documentBinding: { mode: "existing", artifactId: "art-1" },
    });

    mocks.selectQueue.push([{ role: "admin" }]); // role lookup
    mocks.selectQueue.push([]); // artifact lookup: no row
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx("admin-user"), TENANT, {
        operationName: "save_agent_loop",
        actorId: "admin-user",
        targetSpec: spec,
      }),
    ).rejects.toThrow(/not found in this tenant/i);

    mocks.selectQueue.push([{ role: "admin" }]);
    mocks.selectQueue.push([{ id: "art-1", tenant_id: TENANT }]);
    await requireAgentLoopWriteAccess(apikeyCtx("admin-user"), TENANT, {
      operationName: "save_agent_loop",
      actorId: "admin-user",
      targetSpec: spec,
    });
    expect(mocks.assertCanvasAccess).not.toHaveBeenCalled();
  });

  it("bare service callers are refused on these mutations (KTD10)", async () => {
    await expect(
      requireAgentLoopWriteAccess(serviceCtx(), TENANT, {
        operationName: "save_agent_loop",
        actorId: null,
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/acting user identity/i);
  });

  it("apikey caller with no asserted principal is refused (no admin fallback)", async () => {
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx(null), TENANT, {
        operationName: "save_agent_loop",
        actorId: null,
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/x-principal-id missing/);
  });

  it("non-member principal is refused before any scope check", async () => {
    mocks.selectQueue.push([]); // no tenant_members row
    await expect(
      requireAgentLoopWriteAccess(apikeyCtx("outsider"), TENANT, {
        operationName: "save_agent_loop",
        actorId: "outsider",
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/not a member/i);
  });

  it("cognito member (non-admin) gets the same member scope", async () => {
    mocks.selectQueue.push([{ email: "member@x.com" }]); // users email
    await requireAgentLoopWriteAccess(cognitoCtx(), TENANT, {
      operationName: "save_agent_loop",
      actorId: MEMBER,
      targetSpec: memberBoundSpec,
    });
    expect(mocks.requireTenantMember).toHaveBeenCalledTimes(1);
  });

  it("rejects a Cognito caller who is not a member of the submitted tenant", async () => {
    mocks.requireTenantMember.mockRejectedValue(
      new Error("Tenant membership required"),
    );
    await expect(
      requireAgentLoopWriteAccess(cognitoCtx(), "tenant-other", {
        operationName: "save_agent_loop",
        actorId: MEMBER,
        targetSpec: memberBoundSpec,
      }),
    ).rejects.toThrow(/Tenant membership required/);
  });
});
