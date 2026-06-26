import { describe, expect, it } from "vitest";

import {
  buildCogneeMemoryScope,
  COGNEE_MEMORY_SCOPE_VERSION,
} from "../../src/api/cognee-memory-scope.js";

describe("buildCogneeMemoryScope", () => {
  it("builds a stable user memory scope", () => {
    const scope = buildCogneeMemoryScope({
      tenantId: "Tenant 1",
      kind: "user",
      userId: "User 1",
    });

    expect(scope).toEqual({
      version: COGNEE_MEMORY_SCOPE_VERSION,
      kind: "user",
      tenantId: "Tenant 1",
      ownerId: "User 1",
      sourceKind: "user_memory",
      sourceRef: "User 1",
      datasetName: "thinkwork:memory:v1:tenant:tenant_1:user:user_1",
      nodeSets: [
        "thinkwork_memory",
        "thinkwork_memory_v1",
        "thinkwork_user_memory",
        "tenant_tenant_1",
        "user_user_1",
      ],
      metadata: {
        memory_scope_version: "v1",
        memory_scope_kind: "user",
        tenant_id: "Tenant 1",
        owner_id: "User 1",
      },
    });
  });

  it("builds a separate stable space memory scope", () => {
    const scope = buildCogneeMemoryScope({
      tenantId: "Tenant 1",
      kind: "space",
      spaceId: "Space 1",
    });

    expect(scope).toEqual(
      expect.objectContaining({
        kind: "space",
        ownerId: "Space 1",
        sourceKind: "space_memory",
        sourceRef: "Space 1",
        datasetName: "thinkwork:memory:v1:tenant:tenant_1:space:space_1",
        nodeSets: [
          "thinkwork_memory",
          "thinkwork_memory_v1",
          "thinkwork_space_memory",
          "tenant_tenant_1",
          "space_space_1",
        ],
      }),
    );
  });

  it("rejects missing owner ids instead of collapsing memory scopes", () => {
    expect(() =>
      buildCogneeMemoryScope({
        tenantId: "tenant-1",
        kind: "space",
        spaceId: "   ",
      }),
    ).toThrow("Cognee memory scope requires a non-empty spaceId");
  });
});
