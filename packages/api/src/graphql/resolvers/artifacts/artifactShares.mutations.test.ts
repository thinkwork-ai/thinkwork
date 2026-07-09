/**
 * THINK-208 U3 test scenarios: mint (get-or-create, authz, document-only),
 * revoke (creator-own / operator-any), share queries (attribution, operator
 * gate), and the no-token-in-query-responses invariant.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_TENANT_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_USER_ID = "66666666-6666-6666-6666-666666666666";
const ARTIFACT_ID = "77777777-7777-7777-7777-777777777777";
const SHARE_ID = "88888888-8888-8888-8888-888888888888";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  insertCalls: [] as Array<Record<string, unknown>>,
  insertResults: [] as Array<Array<Record<string, unknown>>>,
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
  updateResults: [] as Array<Array<Record<string, unknown>>>,
  auditEvents: [] as Array<Record<string, unknown>>,
  resolveCallerFromAuth: vi.fn(),
  requireTenantMember: vi.fn(),
  requireTenantAdmin: vi.fn(),
  isTenantOperator: vi.fn(),
  assertCanvasAccess: vi.fn(),
}));

vi.mock("../../utils.js", () => {
  const selectChain = () => {
    const exec = () => Promise.resolve(mocks.selectQueue.shift() ?? []);
    const chain: Record<string, unknown> = {};
    for (const m of [
      "from",
      "where",
      "leftJoin",
      "innerJoin",
      "orderBy",
      "limit",
    ]) {
      chain[m] = (..._a: unknown[]) => chain;
    }
    chain.then = (
      res: (v: unknown) => unknown,
      rej?: (e: unknown) => unknown,
    ) => exec().then(res, rej);
    return chain;
  };
  return {
    and: (...conditions: unknown[]) => ({ and: conditions }),
    eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
    isNull: (field: unknown) => ({ isNull: field }),
    desc: (field: unknown) => ({ desc: field }),
    artifacts: {
      id: { name: "artifacts.id" },
      tenant_id: { name: "artifacts.tenant_id" },
      title: { name: "artifacts.title" },
    },
    artifactDataBindings: {
      id: { name: "artifact_data_bindings.id" },
      artifact_id: { name: "artifact_data_bindings.artifact_id" },
      tool_name: { name: "artifact_data_bindings.tool_name" },
    },
    artifactShares: {
      id: { name: "artifact_shares.id" },
      tenant_id: { name: "artifact_shares.tenant_id" },
      artifact_id: { name: "artifact_shares.artifact_id" },
      created_by: { name: "artifact_shares.created_by" },
      created_at: { name: "artifact_shares.created_at" },
      revoked_at: { name: "artifact_shares.revoked_at" },
    },
    users: {
      id: { name: "users.id" },
      name: { name: "users.name" },
    },
    db: {
      select: () => selectChain(),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          mocks.insertCalls.push(values);
          return {
            onConflictDoNothing: () => ({
              returning: () =>
                Promise.resolve(mocks.insertResults.shift() ?? []),
            }),
          };
        },
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => {
          mocks.updateCalls.push({ set });
          return {
            where: () => ({
              returning: () =>
                Promise.resolve(mocks.updateResults.shift() ?? []),
            }),
          };
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        // The tx exposes the same mocked surface as db.
        const self: Record<string, unknown> = {};
        const mod = {
          insert: () => ({
            values: (values: Record<string, unknown>) => {
              mocks.insertCalls.push(values);
              return {
                onConflictDoNothing: () => ({
                  returning: () =>
                    Promise.resolve(mocks.insertResults.shift() ?? []),
                }),
              };
            },
          }),
          update: () => ({
            set: (set: Record<string, unknown>) => {
              mocks.updateCalls.push({ set });
              return {
                where: () => ({
                  returning: () =>
                    Promise.resolve(mocks.updateResults.shift() ?? []),
                }),
              };
            },
          }),
        };
        Object.assign(self, mod);
        return fn(self);
      },
    },
  };
});

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mocks.requireTenantMember,
  requireTenantAdmin: mocks.requireTenantAdmin,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));
vi.mock("../skill-creator/shared.js", () => ({
  isTenantOperator: mocks.isTenantOperator,
}));
vi.mock("../../../lib/artifacts/canvas-access.js", () => ({
  assertCanvasAccess: mocks.assertCanvasAccess,
}));
vi.mock("../../../lib/artifacts/document-emission.js", () => ({
  isDocumentMetadata: (metadata: unknown) =>
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as { kind?: unknown }).kind === "document",
}));
vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: vi.fn(
    async (_tx: unknown, input: Record<string, unknown>) => {
      mocks.auditEvents.push(input);
      return { eventId: "test-event" };
    },
  ),
}));
vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) =>
    key === "THINKWORK_API_URL" ? "https://api.dev.example.com" : undefined,
  getApiAuthSecret: () => "test-share-secret",
}));

import { mintArtifactShareLink } from "./mintArtifactShareLink.mutation.js";
import { revokeArtifactShareLink } from "./revokeArtifactShareLink.mutation.js";
import {
  artifactShares_,
  tenantArtifactShares,
} from "./artifactShares.query.js";
import { signShareToken } from "../../../lib/artifacts/share-tokens.js";

const ctx = { auth: { authType: "cognito" } } as never;

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIFACT_ID,
    tenant_id: TENANT_ID,
    title: "Q2 Review",
    metadata: { kind: "document" },
    ...overrides,
  };
}

function canvasRow() {
  return documentRow({ metadata: { kind: "json_render_canvas" } });
}

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_ID,
    tenant_id: TENANT_ID,
    artifact_id: ARTIFACT_ID,
    created_by: USER_ID,
    created_at: new Date("2026-07-06T00:00:00Z"),
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.selectQueue.length = 0;
  mocks.insertCalls.length = 0;
  mocks.insertResults.length = 0;
  mocks.updateCalls.length = 0;
  mocks.updateResults.length = 0;
  mocks.auditEvents.length = 0;
  vi.clearAllMocks();
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
  mocks.requireTenantMember.mockResolvedValue(undefined);
  mocks.requireTenantAdmin.mockResolvedValue(undefined);
  mocks.assertCanvasAccess.mockResolvedValue(undefined);
  mocks.isTenantOperator.mockResolvedValue(false);
});

describe("mintArtifactShareLink", () => {
  it("mints on an own-tenant document: row created, URL returned, audit emitted (F1)", async () => {
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([]); // no existing active share
    mocks.insertResults.push([shareRow()]);

    const result = (await mintArtifactShareLink(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    )) as { url: string; share: { id: string; artifactTitle: string } };

    expect(mocks.insertCalls).toHaveLength(1);
    expect(result.url).toBe(
      `https://api.dev.example.com/share/${signShareToken(SHARE_ID)}`,
    );
    expect(result.share.id).toBe(SHARE_ID);
    expect(result.share.artifactTitle).toBe("Q2 Review");
    expect(mocks.auditEvents).toHaveLength(1);
    expect(mocks.auditEvents[0].eventType).toBe(
      "output.artifact_share_created",
    );
    expect(mocks.auditEvents[0].actorId).toBe(USER_ID);
  });

  it("re-mint returns the existing active share without a new row or audit event (R4)", async () => {
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([shareRow()]); // existing active share

    const result = (await mintArtifactShareLink(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    )) as { url: string; share: { id: string } };

    expect(mocks.insertCalls).toHaveLength(0);
    expect(mocks.auditEvents).toHaveLength(0);
    expect(result.share.id).toBe(SHARE_ID);
    expect(result.url).toContain(signShareToken(SHARE_ID));
  });

  it("a different member with access re-shares and gets the same active link (R4)", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: OTHER_USER_ID,
      tenantId: TENANT_ID,
    });
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([shareRow()]); // created by USER_ID

    const result = (await mintArtifactShareLink(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    )) as { share: { createdBy: string } };

    expect(mocks.insertCalls).toHaveLength(0);
    expect(result.share.createdBy).toBe(USER_ID);
  });

  it("rejects a canvas artifact (document-only)", async () => {
    mocks.selectQueue.push([canvasRow()]);
    await expect(
      mintArtifactShareLink(undefined, { artifactId: ARTIFACT_ID }, ctx),
    ).rejects.toThrow(/document artifacts/i);
    expect(mocks.insertCalls).toHaveLength(0);
  });

  it("THINK-234: mints for an artifact with a query binding (KTD9 gate lifted — refresh is RLS tenant-scoped)", async () => {
    mocks.selectQueue.length = 0;
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([]); // no active share at check time
    mocks.insertResults.push([shareRow()]);
    const result = (await mintArtifactShareLink(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    )) as { share: { id: string } };
    expect(result.share.id).toBe(SHARE_ID);
    expect(mocks.insertCalls).toHaveLength(1);
  });

  it("rejects a caller outside the tenant, no row", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: USER_ID,
      tenantId: OTHER_TENANT_ID,
    });
    mocks.selectQueue.push([documentRow()]);
    await expect(
      mintArtifactShareLink(undefined, { artifactId: ARTIFACT_ID }, ctx),
    ).rejects.toThrow(/different tenant/i);
    expect(mocks.insertCalls).toHaveLength(0);
  });

  it("denies a member who fails the document's read gate, no row", async () => {
    mocks.assertCanvasAccess.mockRejectedValue(new Error("no access"));
    mocks.selectQueue.push([documentRow()]);
    await expect(
      mintArtifactShareLink(undefined, { artifactId: ARTIFACT_ID }, ctx),
    ).rejects.toThrow(/no access/);
    expect(mocks.insertCalls).toHaveLength(0);
  });

  it("losing the create race falls back to the winner's row", async () => {
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([]); // no active share at check time
    mocks.insertResults.push([]); // conflict — another minter won
    mocks.selectQueue.push([shareRow({ created_by: OTHER_USER_ID })]);

    const result = (await mintArtifactShareLink(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    )) as { share: { id: string } };
    expect(result.share.id).toBe(SHARE_ID);
    expect(mocks.auditEvents).toHaveLength(0); // insert didn't land, no event
  });
});

describe("revokeArtifactShareLink", () => {
  it("creator revokes own share: revoked_at set + audit event (AE4)", async () => {
    mocks.selectQueue.push([shareRow()]);
    mocks.updateResults.push([shareRow({ revoked_at: new Date() })]);

    const result = await revokeArtifactShareLink(
      undefined,
      { shareId: SHARE_ID },
      ctx,
    );
    expect(result).toBe(true);
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0].set.revoked_at).toBeInstanceOf(Date);
    expect(mocks.updateCalls[0].set.revoked_by).toBe(USER_ID);
    expect(mocks.auditEvents).toHaveLength(1);
    expect(mocks.auditEvents[0].eventType).toBe(
      "output.artifact_share_revoked",
    );
  });

  it("non-creator member is denied (AE4)", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: OTHER_USER_ID,
      tenantId: TENANT_ID,
    });
    mocks.isTenantOperator.mockResolvedValue(false);
    mocks.selectQueue.push([shareRow()]); // created by USER_ID

    await expect(
      revokeArtifactShareLink(undefined, { shareId: SHARE_ID }, ctx),
    ).rejects.toThrow(/creator or an operator/i);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("operator revokes another member's share (AE4)", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: OTHER_USER_ID,
      tenantId: TENANT_ID,
    });
    mocks.isTenantOperator.mockResolvedValue(true);
    mocks.selectQueue.push([shareRow()]);
    mocks.updateResults.push([shareRow({ revoked_at: new Date() })]);

    const result = await revokeArtifactShareLink(
      undefined,
      { shareId: SHARE_ID },
      ctx,
    );
    expect(result).toBe(true);
    expect(mocks.auditEvents).toHaveLength(1);
  });

  it("an already-revoked share 404s", async () => {
    mocks.selectQueue.push([shareRow({ revoked_at: new Date() })]);
    await expect(
      revokeArtifactShareLink(undefined, { shareId: SHARE_ID }, ctx),
    ).rejects.toThrow(/not found/i);
  });
});

describe("re-mint after revoke", () => {
  it("creates a fresh row with a different id (old token no longer valid)", async () => {
    const NEW_SHARE_ID = "99999999-9999-9999-9999-999999999999";
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([]); // active-share check misses (old row revoked)
    mocks.insertResults.push([shareRow({ id: NEW_SHARE_ID })]);

    const result = (await mintArtifactShareLink(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    )) as { url: string; share: { id: string } };
    expect(result.share.id).toBe(NEW_SHARE_ID);
    expect(result.url).toContain(signShareToken(NEW_SHARE_ID));
    expect(result.url).not.toContain(signShareToken(SHARE_ID));
  });
});

describe("artifactShares query", () => {
  it("returns the active share with creator attribution to a non-creator member", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: OTHER_USER_ID,
      tenantId: TENANT_ID,
    });
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([{ share: shareRow(), creatorName: "Alice" }]);

    const result = (await artifactShares_(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    )) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(1);
    expect(result[0].createdBy).toBe(USER_ID);
    expect(result[0].createdByName).toBe("Alice");
    expect(result[0].artifactTitle).toBe("Q2 Review");
  });

  it("is denied to a member without document access", async () => {
    mocks.assertCanvasAccess.mockRejectedValue(new Error("no access"));
    mocks.selectQueue.push([documentRow()]);
    await expect(
      artifactShares_(undefined, { artifactId: ARTIFACT_ID }, ctx),
    ).rejects.toThrow(/no access/);
  });

  it("never exposes a signed token in the response", async () => {
    mocks.selectQueue.push([documentRow()]);
    mocks.selectQueue.push([{ share: shareRow(), creatorName: "Alice" }]);
    const result = await artifactShares_(
      undefined,
      { artifactId: ARTIFACT_ID },
      ctx,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(signShareToken(SHARE_ID));
    expect(serialized).not.toContain("/share/");
  });
});

describe("tenantArtifactShares query", () => {
  it("is denied for a non-operator", async () => {
    mocks.requireTenantAdmin.mockRejectedValue(new Error("forbidden"));
    await expect(
      tenantArtifactShares(undefined, { tenantId: TENANT_ID }, ctx),
    ).rejects.toThrow(/forbidden/);
  });

  it("returns all active shares for an operator, no tokens", async () => {
    mocks.selectQueue.push([
      { share: shareRow(), artifactTitle: "Q2 Review", creatorName: "Alice" },
      {
        share: shareRow({
          id: "99999999-9999-9999-9999-999999999999",
          created_by: OTHER_USER_ID,
        }),
        artifactTitle: "Board Brief",
        creatorName: "Bob",
      },
    ]);
    const result = (await tenantArtifactShares(
      undefined,
      { tenantId: TENANT_ID },
      ctx,
    )) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[1].artifactTitle).toBe("Board Brief");
    expect(result[1].createdByName).toBe("Bob");
    expect(JSON.stringify(result)).not.toContain("/share/");
  });
});
