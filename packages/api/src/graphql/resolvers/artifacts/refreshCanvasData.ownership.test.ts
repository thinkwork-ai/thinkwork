import { describe, expect, it, vi } from "vitest";

// The test exercises only the pure enrichment helper; shallow-mock the module
// graph so importing the resolver never touches runtime config or a real DB.
vi.mock("../../utils.js", () => ({
  db: {},
  eq: () => ({}),
  artifacts: {},
  artifactDataBindings: {},
}));
vi.mock("../core/authz.js", () => ({
  requireActingTenantMember: async () => undefined,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: async () => null,
}));
vi.mock("../../../lib/artifacts/canvas-access.js", () => ({
  assertCanvasAccess: async () => undefined,
}));

import { enrichRefreshBindings } from "./refreshCanvasData.mutation.js";

const OWNER = "55555555-5555-5555-5555-555555555555";
const OTHER = "66666666-6666-6666-6666-666666666666";

const lambdaBinding = {
  bindingId: "b1",
  partId: "json-render:abc",
  elementId: "",
  outcome: "needs_user",
  quality: "stale",
  reason: "Refresh needs the credential owner (per-user OAuth).",
  serverName: "twenty--crm",
  toolName: "execute_tool",
};

describe("enrichRefreshBindings (THINK-167)", () => {
  it("marks viewerIsOwner true only when caller and owner resolve AND match", () => {
    const owners = new Map([["b1", OWNER]]);
    const [asOwner] = enrichRefreshBindings([lambdaBinding], owners, OWNER);
    expect(asOwner).toMatchObject({
      outcome: "NEEDS_USER",
      quality: "STALE",
      ownerUserId: OWNER,
      viewerIsOwner: true,
    });

    const [asOther] = enrichRefreshBindings([lambdaBinding], owners, OTHER);
    expect(asOther).toMatchObject({ ownerUserId: OWNER, viewerIsOwner: false });

    const [unknownCaller] = enrichRefreshBindings(
      [lambdaBinding],
      owners,
      null,
    );
    expect(unknownCaller.viewerIsOwner).toBe(false);
  });

  it("treats an ownerless (tenant-scoped) or unknown binding as not owned", () => {
    const [noOwner] = enrichRefreshBindings(
      [lambdaBinding],
      new Map([["b1", null]]),
      OWNER,
    );
    expect(noOwner).toMatchObject({ ownerUserId: null, viewerIsOwner: false });

    const [notInMap] = enrichRefreshBindings([lambdaBinding], new Map(), OWNER);
    expect(notInMap).toMatchObject({ ownerUserId: null, viewerIsOwner: false });
  });
});
