import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// recordAcquiredPage runs for real against the in-memory fake db: only
// drizzle's comparison builders become descriptor objects the fake interprets.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  ...(await import("./test-support/drizzle-condition-mocks.js"))
    .drizzleConditionMocks,
}));
vi.mock("./repository.js", () => ({
  CheckpointConflictError: class CheckpointConflictError extends Error {},
  advanceCheckpoint: vi.fn(async () => ({
    id: "cp-1",
    cursor: {},
    version: 1,
  })),
}));

import {
  buildAcquireRunItemValues,
  computeContentHash,
  evidenceConflictKey,
  recordAcquiredPage,
} from "./evidence.js";
import { makeFakeMemoryDb } from "./test-support/fake-claims-db.js";
import type { EvidenceUpsert } from "./types.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SOURCE_CONFIG_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const RUN_ID = "8a9a4d57-0000-4000-8000-000000000001";

function upsert(overrides: Partial<EvidenceUpsert> = {}): EvidenceUpsert {
  return {
    sourceItemId: "company-1",
    sourceVersion: "v1",
    contentHash: "hash-1",
    normalizedSnapshot: { name: "Acme" },
    extractionRecipe: { recipe: "twenty-company@1" },
    targetScope: "tenant",
    targetId: TENANT_ID,
    ...overrides,
  };
}

describe("computeContentHash", () => {
  it("is a 64-char lowercase sha256 hex digest", () => {
    expect(computeContentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across object key ordering, recursively", () => {
    const a = { b: 1, a: { d: 2, c: [1, { y: 2, x: 3 }] } };
    const b = { a: { c: [1, { x: 3, y: 2 }], d: 2 }, b: 1 };
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });

  it("preserves array order (different order → different hash)", () => {
    expect(computeContentHash([1, 2])).not.toBe(computeContentHash([2, 1]));
  });

  it("distinguishes different values", () => {
    expect(computeContentHash({ a: 1 })).not.toBe(computeContentHash({ a: 2 }));
  });

  it("matches sha256 of the stable JSON encoding for scalars", () => {
    const expected = createHash("sha256").update('"abc"', "utf8").digest("hex");
    expect(computeContentHash("abc")).toBe(expected);
  });

  it("handles null and undefined without throwing", () => {
    expect(computeContentHash(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContentHash(undefined)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContentHash({ a: undefined, b: 1 })).toBe(
      computeContentHash({ b: 1 }),
    );
  });
});

describe("evidenceConflictKey", () => {
  it("keys on sourceItemId + sourceVersion", () => {
    expect(evidenceConflictKey({ sourceItemId: "a", sourceVersion: "1" })).toBe(
      evidenceConflictKey({ sourceItemId: "a", sourceVersion: "1" }),
    );
    expect(
      evidenceConflictKey({ sourceItemId: "a", sourceVersion: "2" }),
    ).not.toBe(evidenceConflictKey({ sourceItemId: "a", sourceVersion: "1" }));
  });
});

describe("buildAcquireRunItemValues (changed-vs-seen partitioning)", () => {
  it("marks freshly inserted versions 'changed' and replayed ones 'seen'", () => {
    const items = [
      upsert({ sourceItemId: "company-1", sourceVersion: "v2" }),
      upsert({ sourceItemId: "company-2", sourceVersion: "v1" }),
    ];
    const changedKeys = new Set([
      evidenceConflictKey({ sourceItemId: "company-1", sourceVersion: "v2" }),
    ]);
    const values = buildAcquireRunItemValues({
      tenantId: TENANT_ID,
      workflowRunId: RUN_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
      items,
      changedKeys,
    });
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({
      tenant_id: TENANT_ID,
      workflow_run_id: RUN_ID,
      source_config_id: SOURCE_CONFIG_ID,
      source_item_id: "company-1",
      stage: "acquire",
      result: "changed",
      detail: { source_version: "v2" },
    });
    expect(values[1]).toMatchObject({
      source_item_id: "company-2",
      stage: "acquire",
      result: "seen",
      detail: { source_version: "v1" },
    });
  });

  it("returns no rows for an empty page", () => {
    expect(
      buildAcquireRunItemValues({
        tenantId: TENANT_ID,
        workflowRunId: RUN_ID,
        sourceConfigId: SOURCE_CONFIG_ID,
        items: [],
        changedKeys: new Set(),
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recordAcquiredPage — superseded editions lose their claim support (U2)
// ---------------------------------------------------------------------------

describe("recordAcquiredPage supersession", () => {
  it("retracts the superseded edition's active support edges in the same transaction", async () => {
    const { db, store, txCount } = makeFakeMemoryDb();
    // Prior edition of company-1 with an active claim-support edge, plus an
    // unrelated evidence item whose edge must stay untouched.
    store.evidenceItems.push({
      id: "ev-1",
      tenant_id: TENANT_ID,
      source_config_id: SOURCE_CONFIG_ID,
      source_item_id: "company-1",
      source_version: "v1",
      lifecycle: "active",
    });
    store.claimEdges.push(
      {
        id: 1,
        tenant_id: TENANT_ID,
        claim_id: "claim-1",
        evidence_item_id: "ev-1",
        source_config_id: SOURCE_CONFIG_ID,
        status: "active",
        retracted_at: null,
      },
      {
        id: 2,
        tenant_id: TENANT_ID,
        claim_id: "claim-1",
        evidence_item_id: "ev-other",
        source_config_id: SOURCE_CONFIG_ID,
        status: "active",
        retracted_at: null,
      },
    );

    const result = await recordAcquiredPage(db, {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
      workflowRunId: RUN_ID,
      partitionKey: "companies",
      expectedCheckpointVersion: 0,
      nextCursor: {},
      items: [upsert({ sourceItemId: "company-1", sourceVersion: "v2" })],
    });

    expect(result.changed).toHaveLength(1);
    expect(result.seen).toBe(0);
    // The old edition is superseded and its support edge retracted…
    const oldEvidence = store.evidenceItems.find((row) => row.id === "ev-1")!;
    expect(oldEvidence.lifecycle).toBe("superseded");
    const oldEdge = store.claimEdges.find((edge) => edge.id === 1)!;
    expect(oldEdge.status).toBe("retracted");
    expect(oldEdge.retracted_at).toBeInstanceOf(Date);
    // …edges from OTHER evidence items are untouched…
    expect(store.claimEdges.find((edge) => edge.id === 2)!.status).toBe(
      "active",
    );
    // …the new edition is active, and everything happened in ONE transaction.
    const newEvidence = store.evidenceItems.find(
      (row) => row.source_version === "v2",
    )!;
    expect(newEvidence.lifecycle).toBe("active");
    expect(txCount()).toBe(1);
  });

  it("a replayed (seen) page supersedes nothing and retracts nothing", async () => {
    const { db, store } = makeFakeMemoryDb();
    store.evidenceItems.push({
      id: "ev-1",
      tenant_id: TENANT_ID,
      source_config_id: SOURCE_CONFIG_ID,
      source_item_id: "company-1",
      source_version: "v1",
      lifecycle: "active",
    });
    store.claimEdges.push({
      id: 1,
      tenant_id: TENANT_ID,
      claim_id: "claim-1",
      evidence_item_id: "ev-1",
      source_config_id: SOURCE_CONFIG_ID,
      status: "active",
      retracted_at: null,
    });

    const result = await recordAcquiredPage(db, {
      tenantId: TENANT_ID,
      sourceConfigId: SOURCE_CONFIG_ID,
      workflowRunId: RUN_ID,
      partitionKey: "companies",
      expectedCheckpointVersion: 0,
      nextCursor: {},
      items: [upsert({ sourceItemId: "company-1", sourceVersion: "v1" })],
    });

    expect(result.changed).toHaveLength(0);
    expect(result.seen).toBe(1);
    expect(
      store.evidenceItems.find((row) => row.id === "ev-1")!.lifecycle,
    ).toBe("active");
    expect(store.claimEdges[0]!.status).toBe("active");
  });
});
