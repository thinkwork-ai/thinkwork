import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ontologyCandidateRejections,
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyEntityTypes,
  ontologyEvidenceExamples,
  ontologyFacetTemplates,
  ontologyRelationshipTypes,
} from "@thinkwork/database-pg/schema";

const { mockLoadOntologyChangeSet } = vi.hoisted(() => ({
  mockLoadOntologyChangeSet: vi.fn(),
}));

vi.mock("./repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository.js")>();
  return { ...actual, loadOntologyChangeSet: mockLoadOntologyChangeSet };
});

import {
  ONTOLOGY_PACKS,
  buildOntologyPackListing,
  buildOntologyPackProposal,
  findOntologyPack,
  installOntologyPack,
  listOntologyPacks,
} from "./packs.js";
import { BASELINE_ONTOLOGY_ENTITY_TYPE_SLUGS } from "./baseline.js";
import { SEED_ONTOLOGY_TEMPLATES } from "./templates.js";

/** Table-keyed fake Drizzle db (mirrors repository.test.ts). */
class FakePackDb {
  inserts: Array<{ table: unknown; values: unknown }> = [];
  updates: Array<{ table: unknown; patch: Record<string, unknown> }> = [];
  private idCounter = 0;

  constructor(private selectQueues: Map<unknown, unknown[][]>) {}

  select(_projection?: unknown) {
    const takeRows = (table: unknown) => {
      const queue = this.selectQueues.get(table);
      return queue && queue.length > 0 ? queue.shift()! : [];
    };
    let rows: unknown[] = [];
    const chain: any = {
      from: (table: unknown) => {
        rows = takeRows(table);
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
      then: (resolve: any, reject: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  }

  insert(table: unknown) {
    return {
      values: (values: unknown) => {
        this.inserts.push({ table, values });
        const rows = (Array.isArray(values) ? values : [values]).map(
          (value: any) => ({ id: `generated-${++this.idCounter}`, ...value }),
        );
        const ret: any = {
          onConflictDoNothing: () => ret,
          returning: () => Promise.resolve(rows),
          then: (resolve: any, reject: any) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return ret;
      },
    };
  }

  update(table: unknown) {
    return {
      set: (patch: Record<string, unknown>) => {
        this.updates.push({ table, patch });
        const result: any = {
          returning: () => Promise.resolve([{ id: "updated-set", ...patch }]),
          then: (resolve: any, reject: any) =>
            Promise.resolve([]).then(resolve, reject),
        };
        return { where: () => result };
      },
    };
  }
}

const emptyQueues = (): Map<unknown, unknown[][]> =>
  new Map<unknown, unknown[][]>([
    [ontologyCandidateRejections, [[]]],
    [ontologyEntityTypes, [[]]],
    [ontologyRelationshipTypes, [[]]],
    [ontologyFacetTemplates, [[]]],
    [ontologyChangeSets, [[]]],
    [ontologyChangeSetItems, [[]]],
    [ontologyEvidenceExamples, [[]]],
  ]);

describe("ontology packs", () => {
  beforeEach(() => {
    mockLoadOntologyChangeSet.mockReset();
    mockLoadOntologyChangeSet.mockResolvedValue({ id: "loaded-change-set" });
  });

  it("covers every dormant seed template exactly once and no baseline types", () => {
    const packSlugs = ONTOLOGY_PACKS.flatMap((pack) => pack.entityTypeSlugs);
    const baseline = new Set<string>(BASELINE_ONTOLOGY_ENTITY_TYPE_SLUGS);
    const dormant = Object.keys(SEED_ONTOLOGY_TEMPLATES).filter(
      (slug) => !baseline.has(slug),
    );
    expect([...packSlugs].sort()).toEqual([...dormant].sort());
    expect(new Set(packSlugs).size).toBe(packSlugs.length);
    for (const slug of packSlugs) {
      expect(baseline.has(slug)).toBe(false);
    }
  });

  it("reports per-type state from approved definitions and pending items", () => {
    const listing = buildOntologyPackListing({
      approvedEntityTypeSlugs: new Set(["support_case"]),
      pendingEntityTypeSlugs: new Set(["commitment"]),
    });
    const support = listing.find((pack) => pack.slug === "customer-support")!;
    const states = Object.fromEntries(
      support.types.map((type) => [type.slug, type.state]),
    );
    expect(states).toEqual({
      support_case: "approved",
      commitment: "pending",
      risk: "available",
    });
  });

  it("builds pack proposals with entity types and scoped facet templates", () => {
    const pack = findOntologyPack("customer-support")!;
    const proposal = buildOntologyPackProposal(pack);

    expect(proposal.key).toBe("pack-customer-support");
    const entityItems = proposal.items.filter(
      (item) => item.itemType === "entity_type",
    );
    expect(entityItems.map((item) => item.targetSlug).sort()).toEqual([
      "commitment",
      "risk",
      "support_case",
    ]);
    // Applied definitions read proposedValue.slug/name/broadType (AE4).
    expect(entityItems[0]!.proposedValue).toMatchObject({
      slug: expect.any(String),
      name: expect.any(String),
      broadType: expect.any(String),
    });

    const facetItems = proposal.items.filter(
      (item) => item.itemType === "facet_template",
    );
    expect(facetItems.length).toBeGreaterThan(0);
    for (const facet of facetItems) {
      // Fingerprint-scoped target slug; applied value keeps the plain slug.
      expect(facet.targetSlug).toMatch(/^[a-z_]+:[a-z_]+$/);
      expect(facet.proposedValue).toMatchObject({
        entityTypeSlug: expect.any(String),
        slug: expect.any(String),
        heading: expect.any(String),
      });
    }
    // Pack items carry no founding evidence (provenance renders instead).
    expect(proposal.items.every((item) => item.evidence.length === 0)).toBe(
      true,
    );
  });

  it("stages an install as a pending change set through the governed path (AE4)", async () => {
    const db = new FakePackDb(emptyQueues());

    const result = await installOntologyPack({
      tenantId: "tenant-1",
      packSlug: "revenue",
      db: db as any,
    });

    const changeSetInserts = db.inserts.filter(
      (insert) => insert.table === ontologyChangeSets,
    );
    expect(changeSetInserts).toHaveLength(1);
    expect(changeSetInserts[0]!.values).toMatchObject({
      proposed_by: "pack_install",
      status: "pending_review",
      title: "Install Revenue Operations pack",
    });

    const itemInserts = db.inserts.filter(
      (insert) => insert.table === ontologyChangeSetItems,
    );
    const insertedSlugs = itemInserts.map(
      (insert) => (insert.values as any).target_slug,
    );
    expect(insertedSlugs).toEqual(
      expect.arrayContaining(["opportunity", "order", "order:overview"]),
    );
    expect(result.changeSet).toEqual({ id: "loaded-change-set" });
    expect(result.conflicts).toEqual([]);
    expect(result.skippedRejectedSlugs).toEqual([]);
  });

  it("surfaces hand-authored approved slugs as conflicts, not duplicates (AE6)", async () => {
    const queues = emptyQueues();
    queues.set(ontologyEntityTypes, [[{ slug: "order" }]]);
    const db = new FakePackDb(queues);

    const result = await installOntologyPack({
      tenantId: "tenant-1",
      packSlug: "revenue",
      db: db as any,
    });

    expect(result.conflicts).toEqual([
      { slug: "order", itemType: "entity_type", reason: "approved_definition" },
    ]);
    const insertedSlugs = db.inserts
      .filter((insert) => insert.table === ontologyChangeSetItems)
      .map((insert) => (insert.values as any).target_slug);
    expect(insertedSlugs).not.toContain("order");
    expect(insertedSlugs).toContain("opportunity");
  });

  it("merges into an existing pending hand-authored item instead of duplicating", async () => {
    const queues = emptyQueues();
    queues.set(ontologyChangeSets, [
      [
        {
          id: "manual-set",
          tenant_id: "tenant-1",
          title: "Manual ontology draft",
          proposed_by: "user",
          status: "draft",
        },
      ],
    ]);
    queues.set(ontologyChangeSetItems, [
      [
        {
          id: "manual-order",
          change_set_id: "manual-set",
          item_type: "entity_type",
          target_slug: "order",
          proposed_value: { slug: "order", name: "Hand Order" },
          edited_value: { slug: "order", name: "Operator Order" },
          status: "pending_review",
          position: 0,
        },
      ],
    ]);
    const db = new FakePackDb(queues);

    const result = await installOntologyPack({
      tenantId: "tenant-1",
      packSlug: "revenue",
      db: db as any,
    });

    expect(result.mergedItemIds).toEqual(["manual-order"]);
    const itemUpdates = db.updates.filter(
      (update) => update.table === ontologyChangeSetItems,
    );
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0]!.patch).not.toHaveProperty("edited_value");
    const insertedSlugs = db.inserts
      .filter((insert) => insert.table === ontologyChangeSetItems)
      .map((insert) => (insert.values as any).target_slug);
    expect(insertedSlugs).not.toContain("order");
  });

  it("re-install skips rejected fingerprints and re-surfaces deferred items (R13)", async () => {
    const queues = emptyQueues();
    queues.set(ontologyCandidateRejections, [
      [{ fingerprint: "entity_type:risk" }],
    ]);
    queues.set(ontologyChangeSets, [
      [
        {
          id: "pack-set",
          tenant_id: "tenant-1",
          title: "Install Customer Support pack",
          proposed_by: "pack_install",
          status: "pending_review",
        },
      ],
    ]);
    queues.set(ontologyChangeSetItems, [
      [
        {
          id: "deferred-support-case",
          change_set_id: "pack-set",
          item_type: "entity_type",
          target_slug: "support_case",
          proposed_value: { slug: "support_case" },
          edited_value: null,
          status: "deferred",
          position: 0,
        },
      ],
    ]);
    const db = new FakePackDb(queues);

    const result = await installOntologyPack({
      tenantId: "tenant-1",
      packSlug: "customer-support",
      db: db as any,
    });

    expect(result.skippedRejectedSlugs).toEqual(["risk"]);
    expect(result.mergedItemIds).toEqual(["deferred-support-case"]);
    // Deferred item re-surfaces as pending_review.
    const itemUpdates = db.updates.filter(
      (update) => update.table === ontologyChangeSetItems,
    );
    expect(itemUpdates[0]!.patch).toMatchObject({ status: "pending_review" });
    // Rejected slug never re-enters the staged set.
    const insertedSlugs = db.inserts
      .filter((insert) => insert.table === ontologyChangeSetItems)
      .map((insert) => (insert.values as any).target_slug);
    expect(insertedSlugs).not.toContain("risk");
    expect(insertedSlugs).toContain("commitment");
  });

  it("lists packs against tenant state via the db wiring", async () => {
    const queues = emptyQueues();
    queues.set(ontologyEntityTypes, [[{ slug: "opportunity" }]]);
    queues.set(ontologyChangeSets, [[{ id: "set-1" }]]);
    queues.set(ontologyChangeSetItems, [[{ target_slug: "order" }]]);
    const db = new FakePackDb(queues);

    const listing = await listOntologyPacks({
      tenantId: "tenant-1",
      db: db as any,
    });
    const revenue = listing.find((pack) => pack.slug === "revenue")!;
    expect(
      Object.fromEntries(revenue.types.map((type) => [type.slug, type.state])),
    ).toEqual({ opportunity: "approved", order: "pending" });
  });

  it("rejects unknown pack slugs", async () => {
    await expect(
      installOntologyPack({
        tenantId: "tenant-1",
        packSlug: "nope",
        db: new FakePackDb(emptyQueues()) as any,
      }),
    ).rejects.toThrow(/Unknown ontology pack/);
  });
});
