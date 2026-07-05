import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the KTD8 dead-tool bug (THINK-145 U9).
 *
 * The live failure: `threadCanvasContext` returned FORBIDDEN "Tenant membership
 * required" for the Pi runtime's service+principal (apikey) caller because it
 * gated on `requireTenantMember`, which hard-rejects any non-cognito auth. The
 * pre-existing unit test mocked the whole authz module, so it never exercised
 * the real gate and the bug shipped.
 *
 * This test does NOT mock `../core/authz.js` — it runs the REAL
 * `requireActingTenantMember` against a mocked DB returning a membership row
 * for the acting user. It fails against the old `requireTenantMember` gate and
 * passes with the acting-user gate, so it is the test that would have caught
 * the regression.
 */

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const SPACE_ID = "44444444-4444-4444-4444-444444444444";
const ACTING_USER_ID = "55555555-5555-5555-5555-555555555555";

const mocks = vi.hoisted(() => ({
  // The membership row the real requireActingTenantMember will read for the
  // acting user. A single row is returned for the tenant_members lookup.
  memberRows: [{ role: "member" }] as Array<Record<string, unknown>>,
  canAccessSpace: vi.fn(),
  resolveThreadSpace: vi.fn(),
  listSavedCanvasesInSpace: vi.fn(),
  getThreadCurrentCanvas: vi.fn(),
  listWritableSpacesForUser: vi.fn(),
}));

// Mock the DB layer only — authz + resolve-auth-user run for real against it.
vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mocks.memberRows),
      }),
    }),
  },
  eq: (...args: unknown[]) => ({ _eq: args }),
  and: (...args: unknown[]) => ({ _and: args }),
  isNull: (...args: unknown[]) => ({ _isNull: args }),
  tenantMembers: {
    tenant_id: "tenant_members.tenant_id",
    principal_id: "tenant_members.principal_id",
    role: "tenant_members.role",
  },
  agentSkills: { agent_id: "agent_skills.agent_id" },
  users: { id: "users.id", cognito_sub: "users.cognito_sub" },
}));

// authz.js imports assignment-state at module load; stub it so the real authz
// module loads without pulling the S3/runtime-config subtree. Its functions are
// never reached on the apikey membership path under test.
vi.mock("../../../lib/skills/assignment-state.js", () => ({
  readSkillAssignmentState: vi.fn(),
  resolveAgentWorkspacePrefix: vi.fn(),
}));

vi.mock("../spaces/shared.js", () => ({
  canAccessSpace: mocks.canAccessSpace,
}));
vi.mock("../../../lib/artifacts/saved-canvas-index.js", () => ({
  resolveThreadSpace: mocks.resolveThreadSpace,
  listSavedCanvasesInSpace: mocks.listSavedCanvasesInSpace,
  getThreadCurrentCanvas: mocks.getThreadCurrentCanvas,
  listWritableSpacesForUser: mocks.listWritableSpacesForUser,
}));

import { threadCanvasContext } from "./threadCanvasContext.query.js";

const savedCanvas = {
  artifactId: "art-cost",
  title: "Cost Dashboard",
  updatedAt: "2026-07-04T00:00:00.000Z",
  headVersion: 2,
  status: "final",
};

function apikeyCtx() {
  return {
    auth: {
      authType: "apikey",
      principalId: ACTING_USER_ID,
      tenantId: TENANT_ID,
      email: null,
      emailVerified: false,
      agentId: null,
    },
  } as never;
}

describe("threadCanvasContext — real requireActingTenantMember (KTD8 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberRows = [{ role: "member" }];
    mocks.resolveThreadSpace.mockResolvedValue({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      spaceName: "Growth",
    });
    mocks.canAccessSpace.mockResolvedValue(true);
    mocks.listSavedCanvasesInSpace.mockResolvedValue([savedCanvas]);
    mocks.getThreadCurrentCanvas.mockResolvedValue(null);
    mocks.listWritableSpacesForUser.mockResolvedValue([
      { spaceId: SPACE_ID, name: "Growth" },
    ]);
  });

  it("succeeds for a service+principal (apikey) caller who is a tenant member", async () => {
    const result = await threadCanvasContext(
      {},
      { threadId: THREAD_ID },
      apikeyCtx(),
    );
    expect(result.spaceId).toBe(SPACE_ID);
    expect(result.savedCanvases).toEqual([savedCanvas]);
    expect(mocks.listWritableSpacesForUser).toHaveBeenCalledWith(
      TENANT_ID,
      ACTING_USER_ID,
    );
  });

  it("rejects the same caller with FORBIDDEN when the acting user has no membership row", async () => {
    mocks.memberRows = [];
    await expect(
      threadCanvasContext({}, { threadId: THREAD_ID }, apikeyCtx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});
