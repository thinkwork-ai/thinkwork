import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const SPACE_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";

const mocks = vi.hoisted(() => ({
  resolveCallerFromAuth: vi.fn(),
  requireTenantMember: vi.fn(),
  canAccessSpace: vi.fn(),
  resolveThreadSpace: vi.fn(),
  listSavedCanvasesInSpace: vi.fn(),
  getThreadCurrentCanvas: vi.fn(),
  listWritableSpacesForUser: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mocks.requireTenantMember,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
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

function ctxFor(auth: Record<string, unknown>) {
  return { auth } as never;
}

describe("threadCanvasContext (U9 / KTD8 identity seam)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTenantMember.mockResolvedValue(undefined);
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

  it("honors an apikey (service-secret + x-principal-id) caller as the acting user", async () => {
    // The runtime asserts the acting user via x-principal-id → apikey auth.
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: USER_ID,
      tenantId: TENANT_ID,
    });
    const result = await threadCanvasContext(
      {},
      { threadId: THREAD_ID },
      ctxFor({ authType: "apikey", principalId: USER_ID, tenantId: TENANT_ID }),
    );
    expect(result.savedCanvases).toEqual([savedCanvas]);
    expect(result.spaceId).toBe(SPACE_ID);
    // Membership resolution + space access were gated against the acting user.
    expect(mocks.canAccessSpace).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      SPACE_ID,
    );
    expect(mocks.listWritableSpacesForUser).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
    );
  });

  it("rejects a bare service caller with no acting user (no ghost-write as the service principal)", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: null,
      tenantId: TENANT_ID,
    });
    await expect(
      threadCanvasContext(
        {},
        { threadId: THREAD_ID },
        ctxFor({ authType: "service", principalId: null, tenantId: TENANT_ID }),
      ),
    ).rejects.toThrow(/Requester user identity required/);
    expect(mocks.listSavedCanvasesInSpace).not.toHaveBeenCalled();
  });

  it("hides saved canvases when the acting user cannot access the thread's space", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: USER_ID,
      tenantId: TENANT_ID,
    });
    mocks.canAccessSpace.mockResolvedValue(false);
    mocks.getThreadCurrentCanvas.mockResolvedValue({
      artifactId: "art-draft",
      title: "",
      updatedAt: null,
      headVersion: 0,
      status: "draft",
    });
    const result = await threadCanvasContext(
      {},
      { threadId: THREAD_ID },
      ctxFor({ authType: "apikey", principalId: USER_ID, tenantId: TENANT_ID }),
    );
    expect(result.savedCanvases).toEqual([]);
    // The current draft canvas is still returned so save_canvas can target it.
    expect(result.currentCanvas?.artifactId).toBe("art-draft");
  });

  it("rejects a caller whose tenant differs from the thread's tenant", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: USER_ID,
      tenantId: "other-tenant",
    });
    await expect(
      threadCanvasContext(
        {},
        { threadId: THREAD_ID },
        ctxFor({ authType: "apikey", principalId: USER_ID }),
      ),
    ).rejects.toThrow(/different tenant/);
  });
});
