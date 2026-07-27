/**
 * Stewardship resolver tests (THINK-321 U8): every verb is tenant-admin
 * gated through `resolveTenantId` — a rejected caller never reaches the lib
 * — and the write-asymmetry invariant holds: none of these resolvers touch
 * routing-auth's turn-bound service path.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveTenantIdMock, resolveCallerUserIdMock, libMocks } = vi.hoisted(
  () => ({
    resolveTenantIdMock: vi.fn(),
    resolveCallerUserIdMock: vi.fn(),
    libMocks: {
      author: vi.fn(),
      revoke: vi.fn(),
      split: vi.fn(),
      preview: vi.fn(),
    },
  }),
);

vi.mock("./canonicalEntities.query.js", () => ({
  resolveTenantId: resolveTenantIdMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: resolveCallerUserIdMock,
}));
vi.mock("../../../lib/entity-identity/routing.js", () => ({
  authorEntitySourceMapping: libMocks.author,
  revokeEntitySourceMapping: libMocks.revoke,
}));
vi.mock("../../../lib/entity-identity/split.js", () => ({
  previewCanonicalEntitySplit: libMocks.preview,
  splitCanonicalEntity: libMocks.split,
}));
vi.mock("../../../lib/db.js", () => ({ db: { tag: "shared-db" } }));

import {
  authorEntitySourceMapping,
  canonicalEntitySplitPreview,
  revokeEntitySourceMapping,
  splitCanonicalEntity,
} from "./stewardship.mutation.js";

const ctx = { db: { tag: "ctx-db" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  resolveTenantIdMock.mockResolvedValue("tenant-1");
  resolveCallerUserIdMock.mockResolvedValue("user-op");
});

describe("operator gate", () => {
  it("rejects non-operator callers before any lib call, for every verb", async () => {
    resolveTenantIdMock.mockRejectedValue(
      new Error("Tenant admin role required"),
    );
    await expect(
      authorEntitySourceMapping(
        null,
        {
          canonicalEntityId: "c-1",
          sourceSystem: "lastmile",
          externalId: "x-1",
        },
        ctx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    await expect(
      revokeEntitySourceMapping(null, { mappingId: "m-1" }, ctx),
    ).rejects.toThrow("Tenant admin role required");
    await expect(
      canonicalEntitySplitPreview(
        null,
        { canonicalEntityId: "c-1", assignments: [] },
        ctx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    await expect(
      splitCanonicalEntity(
        null,
        {
          canonicalEntityId: "c-1",
          assignments: [],
          newEntityDisplayName: "B",
          confirmImpact: {
            mappingCountA: 1,
            mappingCountB: 1,
            claimCountFollowingB: 0,
            claimCountRemainingA: 0,
            memoryClaimCount: 0,
            graphEntityCount: 0,
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    for (const mock of Object.values(libMocks)) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("never routes through the turn-bound service path (write-asymmetry)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      resolve(here, "stewardship.mutation.ts"),
      "utf8",
    );
    expect(source).not.toContain('from "./routing-auth.js"');
    expect(source).toContain("resolveTenantId");
  });
});

describe("authorEntitySourceMapping", () => {
  it("delegates with server-derived operator attribution and maps the created result", async () => {
    libMocks.author.mockResolvedValue({
      status: "created",
      mapping: {
        id: "map-1",
        canonicalEntityId: "c-1",
        sourceSystem: "lastmile",
        namespace: "",
        externalId: "cust-42",
        visibility: "tenant",
        createdBy: "operator",
      },
    });
    const result = await authorEntitySourceMapping(
      null,
      {
        tenantId: "tenant-1",
        canonicalEntityId: "c-1",
        sourceSystem: "lastmile",
        externalId: "cust-42",
      },
      ctx,
    );
    expect(libMocks.author).toHaveBeenCalledWith(
      (ctx as { db: unknown }).db,
      expect.objectContaining({
        tenantId: "tenant-1",
        canonicalEntityId: "c-1",
        actorUserId: "user-op",
      }),
    );
    expect(result).toMatchObject({
      status: "created",
      mapping: expect.objectContaining({
        id: "map-1",
        createdBy: "operator",
        createdByUserId: "user-op",
      }),
    });
  });

  it("maps already_linked and refused results without throwing", async () => {
    libMocks.author.mockResolvedValue({
      status: "already_linked",
      existingMappingId: "map-x",
      existingCanonicalEntityId: "c-x",
    });
    expect(
      await authorEntitySourceMapping(
        null,
        { canonicalEntityId: "c-1", sourceSystem: "s", externalId: "e" },
        ctx,
      ),
    ).toMatchObject({
      status: "already_linked",
      existingMappingId: "map-x",
      existingCanonicalEntityId: "c-x",
    });

    libMocks.author.mockResolvedValue({
      status: "refused",
      reason: "entity_not_found",
    });
    expect(
      await authorEntitySourceMapping(
        null,
        { canonicalEntityId: "c-gone", sourceSystem: "s", externalId: "e" },
        ctx,
      ),
    ).toMatchObject({ status: "refused", reason: "entity_not_found" });
  });
});

describe("revokeEntitySourceMapping", () => {
  it("delegates as an operator actor and maps the revoked result", async () => {
    libMocks.revoke.mockResolvedValue({
      status: "revoked",
      canonicalEntityId: "c-1",
      sourceSystem: "twenty",
      namespace: "",
      externalId: "tw-1",
    });
    const result = await revokeEntitySourceMapping(
      null,
      { mappingId: "map-1", reason: " wrong company " },
      ctx,
    );
    expect(libMocks.revoke).toHaveBeenCalledWith(
      (ctx as { db: unknown }).db,
      expect.objectContaining({
        mappingId: "map-1",
        actor: { createdBy: "operator", userId: "user-op" },
        reason: "wrong company",
      }),
    );
    expect(result).toMatchObject({ status: "revoked", sourceSystem: "twenty" });
  });
});

describe("splitCanonicalEntity", () => {
  it("passes the echoed impact through, wiki-free (U5)", async () => {
    libMocks.split.mockResolvedValue({
      entityAId: "c-1",
      entityBId: "c-new",
      impact: {},
    });
    await splitCanonicalEntity(
      null,
      {
        canonicalEntityId: "c-1",
        assignments: [
          { mappingId: "m-1", half: "a" },
          { mappingId: "m-2", half: "b" },
        ],
        newEntityDisplayName: "Acme East",
        confirmImpact: {
          mappingCountA: 1,
          mappingCountB: 1,
          claimCountFollowingB: 2,
          claimCountRemainingA: 3,
          memoryClaimCount: 4,
          graphEntityCount: 5,
        },
      },
      ctx,
    );
    expect(libMocks.split).toHaveBeenCalledWith(
      { tag: "shared-db" },
      expect.objectContaining({
        tenantId: "tenant-1",
        actorUserId: "user-op",
        newEntityDisplayName: "Acme East",
        assignments: [
          { mappingId: "m-1", half: "a" },
          { mappingId: "m-2", half: "b" },
        ],
        // The preview used to carry a `wikiPageId` the resolver defaulted to
        // null; that field is gone with the wiki surface (U5). What survives
        // is the count set, echoed through verbatim.
        confirmImpact: {
          mappingCountA: 1,
          mappingCountB: 1,
          claimCountFollowingB: 2,
          claimCountRemainingA: 3,
          memoryClaimCount: 4,
          graphEntityCount: 5,
        },
      }),
    );
  });
});
