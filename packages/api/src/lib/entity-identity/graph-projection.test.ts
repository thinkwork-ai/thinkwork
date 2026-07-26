import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// uploadIdentitySnapshot resolves the bucket from env at call time.
const previousBucket = process.env.BRAIN_ARTIFACTS_BUCKET;
beforeAll(() => {
  process.env.BRAIN_ARTIFACTS_BUCKET = "test-brain-artifacts";
});
afterAll(() => {
  if (previousBucket === undefined) {
    delete process.env.BRAIN_ARTIFACTS_BUCKET;
  } else {
    process.env.BRAIN_ARTIFACTS_BUCKET = previousBucket;
  }
});
import { identityGraphProjectionCursors } from "@thinkwork/database-pg/schema";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import {
  buildCanonicalResyncOps,
  buildIdentitySnapshot,
  clearTenantSubgraph,
  entityNodeId,
  projectPendingIdentityEvents,
  readSingleCount,
  systemEdgeId,
  systemNodeId,
  type GraphOp,
  type NeptuneQueryClient,
} from "./graph-projection.js";

class FakeNeptune implements NeptuneQueryClient {
  ops: GraphOp[] = [];
  async execute(query: string, parameters: Record<string, unknown>) {
    this.ops.push({ query, parameters });
    return { results: [] };
  }
}

const activeCanonical = {
  id: "can-777",
  entity_type_slug: "customer",
  display_name: "777 Automotive",
  status: "active",
  merged_into_id: null,
};

describe("buildCanonicalResyncOps", () => {
  it("upserts the entity node, system nodes and external_identity edges", () => {
    const ops = buildCanonicalResyncOps({
      tenantId: "tenant-1",
      canonical: activeCanonical,
      mappings: [
        {
          source_system: "twenty",
          namespace: "",
          external_id: "cmp_889",
          visibility: "tenant",
        },
        {
          source_system: "lastmile",
          namespace: "",
          external_id: "77-4432",
          visibility: "tenant",
        },
      ],
    });

    const nodeOp = ops[0];
    expect(nodeOp.query).toContain("MERGE (n:customer");
    expect(nodeOp.parameters.nodeId).toBe(entityNodeId("tenant-1", "can-777"));
    expect(nodeOp.parameters.displayName).toBe("777 Automotive");

    const edgeOps = ops.filter((op) =>
      op.query.includes("external_identity {"),
    );
    expect(edgeOps).toHaveLength(2);
    expect(edgeOps[0].parameters.sysId).toBe(
      systemNodeId("tenant-1", "twenty"),
    );
    expect(edgeOps[0].parameters.externalId).toBe("cmp_889");
    // The external id travels as a PARAMETER, never in query text.
    expect(edgeOps[0].query).not.toContain("cmp_889");

    const convergence = ops[ops.length - 1];
    expect(convergence.query).toContain("NOT r.`~id` IN $keepIds");
    expect(convergence.parameters.keepIds).toEqual([
      systemEdgeId("tenant-1", "can-777", "twenty", ""),
      systemEdgeId("tenant-1", "can-777", "lastmile", ""),
    ]);
  });

  it("excludes private-visibility mappings from the graph", () => {
    const ops = buildCanonicalResyncOps({
      tenantId: "tenant-1",
      canonical: activeCanonical,
      mappings: [
        {
          source_system: "gmail",
          namespace: "user-1",
          external_id: "someone@example.com",
          visibility: "private",
        },
      ],
    });
    expect(ops.some((op) => op.query.includes("external_identity {"))).toBe(
      false,
    );
    const convergence = ops[ops.length - 1];
    expect(convergence.parameters.keepIds).toEqual([]);
  });

  it("deletes a merged loser from the graph entirely (KTD-4)", () => {
    const ops = buildCanonicalResyncOps({
      tenantId: "tenant-1",
      canonical: {
        ...activeCanonical,
        id: "can-loser",
        status: "merged",
        merged_into_id: "can-777",
      },
      mappings: [],
    });
    // One op: DETACH DELETE by ~id. Lineage stays relational
    // (merged_into_id); the graph carries only surviving entities. MATCH,
    // not MERGE, so an already-absent loser is a no-op instead of a
    // mint-then-delete.
    expect(ops).toHaveLength(1);
    expect(ops[0].query).toContain("MATCH (n {`~id`: $nodeId})");
    expect(ops[0].query).toContain("DETACH DELETE n");
    expect(ops[0].parameters.nodeId).toBe(
      entityNodeId("tenant-1", "can-loser"),
    );
    // No node upsert, no alias edge, no external_identity re-creation.
    expect(ops.some((op) => op.query.includes("MERGE"))).toBe(false);
  });

  it("falls back to the generic label for a malformed type slug", () => {
    const ops = buildCanonicalResyncOps({
      tenantId: "tenant-1",
      canonical: { ...activeCanonical, entity_type_slug: "bad) DELETE (n" },
      mappings: [],
    });
    expect(ops[0].query).toContain("MERGE (n:Entity");
  });

  it("is deterministic — identical inputs produce identical ops (replay)", () => {
    const build = () =>
      buildCanonicalResyncOps({
        tenantId: "tenant-1",
        canonical: activeCanonical,
        mappings: [
          {
            source_system: "twenty",
            namespace: "",
            external_id: "cmp_889",
            visibility: "tenant",
          },
        ],
      });
    expect(build()).toEqual(build());
  });
});

describe("projectPendingIdentityEvents", () => {
  it("resyncs affected canonicals, advances the cursor, uploads the snapshot", async () => {
    const fake = createFakeIdentityDb();
    const neptune = new FakeNeptune();
    const s3Send = vi.fn().mockResolvedValue({});
    const createdAt = new Date("2026-07-21T10:00:00Z");

    fake.selectQueue.push(
      [], // cursor row (none — first run)
      [
        {
          id: "evt-1",
          event_type: "create",
          canonical_entity_id: "can-777",
          payload: {},
          created_at: createdAt,
        },
        {
          id: "evt-2",
          event_type: "reject",
          canonical_entity_id: "can-ignored",
          payload: {},
          created_at: createdAt,
        },
      ],
      [activeCanonical], // canonical rows for the chunk
      [
        {
          canonical_entity_id: "can-777",
          source_system: "twenty",
          namespace: "",
          external_id: "cmp_889",
          visibility: "tenant",
        },
      ],
      // buildIdentitySnapshot reads:
      [
        {
          source_system: "twenty",
          external_id: "cmp_889",
          canonical_entity_id: "can-777",
          visibility: "tenant",
          entity_type_slug: "customer",
          status: "active",
          merged_into_id: null,
        },
      ],
      [], // redirects
    );

    const result = await projectPendingIdentityEvents({
      tenantId: "tenant-1",
      db: fake.db as never,
      neptune,
      s3: { send: s3Send } as never,
      now: new Date("2026-07-21T10:05:00Z"),
    });

    expect(result.processedEvents).toBe(2);
    // reject touches no graph state; only can-777 resyncs.
    expect(result.resyncedCanonicals).toBe(1);
    expect(result.cursor).toBe("2026-07-21T10:00:00.000Z#evt-2");
    expect(result.snapshotUploaded).toBe(true);
    expect(result.drained).toBe(true);

    expect(neptune.ops.length).toBeGreaterThan(0);
    expect(neptune.ops[0].parameters.nodeId).toBe(
      entityNodeId("tenant-1", "can-777"),
    );

    const snapshotPut = s3Send.mock.calls[0][0];
    expect(snapshotPut.input.Key).toBe("twin-identity/tenant-1/latest.json");
    const body = JSON.parse(snapshotPut.input.Body as string);
    expect(body.format).toBe("identity-mapping-snapshot/v1");
    expect(body.mappings).toEqual([
      {
        sourceSystem: "twenty",
        externalId: "cmp_889",
        canonicalEntityId: "can-777",
        entityTypeSlug: "customer",
      },
    ]);

    const cursorWrite = fake.inserts.find(
      (write) => write.table === identityGraphProjectionCursors,
    );
    expect(cursorWrite).toBeDefined();
    expect(cursorWrite!.values.last_event_id).toBe("evt-2");
  });

  it("merge events resync both survivor and loser (payload.loserId)", async () => {
    const fake = createFakeIdentityDb();
    const neptune = new FakeNeptune();
    const createdAt = new Date("2026-07-21T11:00:00Z");

    fake.selectQueue.push(
      [],
      [
        {
          id: "evt-3",
          event_type: "merge",
          canonical_entity_id: "can-777",
          payload: { loserId: "can-loser" },
          created_at: createdAt,
        },
      ],
      [
        activeCanonical,
        {
          id: "can-loser",
          entity_type_slug: "customer",
          display_name: "Old 777",
          status: "merged",
          merged_into_id: "can-777",
        },
      ],
      [], // mappings for chunk (none)
      [], // snapshot mappings
      [
        { id: "can-loser", merged_into_id: "can-777" }, // redirects
      ],
    );
    const s3Send = vi.fn().mockResolvedValue({});

    const result = await projectPendingIdentityEvents({
      tenantId: "tenant-1",
      db: fake.db as never,
      neptune,
      s3: { send: s3Send } as never,
    });

    expect(result.resyncedCanonicals).toBe(2);
    const deleteOp = neptune.ops.find((op) =>
      op.query.includes("DETACH DELETE"),
    );
    expect(deleteOp).toBeDefined();
    expect(deleteOp!.parameters.nodeId).toBe(
      entityNodeId("tenant-1", "can-loser"),
    );
    const body = JSON.parse(s3Send.mock.calls[0][0].input.Body as string);
    expect(body.redirects).toEqual([
      { fromCanonicalEntityId: "can-loser", toCanonicalEntityId: "can-777" },
    ]);
  });

  it("no events → no writes, drained", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([], []);
    const neptune = new FakeNeptune();
    const s3Send = vi.fn();

    const result = await projectPendingIdentityEvents({
      tenantId: "tenant-1",
      db: fake.db as never,
      neptune,
      s3: { send: s3Send } as never,
    });
    expect(result.processedEvents).toBe(0);
    expect(result.drained).toBe(true);
    expect(neptune.ops).toEqual([]);
    expect(s3Send).not.toHaveBeenCalled();
    expect(fake.inserts).toEqual([]);
  });
});

describe("buildIdentitySnapshot", () => {
  it("excludes private mappings and archived canonicals; carries redirects", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push(
      [
        {
          source_system: "twenty",
          external_id: "cmp_889",
          canonical_entity_id: "can-777",
          visibility: "tenant",
          entity_type_slug: "customer",
          status: "active",
          merged_into_id: null,
        },
        {
          source_system: "gmail",
          external_id: "x@y.z",
          canonical_entity_id: "can-priv",
          visibility: "private",
          entity_type_slug: "person",
          status: "active",
          merged_into_id: null,
        },
        {
          source_system: "twenty",
          external_id: "cmp_old",
          canonical_entity_id: "can-archived",
          visibility: "tenant",
          entity_type_slug: "customer",
          status: "archived",
          merged_into_id: null,
        },
      ],
      [{ id: "can-loser", merged_into_id: "can-777" }],
    );

    const snapshot = await buildIdentitySnapshot({
      tenantId: "tenant-1",
      cursor: "c1",
      db: fake.db as never,
    });
    expect(snapshot.mappings).toHaveLength(1);
    expect(snapshot.mappings[0].externalId).toBe("cmp_889");
    expect(snapshot.redirects).toEqual([
      { fromCanonicalEntityId: "can-loser", toCanonicalEntityId: "can-777" },
    ]);
  });
});

describe("clearTenantSubgraph", () => {
  it("drops the tenant subgraph in batches, fenced by the ~id prefix", async () => {
    const neptune = new FakeNeptune();

    const result = await clearTenantSubgraph({
      tenantId: "tenant-1",
      neptune,
    });

    expect(result).toEqual({ cleared: true });
    // First op deletes a bounded batch, fenced by the tenant ~id PREFIX so
    // property-less ghost nodes (pre-label-fix survivors) are swept too.
    expect(neptune.ops[0].query).toContain("DETACH DELETE n");
    expect(neptune.ops[0].query).toContain("LIMIT 2000");
    expect(neptune.ops[0].query).toContain("id(n) STARTS WITH $idPrefix");
    expect(neptune.ops[0].parameters).toEqual({ idPrefix: "t#tenant-1#" });
    expect(neptune.ops[1].query).toContain("RETURN count(n)");
  });

  it("stops before the next batch when shouldStop trips (deadline guard)", async () => {
    const neptune = new FakeNeptune();
    const result = await clearTenantSubgraph({
      tenantId: "tenant-1",
      neptune,
      shouldStop: () => true,
    });
    expect(result).toEqual({ cleared: false });
    expect(neptune.ops).toEqual([]);
  });
});

describe("readSingleCount", () => {
  it("reads the count from the openCypher payload, never the SDK envelope", () => {
    expect(
      readSingleCount({
        $metadata: { httpStatusCode: 200 },
        results: [{ c: 0 }],
      }),
    ).toBe(0);
    expect(
      readSingleCount({
        $metadata: { httpStatusCode: 200 },
        results: [{ c: 4213 }],
      }),
    ).toBe(4213);
    // Unreadable shapes are "unknown", not zero — the clear loop must keep
    // going rather than break early on a shape mismatch.
    expect(readSingleCount({ $metadata: { httpStatusCode: 200 } })).toBeNull();
    expect(readSingleCount(undefined)).toBeNull();
  });
});
