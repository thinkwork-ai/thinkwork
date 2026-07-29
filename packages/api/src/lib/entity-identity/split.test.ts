import { describe, expect, it } from "vitest";
import {
  canonicalEntities,
  entityIdentityClaims,
  entityResolutionEvents,
  entitySourceMappings,
  mappingRejections,
} from "@thinkwork/database-pg/schema";
import { createFakeIdentityDb } from "./fake-db.test-helper.js";
import {
  deriveClaimFollowSet,
  splitCanonicalEntity,
  splitImpactMatches,
  validateSplitPartition,
  type SplitImpactPreview,
} from "./split.js";

const TENANT = "tenant-1";

const impact: SplitImpactPreview = {
  mappingCountA: 1,
  mappingCountB: 1,
  claimCountFollowingB: 1,
  claimCountRemainingA: 1,
  memoryClaimCount: 2,
};

describe("splitImpactMatches", () => {
  it("matches identical previews and rejects any drift (stale preview guard)", () => {
    expect(splitImpactMatches(impact, { ...impact })).toBe(true);
    expect(splitImpactMatches(impact, { ...impact, mappingCountB: 2 })).toBe(
      false,
    );
    expect(
      splitImpactMatches(impact, { ...impact, claimCountFollowingB: 0 }),
    ).toBe(false);
    expect(
      splitImpactMatches(impact, { ...impact, memoryClaimCount: 99 }),
    ).toBe(false);
  });
});

describe("validateSplitPartition", () => {
  const mappings = [{ id: "m1" }, { id: "m2" }];

  it("accepts a full partition with both halves populated", () => {
    expect(() =>
      validateSplitPartition(mappings, [
        { mappingId: "m1", half: "a" },
        { mappingId: "m2", half: "b" },
      ]),
    ).not.toThrow();
  });

  it("rejects duplicate assignments", () => {
    expect(() =>
      validateSplitPartition(mappings, [
        { mappingId: "m1", half: "a" },
        { mappingId: "m1", half: "b" },
        { mappingId: "m2", half: "b" },
      ]),
    ).toThrow(/more than once/);
  });

  it("rejects unknown mapping ids", () => {
    expect(() =>
      validateSplitPartition(mappings, [
        { mappingId: "m1", half: "a" },
        { mappingId: "m2", half: "b" },
        { mappingId: "m-ghost", half: "b" },
      ]),
    ).toThrow(/unknown mapping/);
  });

  it("rejects partitions that do not cover every mapping", () => {
    expect(() =>
      validateSplitPartition(mappings, [{ mappingId: "m1", half: "a" }]),
    ).toThrow(/every source mapping/);
  });

  it("rejects moving everything to one half — that is not a split", () => {
    expect(() =>
      validateSplitPartition(mappings, [
        { mappingId: "m1", half: "b" },
        { mappingId: "m2", half: "b" },
      ]),
    ).toThrow(/each half/);
  });
});

describe("deriveClaimFollowSet", () => {
  const mappings = [
    { id: "m1", source_system: "lastmile", namespace: "", external_id: "e1" },
    { id: "m2", source_system: "twenty", namespace: "", external_id: "t1" },
    { id: "m3", source_system: "gmail", namespace: "", external_id: "g1" },
    { id: "m4", source_system: "gmail", namespace: "", external_id: "g2" },
  ];
  const assignments = [
    { mappingId: "m1", half: "a" as const },
    { mappingId: "m2", half: "b" as const },
    { mappingId: "m3", half: "a" as const },
    { mappingId: "m4", half: "b" as const },
  ];

  it("claims follow only source groups whose mappings ALL moved to B", () => {
    const followed = deriveClaimFollowSet(mappings, assignments, [
      { id: "cl-twenty", evidence: { sourceSystem: "twenty" } },
      { id: "cl-lastmile", evidence: { sourceSystem: "lastmile" } },
      // gmail group is split across halves — conservative: stays on A.
      { id: "cl-gmail", evidence: { sourceSystem: "gmail" } },
      // no derivable source — stays on A.
      { id: "cl-bare", evidence: {} },
    ]);
    expect(followed).toEqual(new Set(["cl-twenty"]));
  });
});

describe("splitCanonicalEntity", () => {
  const mappingRows = [
    { id: "m1", source_system: "lastmile", namespace: "", external_id: "e1" },
    { id: "m2", source_system: "twenty", namespace: "", external_id: "t1" },
  ];
  const claimRows = [
    { id: "cl-twenty", evidence: { sourceSystem: "twenty" } },
    { id: "cl-bare", evidence: {} },
  ];
  const entityRow = {
    id: "c-a",
    status: "active",
    entity_type_slug: "company",
    display_name: "Acme (merged wrongly)",
  };
  const assignments = [
    { mappingId: "m1", half: "a" as const },
    { mappingId: "m2", half: "b" as const },
  ];

  const queuePreviewSelects = (fake: {
    selectQueue: Array<Array<Record<string, unknown>>>;
  }) => {
    fake.selectQueue.push(
      [entityRow], // loadSplitContext: entity
      mappingRows, // loadSplitContext: mappings
      claimRows, // loadSplitContext: claims
      [entityRow], // preview → loadSplitContext: entity
      mappingRows, // preview → loadSplitContext: mappings
      claimRows, // preview → loadSplitContext: claims
      [{ count: 2 }], // memory claims keyed on the entity
      [{ count: 1 }], // kg entities keyed on the entity
      [{ id: "page-1" }], // tenant entity wiki page
    );
  };

  it("partitions mappings + claims per assignment and writes rejections both ways", async () => {
    const fake = createFakeIdentityDb();
    queuePreviewSelects(fake);
    fake.insertReturningQueue.push([{ id: "c-b" }]);

    const result = await splitCanonicalEntity(fake.db as never, {
      tenantId: TENANT,
      canonicalEntityId: "c-a",
      assignments,
      newEntityDisplayName: "Acme Europe",
      actorUserId: "user-op",
      confirmImpact: { ...impact },
    });
    expect(result.entityAId).toBe("c-a");
    expect(result.entityBId).toBe("c-b");
    expect(result.impact).toEqual(impact);

    // New half-B entity created with the operator-provided name.
    const entityInsert = fake.inserts.find(
      (insert) => insert.table === canonicalEntities,
    );
    expect(entityInsert?.values).toMatchObject({
      tenant_id: TENANT,
      entity_type_slug: "company",
      display_name: "Acme Europe",
      normalized_name: "acme europe",
    });

    // Half-B mappings and B-only-group claims repoint to the new entity.
    const mappingUpdate = fake.updates.find(
      (update) => update.table === entitySourceMappings,
    );
    expect(mappingUpdate?.values).toEqual({ canonical_entity_id: "c-b" });
    const claimUpdate = fake.updates.find(
      (update) => update.table === entityIdentityClaims,
    );
    expect(claimUpdate?.values).toMatchObject({ canonical_entity_id: "c-b" });

    // Negative evidence in BOTH directions (AE5): A's identities rejected
    // against B, B's identities rejected against A — immediate re-merge
    // proposals are suppressed by the matcher's rejection demotion.
    const rejections = fake.inserts
      .filter((insert) => insert.table === mappingRejections)
      .map((insert) => insert.values);
    expect(rejections).toHaveLength(2);
    expect(rejections).toContainEqual(
      expect.objectContaining({
        source_system: "lastmile",
        external_id: "e1",
        canonical_entity_id: "c-b",
        reason: "split",
        created_by: "operator",
      }),
    );
    expect(rejections).toContainEqual(
      expect.objectContaining({
        source_system: "twenty",
        external_id: "t1",
        canonical_entity_id: "c-a",
        reason: "split",
        created_by: "operator",
      }),
    );

    // Split audit events append on BOTH halves.
    const events = fake.inserts
      .filter((insert) => insert.table === entityResolutionEvents)
      .map((insert) => insert.values);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.canonical_entity_id).sort()).toEqual([
      "c-a",
      "c-b",
    ]);
    for (const event of events) {
      expect(event.event_type).toBe("split");
      expect(event.actor_user_id).toBe("user-op");
      expect(event.payload).toMatchObject({
        mappingIdsA: ["m1"],
        mappingIdsB: ["m2"],
      });
    }
  });

  it("aborts when the echoed preview impact no longer matches (stale preview)", async () => {
    const fake = createFakeIdentityDb();
    queuePreviewSelects(fake);
    await expect(
      splitCanonicalEntity(fake.db as never, {
        tenantId: TENANT,
        canonicalEntityId: "c-a",
        assignments,
        newEntityDisplayName: "Acme Europe",
        actorUserId: "user-op",
        confirmImpact: { ...impact, memoryClaimCount: 5 },
      }),
    ).rejects.toThrow(/impact changed since preview/);
    // Nothing was written.
    expect(fake.inserts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });

  it("rejects an incomplete partition before writing anything", async () => {
    const fake = createFakeIdentityDb();
    fake.selectQueue.push([entityRow], mappingRows);
    await expect(
      splitCanonicalEntity(fake.db as never, {
        tenantId: TENANT,
        canonicalEntityId: "c-a",
        assignments: [{ mappingId: "m1", half: "a" }],
        newEntityDisplayName: "Acme Europe",
        actorUserId: "user-op",
        confirmImpact: { ...impact },
      }),
    ).rejects.toThrow(/every source mapping/);
    expect(fake.inserts).toHaveLength(0);
  });
});
