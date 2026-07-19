import { describe, expect, it } from "vitest";
import {
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyCandidateRejections,
  ontologyEntityTypes,
  ontologyEvidenceExamples,
  ontologyVersions,
} from "@thinkwork/database-pg/schema";
import {
  OntologyChangeSetConflictError,
  approveOntologyChangeSet,
  assembleOntologySchemaGraph,
  createOntologyChangeSet,
  filterMappingsForOntologyDefinitions,
  guardOntologyChangeSetItemEdit,
  ontologyCandidateFingerprint,
  partitionOntologyApprovalItems,
  planOntologyChangeSetItemWrites,
  rejectOntologyChangeSet,
  rejectOntologyChangeSetItem,
  updateOntologyChangeSet,
} from "./repository.js";

describe("ontology repository helpers", () => {
  it("keeps mappings for approved definitions and drops mappings for omitted relationship types", () => {
    const mappings = filterMappingsForOntologyDefinitions({
      entityRows: [{ id: "entity-customer" }],
      relationshipRows: [{ id: "rel-owns" }],
      facetRows: [{ id: "facet-summary" }],
      mappingRows: [
        {
          subject_kind: "entity_type",
          subject_id: "entity-customer",
          mapping_kind: "broad",
        },
        {
          subject_kind: "relationship_type",
          subject_id: "rel-owns",
          mapping_kind: "related",
        },
        {
          subject_kind: "relationship_type",
          subject_id: "rel-weak-removed",
          mapping_kind: "related",
        },
      ],
    });

    expect(mappings).toEqual([
      {
        subject_kind: "entity_type",
        subject_id: "entity-customer",
        mapping_kind: "broad",
      },
      {
        subject_kind: "relationship_type",
        subject_id: "rel-owns",
        mapping_kind: "related",
      },
    ]);
  });
});

describe("assembleOntologySchemaGraph", () => {
  const baselineEntityRows = [
    { slug: "customer", name: "Customer", lifecycle_status: "approved" },
    { slug: "person", name: "Person", lifecycle_status: "approved" },
    { slug: "product", name: "Product", lifecycle_status: "approved" },
    { slug: "project", name: "Project", lifecycle_status: "approved" },
  ];

  it("returns baseline types with zero instance counts and no candidates on a fresh tenant", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: baselineEntityRows,
      relationshipRows: [],
      instanceCountRows: [],
      changeSetRows: [],
      candidateItemRows: [],
      evidenceCountRows: [],
    });

    expect(graph.tenantId).toBe("tenant-1");
    expect(graph.types).toHaveLength(4);
    expect(graph.types.every((type) => type.instanceCount === 0)).toBe(true);
    expect(graph.types[0]).toEqual({
      slug: "customer",
      name: "Customer",
      instanceCount: 0,
      lifecycleStatus: "APPROVED",
    });
    expect(graph.relationships).toEqual([]);
    expect(graph.candidates).toEqual([]);
  });

  it("merges typed kg entity counts onto their types and projects relationship endpoints", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: baselineEntityRows,
      relationshipRows: [
        {
          slug: "works_for",
          name: "Works for",
          source_type_slugs: ["person"],
          target_type_slugs: ["customer"],
        },
      ],
      instanceCountRows: [
        { slug: "customer", count: 7 },
        { slug: "person", count: 3 },
        // Typed entities whose slug has no approved definition don't crash
        // the map — the type row simply isn't there to receive the count.
        { slug: "orphaned_type", count: 9 },
        { slug: null, count: 4 },
      ],
      changeSetRows: [],
      candidateItemRows: [],
      evidenceCountRows: [],
    });

    expect(graph.types.map((type) => [type.slug, type.instanceCount])).toEqual([
      ["customer", 7],
      ["person", 3],
      ["product", 0],
      ["project", 0],
    ]);
    expect(graph.relationships).toEqual([
      {
        slug: "works_for",
        name: "Works for",
        sourceTypeSlugs: ["person"],
        targetTypeSlugs: ["customer"],
      },
    ]);
  });

  it("surfaces pending change-set items as candidates with evidence counts and origin", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: [],
      relationshipRows: [],
      instanceCountRows: [],
      changeSetRows: [
        {
          id: "change-set-1",
          status: "pending_review",
          proposed_by: "suggestion_engine",
        },
        { id: "change-set-2", status: "draft", proposed_by: "user" },
      ],
      candidateItemRows: [
        {
          id: "item-1",
          change_set_id: "change-set-1",
          item_type: "entity_type",
          status: "pending_review",
          target_slug: "work_order",
          proposed_value: { slug: "work_order", name: "Work Order" },
          edited_value: null,
        },
        {
          id: "item-2",
          change_set_id: "change-set-2",
          item_type: "relationship_type",
          status: "pending_review",
          // No target_slug — the candidate slug falls back to the proposal.
          target_slug: null,
          proposed_value: { slug: "assigned_to" },
          edited_value: { slug: "assigned_to", name: "Assigned to" },
        },
      ],
      evidenceCountRows: [
        { itemId: "item-1", count: 12 },
        { itemId: null, count: 5 },
      ],
    });

    expect(graph.candidates).toEqual([
      {
        itemId: "item-1",
        changeSetId: "change-set-1",
        itemType: "ENTITY_TYPE",
        slug: "work_order",
        proposedValue: { slug: "work_order", name: "Work Order" },
        editedValue: null,
        evidenceCount: 12,
        origin: "suggestion_engine",
        status: "PENDING_REVIEW",
      },
      {
        itemId: "item-2",
        changeSetId: "change-set-2",
        itemType: "RELATIONSHIP_TYPE",
        slug: "assigned_to",
        proposedValue: { slug: "assigned_to" },
        editedValue: { slug: "assigned_to", name: "Assigned to" },
        evidenceCount: 0,
        origin: "user",
        status: "PENDING_REVIEW",
      },
    ]);
  });

  it("excludes rejected/approved items and items whose change set is already settled", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: [],
      relationshipRows: [],
      instanceCountRows: [],
      // Settled change sets never reach the assembly (the query filters to
      // draft/pending_review), so their items have no owning row here.
      changeSetRows: [
        {
          id: "change-set-open",
          status: "pending_review",
          proposed_by: "user",
        },
      ],
      candidateItemRows: [
        {
          id: "item-rejected",
          change_set_id: "change-set-open",
          item_type: "entity_type",
          status: "rejected",
          target_slug: "invoice",
          proposed_value: {},
          edited_value: null,
        },
        {
          id: "item-approved",
          change_set_id: "change-set-open",
          item_type: "entity_type",
          status: "approved",
          target_slug: "order",
          proposed_value: {},
          edited_value: null,
        },
        {
          id: "item-orphan",
          change_set_id: "change-set-applied",
          item_type: "entity_type",
          status: "pending_review",
          target_slug: "shipment",
          proposed_value: {},
          edited_value: null,
        },
      ],
      evidenceCountRows: [],
    });

    expect(graph.candidates).toEqual([]);
  });
});

/**
 * Table-keyed fake Drizzle db (THINK-320 U2). Select results are queued per
 * table object; inserts and updates are recorded so tests can assert what
 * was (and was not) written. Insert returning() synthesizes ids.
 */
class FakeOntologyDb {
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
      groupBy: () => chain,
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
          returning: () => Promise.resolve([{ id: "updated" }]),
          then: (resolve: any, reject: any) =>
            Promise.resolve([]).then(resolve, reject),
        };
        return { where: () => result };
      },
    };
  }

  transaction<T>(fn: (tx: this) => Promise<T>) {
    return fn(this);
  }
}

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  tenant_id: "tenant-1",
  change_set_id: "set-1",
  item_type: "entity_type",
  action: "create",
  status: "pending_review",
  target_kind: "entity_type",
  target_slug: "work_order",
  title: "Add work order",
  description: null,
  proposed_value: { slug: "work_order", name: "Work Order" },
  edited_value: null,
  confidence: null,
  position: 0,
  created_at: new Date("2026-07-18T12:00:00.000Z"),
  updated_at: new Date("2026-07-18T12:00:00.000Z"),
  ...overrides,
});

const changeSetRow = (overrides: Record<string, unknown> = {}) => ({
  id: "set-1",
  tenant_id: "tenant-1",
  title: "Manual ontology draft",
  summary: null,
  status: "draft",
  confidence: null,
  observed_frequency: 0,
  expected_impact: {},
  proposed_by: "user",
  proposed_by_user_id: "admin-1",
  approved_by_user_id: null,
  approved_at: null,
  rejected_by_user_id: null,
  rejected_at: null,
  applied_version_id: null,
  created_at: new Date("2026-07-18T12:00:00.000Z"),
  updated_at: new Date("2026-07-18T12:00:00.000Z"),
  ...overrides,
});

describe("ontologyCandidateFingerprint", () => {
  it("normalizes kind and slug into a deterministic fingerprint", () => {
    expect(ontologyCandidateFingerprint("entity_type", "Work Order")).toBe(
      "entity_type:work_order",
    );
    expect(ontologyCandidateFingerprint("ENTITY_TYPE", "  work_order  ")).toBe(
      "entity_type:work_order",
    );
  });
});

describe("planOntologyChangeSetItemWrites (R14)", () => {
  const evidence = (quote: string) => ({
    sourceKind: "manual",
    quote,
  });

  it("stages fresh slugs as inserts", () => {
    const plan = planOntologyChangeSetItemWrites({
      items: [
        {
          itemType: "entity_type",
          slug: "shipment",
          proposedValue: { slug: "shipment", name: "Shipment" },
        },
      ],
      pendingItems: [],
      approvedFingerprints: new Set(),
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].slug).toBe("shipment");
    expect(plan.merges).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it("returns a conflict (no insert) when the slug collides with an approved definition (AE6)", () => {
    const plan = planOntologyChangeSetItemWrites({
      items: [
        {
          itemType: "entity_type",
          slug: "Order",
          proposedValue: { slug: "order", name: "Order" },
        },
      ],
      pendingItems: [],
      approvedFingerprints: new Set([
        ontologyCandidateFingerprint("entity_type", "order"),
      ]),
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.merges).toEqual([]);
    expect(plan.conflicts).toEqual([
      { slug: "order", itemType: "entity_type", reason: "approved_definition" },
    ]);
  });

  it("merges into an existing pending item, unioning evidence and updating the proposal", () => {
    const plan = planOntologyChangeSetItemWrites({
      items: [
        {
          itemType: "entity_type",
          slug: "work_order",
          proposedValue: { slug: "work_order", name: "Work Order v2" },
          evidence: [evidence("new sighting")],
        },
      ],
      pendingItems: [
        {
          id: "item-existing",
          change_set_id: "set-scan",
          item_type: "entity_type",
          target_slug: "work_order",
          proposed_value: { slug: "work_order", name: "Work Order" },
        },
      ],
      approvedFingerprints: new Set(),
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].itemId).toBe("item-existing");
    expect(plan.merges[0].changeSetId).toBe("set-scan");
    expect(plan.merges[0].proposedValue).toEqual({
      slug: "work_order",
      name: "Work Order v2",
    });
    expect(plan.merges[0].evidence).toEqual([evidence("new sighting")]);
  });

  it("collapses duplicate slugs inside one submission into a single insert with unioned evidence", () => {
    const plan = planOntologyChangeSetItemWrites({
      items: [
        {
          itemType: "entity_type",
          slug: "shipment",
          proposedValue: { slug: "shipment", name: "Shipment" },
          evidence: [evidence("first")],
        },
        {
          itemType: "entity_type",
          slug: "Shipment",
          proposedValue: { slug: "shipment", name: "Shipment v2" },
          evidence: [evidence("second")],
        },
      ],
      pendingItems: [],
      approvedFingerprints: new Set(),
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].proposedValue).toEqual({
      slug: "shipment",
      name: "Shipment v2",
    });
    expect(plan.inserts[0].evidence).toEqual([
      evidence("first"),
      evidence("second"),
    ]);
  });

  it("does not merge across item kinds sharing a slug", () => {
    const plan = planOntologyChangeSetItemWrites({
      items: [
        {
          itemType: "relationship_type",
          slug: "order",
          proposedValue: { slug: "order" },
        },
      ],
      pendingItems: [
        {
          id: "item-entity",
          change_set_id: "set-1",
          item_type: "entity_type",
          target_slug: "order",
          proposed_value: {},
        },
      ],
      approvedFingerprints: new Set([
        ontologyCandidateFingerprint("entity_type", "order"),
      ]),
    });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.merges).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });
});

describe("partitionOntologyApprovalItems (R15/AE7)", () => {
  it("splits approvals from exclusions and never approves deferred or rejected items", () => {
    const result = partitionOntologyApprovalItems({
      items: [
        itemRow({ id: "item-a", target_slug: "shipment" }),
        itemRow({ id: "item-b", target_slug: "carrier" }),
        itemRow({ id: "item-c", target_slug: "invoice", status: "deferred" }),
        itemRow({ id: "item-d", target_slug: "quote", status: "rejected" }),
      ],
      excludedItemIds: ["item-b"],
    });
    expect(result.approveIds).toEqual(["item-a"]);
    expect(result.excludeIds).toEqual(["item-b"]);
  });

  it("throws when an excluded id is not part of the change set", () => {
    expect(() =>
      partitionOntologyApprovalItems({
        items: [itemRow({ id: "item-a" })],
        excludedItemIds: ["item-unknown"],
      }),
    ).toThrow(/not part of this change set/i);
  });

  it("blocks approving a relationship whose referenced type item is excluded, naming the type (AE7)", () => {
    expect(() =>
      partitionOntologyApprovalItems({
        items: [
          itemRow({ id: "item-type", target_slug: "carrier" }),
          itemRow({
            id: "item-rel",
            item_type: "relationship_type",
            target_slug: "shipped_by",
            proposed_value: {
              slug: "shipped_by",
              sourceTypeSlugs: ["shipment"],
              targetTypeSlugs: ["carrier"],
            },
          }),
        ],
        excludedItemIds: ["item-type"],
        approvedDefinitionTypeSlugs: new Set(["shipment"]),
      }),
    ).toThrow(/carrier/);
  });

  it("blocks a relationship referencing a type item that is already deferred in the set", () => {
    expect(() =>
      partitionOntologyApprovalItems({
        items: [
          itemRow({
            id: "item-type",
            target_slug: "carrier",
            status: "deferred",
          }),
          itemRow({
            id: "item-rel",
            item_type: "relationship_type",
            target_slug: "shipped_by",
            edited_value: {
              slug: "shipped_by",
              sourceTypeSlugs: ["carrier"],
              targetTypeSlugs: [],
            },
          }),
        ],
        excludedItemIds: [],
      }),
    ).toThrow(/carrier/);
  });

  it("allows a relationship whose referenced type is already an approved definition even when a duplicate item is excluded", () => {
    const result = partitionOntologyApprovalItems({
      items: [
        itemRow({ id: "item-type", target_slug: "carrier" }),
        itemRow({
          id: "item-rel",
          item_type: "relationship_type",
          target_slug: "shipped_by",
          proposed_value: {
            slug: "shipped_by",
            sourceTypeSlugs: ["carrier"],
            targetTypeSlugs: [],
          },
        }),
      ],
      excludedItemIds: ["item-type"],
      approvedDefinitionTypeSlugs: new Set(["carrier"]),
    });
    expect(result.approveIds).toEqual(["item-rel"]);
  });
});

describe("guardOntologyChangeSetItemEdit (R16)", () => {
  const row = itemRow();

  it("passes when expectedUpdatedAt matches the stored timestamp", () => {
    expect(() =>
      guardOntologyChangeSetItemEdit({
        row: row as any,
        expectedUpdatedAt: "2026-07-18T12:00:00.000Z",
      }),
    ).not.toThrow();
  });

  it("throws a conflict on a stale expectedUpdatedAt", () => {
    expect(() =>
      guardOntologyChangeSetItemEdit({
        row: row as any,
        expectedUpdatedAt: "2026-07-18T11:59:00.000Z",
      }),
    ).toThrow(OntologyChangeSetConflictError);
  });

  it("rejects edits to approved and applied items regardless of timestamp", () => {
    for (const status of ["approved", "applied"]) {
      expect(() =>
        guardOntologyChangeSetItemEdit({
          row: itemRow({ status }) as any,
          expectedUpdatedAt: null,
        }),
      ).toThrow(/settled/i);
    }
  });

  it("skips the timestamp check when expectedUpdatedAt is omitted", () => {
    expect(() =>
      guardOntologyChangeSetItemEdit({ row: row as any }),
    ).not.toThrow();
  });
});

describe("createOntologyChangeSet (KTD-5)", () => {
  it("creates a manual draft with items and evidence without touching ontology versions (AE1)", async () => {
    const draftInsertCapture = new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        // open change sets (none), then the load at the end
        [ontologyChangeSets, [[], [changeSetRow({ id: "generated-1" })]]],
        [ontologyChangeSetItems, [[], []]],
        [ontologyEvidenceExamples, [[]]],
      ]),
    );

    const result = await createOntologyChangeSet({
      tenantId: "tenant-1",
      actorUserId: "admin-1",
      items: [
        {
          itemType: "entity_type",
          slug: "shipment",
          proposedValue: { slug: "shipment", name: "Shipment" },
        },
        {
          itemType: "relationship_type",
          slug: "shipped_by",
          proposedValue: {
            slug: "shipped_by",
            name: "Shipped by",
            sourceTypeSlugs: ["shipment"],
            targetTypeSlugs: ["carrier"],
          },
          evidence: [{ sourceKind: "manual", quote: "authored on canvas" }],
        },
      ],
      db: draftInsertCapture as any,
    });

    // The draft change set was created as the caller's open manual draft.
    const setInsert = draftInsertCapture.inserts.find(
      (entry) => entry.table === ontologyChangeSets,
    );
    expect(setInsert).toBeDefined();
    expect(setInsert!.values).toMatchObject({
      tenant_id: "tenant-1",
      proposed_by: "user",
      proposed_by_user_id: "admin-1",
      status: "draft",
    });

    const insertedItems = draftInsertCapture.inserts.filter(
      (entry) => entry.table === ontologyChangeSetItems,
    );
    expect(insertedItems).toHaveLength(2);
    const evidenceInserts = draftInsertCapture.inserts.filter(
      (entry) => entry.table === ontologyEvidenceExamples,
    );
    expect(evidenceInserts).toHaveLength(1);

    // AE1: the active ontology version is untouched by authoring.
    expect(
      draftInsertCapture.inserts.some(
        (entry) => entry.table === ontologyVersions,
      ),
    ).toBe(false);
    expect(
      draftInsertCapture.updates.some(
        (entry) => entry.table === ontologyVersions,
      ),
    ).toBe(false);

    expect(result.mergedItemIds).toEqual([]);
    expect(result.conflicts).toEqual([]);
    expect(result.changeSet).not.toBeNull();
  });

  it("merges a colliding pending item instead of inserting and reports approved-slug conflicts (AE6)", async () => {
    const db = new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        [
          ontologyChangeSets,
          [
            [
              changeSetRow({
                id: "set-scan",
                proposed_by: "suggestion_engine",
              }),
            ],
          ],
        ],
        [
          ontologyChangeSetItems,
          [
            [
              itemRow({
                id: "item-pending",
                change_set_id: "set-scan",
                target_slug: "work_order",
              }),
            ],
          ],
        ],
        // approved entity type slugs include "order" → conflict
        [ontologyEntityTypes, [[{ slug: "order" }]]],
      ]),
    );

    const result = await createOntologyChangeSet({
      tenantId: "tenant-1",
      actorUserId: "admin-1",
      items: [
        {
          itemType: "entity_type",
          slug: "work_order",
          proposedValue: { slug: "work_order", name: "Work Order v2" },
          evidence: [{ sourceKind: "manual", quote: "merged sighting" }],
        },
        {
          itemType: "entity_type",
          slug: "order",
          proposedValue: { slug: "order", name: "Order" },
        },
      ],
      db: db as any,
    });

    // No new change set and no duplicate item rows were created.
    expect(db.inserts.some((entry) => entry.table === ontologyChangeSets)).toBe(
      false,
    );
    expect(
      db.inserts.some((entry) => entry.table === ontologyChangeSetItems),
    ).toBe(false);
    // Merge updated the existing pending item and attached the evidence.
    const mergePatch = db.updates.find(
      (entry) => entry.table === ontologyChangeSetItems,
    );
    expect(mergePatch?.patch).toMatchObject({
      proposed_value: { slug: "work_order", name: "Work Order v2" },
      status: "pending_review",
    });
    const evidenceInsert = db.inserts.find(
      (entry) => entry.table === ontologyEvidenceExamples,
    );
    expect(evidenceInsert).toBeDefined();
    expect(result.mergedItemIds).toEqual(["item-pending"]);
    expect(result.conflicts).toEqual([
      { slug: "order", itemType: "entity_type", reason: "approved_definition" },
    ]);
    expect(result.changeSet).toBeNull();
  });
});

describe("approveOntologyChangeSet with exclusions (R15)", () => {
  const buildApproveDb = (options: { itemStatuses?: Record<string, string> }) =>
    new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        [
          ontologyChangeSets,
          [
            [changeSetRow({ status: "pending_review" })],
            [changeSetRow({ status: "approved" })],
          ],
        ],
        [
          ontologyChangeSetItems,
          [
            [
              itemRow({ id: "item-a", target_slug: "shipment" }),
              itemRow({
                id: "item-b",
                target_slug: "carrier",
                status: options.itemStatuses?.["item-b"] ?? "pending_review",
              }),
            ],
            [],
          ],
        ],
        [ontologyEntityTypes, [[{ slug: "customer" }]]],
        [ontologyVersions, [[{ id: "version-1", version_number: 3 }]]],
        [ontologyEvidenceExamples, [[]]],
      ]),
    );

  it("defers excluded items, approves the rest, and mints exactly one version", async () => {
    const db = buildApproveDb({});
    await approveOntologyChangeSet({
      tenantId: "tenant-1",
      changeSetId: "set-1",
      actorUserId: "admin-1",
      excludedItemIds: ["item-b"],
      excludedDisposition: "deferred",
      db: db as any,
    });

    const versionInserts = db.inserts.filter(
      (entry) => entry.table === ontologyVersions,
    );
    expect(versionInserts).toHaveLength(1);
    expect(versionInserts[0].values).toMatchObject({ version_number: 4 });

    const itemPatches = db.updates
      .filter((entry) => entry.table === ontologyChangeSetItems)
      .map((entry) => entry.patch);
    expect(itemPatches.some((patch) => patch.status === "approved")).toBe(true);
    expect(itemPatches.some((patch) => patch.status === "deferred")).toBe(true);
    // Deferral leaves no rejection fingerprint behind.
    expect(
      db.inserts.some((entry) => entry.table === ontologyCandidateRejections),
    ).toBe(false);
  });

  it("writes candidate rejection fingerprints for excluded-as-rejected items", async () => {
    const db = buildApproveDb({});
    await approveOntologyChangeSet({
      tenantId: "tenant-1",
      changeSetId: "set-1",
      actorUserId: "admin-1",
      excludedItemIds: ["item-b"],
      excludedDisposition: "rejected",
      db: db as any,
    });

    const rejectionInsert = db.inserts.find(
      (entry) => entry.table === ontologyCandidateRejections,
    );
    expect(rejectionInsert).toBeDefined();
    expect(rejectionInsert!.values).toEqual([
      expect.objectContaining({
        tenant_id: "tenant-1",
        kind: "entity_type",
        slug: "carrier",
        fingerprint: "entity_type:carrier",
        rejected_by: "admin-1",
      }),
    ]);
    const itemPatches = db.updates
      .filter((entry) => entry.table === ontologyChangeSetItems)
      .map((entry) => entry.patch);
    expect(itemPatches.some((patch) => patch.status === "rejected")).toBe(true);
  });
});

describe("rejectOntologyChangeSet fingerprints (R13)", () => {
  it("writes a fingerprint for every slugged item in the rejected set", async () => {
    const db = new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        [
          ontologyChangeSets,
          [
            [changeSetRow({ status: "pending_review" })],
            [changeSetRow({ status: "rejected" })],
          ],
        ],
        [
          ontologyChangeSetItems,
          [
            [
              itemRow({ id: "item-a", target_slug: "work_order" }),
              itemRow({
                id: "item-b",
                item_type: "relationship_type",
                target_slug: null,
                proposed_value: { slug: "assigned_to" },
              }),
            ],
            [],
          ],
        ],
        [ontologyEvidenceExamples, [[]]],
      ]),
    );

    await rejectOntologyChangeSet({
      tenantId: "tenant-1",
      changeSetId: "set-1",
      actorUserId: "admin-1",
      db: db as any,
    });

    const rejectionInsert = db.inserts.find(
      (entry) => entry.table === ontologyCandidateRejections,
    );
    expect(rejectionInsert).toBeDefined();
    expect(rejectionInsert!.values).toEqual([
      expect.objectContaining({ fingerprint: "entity_type:work_order" }),
      expect.objectContaining({ fingerprint: "relationship_type:assigned_to" }),
    ]);
  });
});

describe("rejectOntologyChangeSetItem (U6, R13)", () => {
  it("rejects one item, writes its fingerprint, and leaves the change set and versions untouched", async () => {
    const db = new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        [
          ontologyChangeSetItems,
          [
            // the target item load, then the reload for toOntologyChangeSet
            [itemRow({ id: "item-a", target_slug: "work_order" })],
            [itemRow({ id: "item-a", status: "rejected" })],
          ],
        ],
        [
          ontologyChangeSets,
          [
            [changeSetRow({ status: "pending_review" })],
            [changeSetRow({ status: "pending_review" })],
          ],
        ],
        [ontologyEvidenceExamples, [[]]],
      ]),
    );

    await rejectOntologyChangeSetItem({
      tenantId: "tenant-1",
      itemId: "item-a",
      actorUserId: "admin-1",
      db: db as any,
    });

    // The single item flipped to rejected.
    const itemPatch = db.updates.find(
      (entry) => entry.table === ontologyChangeSetItems,
    );
    expect(itemPatch?.patch).toMatchObject({ status: "rejected" });

    // R13: the rejection fingerprint was written.
    const rejectionInsert = db.inserts.find(
      (entry) => entry.table === ontologyCandidateRejections,
    );
    expect(rejectionInsert).toBeDefined();
    expect(rejectionInsert!.values).toEqual([
      expect.objectContaining({ fingerprint: "entity_type:work_order" }),
    ]);

    // The owning change set stays open and no version was minted.
    expect(db.updates.some((entry) => entry.table === ontologyChangeSets)).toBe(
      false,
    );
    expect(db.inserts.some((entry) => entry.table === ontologyVersions)).toBe(
      false,
    );
  });

  it("raises a conflict for settled items without writing", async () => {
    const db = new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        [
          ontologyChangeSetItems,
          [[itemRow({ id: "item-a", status: "approved" })]],
        ],
      ]),
    );

    await expect(
      rejectOntologyChangeSetItem({
        tenantId: "tenant-1",
        itemId: "item-a",
        actorUserId: "admin-1",
        db: db as any,
      }),
    ).rejects.toBeInstanceOf(OntologyChangeSetConflictError);
    expect(db.updates).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
  });

  it("refuses items whose change set is already terminal", async () => {
    const db = new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        [ontologyChangeSetItems, [[itemRow({ id: "item-a" })]]],
        [ontologyChangeSets, [[changeSetRow({ status: "approved" })]]],
      ]),
    );

    await expect(
      rejectOntologyChangeSetItem({
        tenantId: "tenant-1",
        itemId: "item-a",
        actorUserId: "admin-1",
        db: db as any,
      }),
    ).rejects.toThrow("already terminal");
    expect(db.updates).toHaveLength(0);
  });
});

describe("updateOntologyChangeSet optimistic concurrency (R16)", () => {
  const buildUpdateDb = (row: Record<string, unknown>) =>
    new FakeOntologyDb(
      new Map<unknown, unknown[][]>([
        [ontologyChangeSets, [[changeSetRow()], [changeSetRow()]]],
        [ontologyChangeSetItems, [[row], []]],
        [ontologyEvidenceExamples, [[]]],
      ]),
    );

  it("rejects a stale expectedUpdatedAt without writing", async () => {
    const db = buildUpdateDb(itemRow());
    await expect(
      updateOntologyChangeSet({
        actorUserId: "admin-1",
        input: {
          tenantId: "tenant-1",
          changeSetId: "set-1",
          items: [
            {
              id: "item-1",
              editedValue: { slug: "work_order", name: "Edited" },
              expectedUpdatedAt: "2026-07-18T11:00:00.000Z",
            },
          ],
        },
        db: db as any,
      }),
    ).rejects.toThrow(OntologyChangeSetConflictError);
    expect(
      db.updates.some((entry) => entry.table === ontologyChangeSetItems),
    ).toBe(false);
  });

  it("writes when expectedUpdatedAt matches", async () => {
    const db = buildUpdateDb(itemRow());
    await updateOntologyChangeSet({
      actorUserId: "admin-1",
      input: {
        tenantId: "tenant-1",
        changeSetId: "set-1",
        items: [
          {
            id: "item-1",
            editedValue: { slug: "work_order", name: "Edited" },
            expectedUpdatedAt: "2026-07-18T12:00:00.000Z",
          },
        ],
      },
      db: db as any,
    });
    const patch = db.updates.find(
      (entry) => entry.table === ontologyChangeSetItems,
    );
    expect(patch?.patch).toMatchObject({
      edited_value: { slug: "work_order", name: "Edited" },
    });
  });

  it("rejects edits to items that are already approved", async () => {
    const db = buildUpdateDb(itemRow({ status: "approved" }));
    await expect(
      updateOntologyChangeSet({
        actorUserId: "admin-1",
        input: {
          tenantId: "tenant-1",
          changeSetId: "set-1",
          items: [{ id: "item-1", editedValue: { name: "Nope" } }],
        },
        db: db as any,
      }),
    ).rejects.toThrow(/settled/i);
  });
});
