import { describe, expect, it, vi } from "vitest";
import {
  ontologyCandidateRejections,
  ontologyChangeSetItems,
  ontologyChangeSets,
  ontologyEntityTypes,
  ontologyEvidenceExamples,
  ontologyFacetTemplates,
  ontologyRelationshipTypes,
} from "@thinkwork/database-pg/schema";
import {
  buildOntologyScanDedupeKey,
  collectOntologySuggestionSources,
  extractOntologySuggestionFeatures,
  parseOntologySynthesisResponse,
  persistOntologyChangeSetProposals,
  startOntologySuggestionScanJob,
  synthesizeOntologyChangeSetProposals,
  type ActiveOntologySnapshot,
  type OntologyChangeSetProposal,
  type OntologySuggestionObservation,
} from "./suggestions.js";

const activeOntology = (overrides: Partial<ActiveOntologySnapshot> = {}) => ({
  entityTypeSlugs: new Set(["customer", "person"]),
  relationshipTypeSlugs: new Set<string>(),
  facetTemplateSlugs: new Set<string>(),
  mappingKeys: new Set<string>(),
  ...overrides,
});

const observation = (
  quote: string,
  sourceKind = "brain_section",
  sourceRef = quote.slice(0, 12),
): OntologySuggestionObservation => ({
  sourceKind,
  sourceRef,
  sourceLabel: "Acme / Next steps",
  quote,
  text: quote,
  observedAt: "2026-05-17T12:00:00.000Z",
  metadata: {},
});

const scanRow = (overrides: Record<string, unknown> = {}) => ({
  id: "scan-1",
  tenant_id: "tenant-1",
  status: "pending",
  trigger: "manual",
  dedupe_key: "scan-key",
  started_at: null,
  finished_at: null,
  error: null,
  result: {},
  metrics: {},
  created_at: new Date("2026-05-17T12:00:00.000Z"),
  updated_at: new Date("2026-05-17T12:00:00.000Z"),
  ...overrides,
});

class FakeScanDb {
  updates: Record<string, unknown>[] = [];

  constructor(
    private selectRows: unknown[][],
    private insertRows: unknown[][],
  ) {}

  select() {
    const rows = this.selectRows.shift() ?? [];
    return {
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    };
  }

  insert() {
    const rows = this.insertRows.shift() ?? [];
    return {
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(rows),
        }),
      }),
    };
  }

  update() {
    return {
      set: (patch: Record<string, unknown>) => {
        this.updates.push(patch);
        return { where: () => Promise.resolve([]) };
      },
    };
  }
}

/**
 * Table-keyed fake Drizzle db (mirrors repository.test.ts). Select results
 * are queued per table object; inserts and updates are recorded so tests can
 * assert what was (and was not) written. There is deliberately no delete():
 * the KTD-4 upsert path must never delete-reinsert, so any delete call
 * throws.
 */
class FakePersistDb {
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

const emptyPersistContext = (): Map<unknown, unknown[][]> =>
  new Map<unknown, unknown[][]>([
    [ontologyCandidateRejections, [[]]],
    [ontologyEntityTypes, [[]]],
    [ontologyRelationshipTypes, [[]]],
    [ontologyFacetTemplates, [[]]],
    [ontologyChangeSets, [[]]],
    [ontologyChangeSetItems, [[]]],
    [ontologyEvidenceExamples, [[]]],
  ]);

const proposalWith = (
  overrides: Partial<OntologyChangeSetProposal> = {},
): OntologyChangeSetProposal => ({
  key: "test-proposal",
  title: "Customer commitment model",
  summary: "Test summary",
  confidence: 0.8,
  observedFrequency: 2,
  expectedImpact: {},
  items: [
    {
      itemType: "entity_type",
      action: "create",
      targetKind: "entity_type",
      targetSlug: "commitment",
      title: "Add Commitment entity type",
      description: "Track commitments.",
      proposedValue: { slug: "commitment", name: "Commitment" },
      confidence: 0.8,
      evidence: [
        {
          sourceKind: "brain_section",
          sourceRef: "evidence-1",
          sourceLabel: "Acme",
          quote: "Acme was promised a rollout plan.",
          observedAt: "2026-05-17T12:00:00.000Z",
          metadata: {},
        },
      ],
    },
  ],
  ...overrides,
});

class FakeSourceDb {
  constructor(private selectRows: unknown[][]) {}

  select() {
    const rows = this.selectRows.shift() ?? [];
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  }
}

describe("ontology suggestions", () => {
  it("uses a stable five-minute dedupe bucket for scan starts", () => {
    expect(
      buildOntologyScanDedupeKey({
        tenantId: "tenant-1",
        trigger: "manual",
        now: new Date("2026-05-17T12:04:59Z"),
      }),
    ).toBe("ontology-scan:tenant-1:manual:5930064");
    expect(
      buildOntologyScanDedupeKey({
        tenantId: "tenant-1",
        trigger: "manual",
        now: new Date("2026-05-17T12:05:00Z"),
      }),
    ).toBe("ontology-scan:tenant-1:manual:5930065");
  });

  it("loads the existing scan job when a concurrent start wins the dedupe key", async () => {
    const db = new FakeScanDb(
      [[], [scanRow({ id: "existing-scan", result: { previous: true } })]],
      [[]],
    );

    const result = await startOntologySuggestionScanJob({
      tenantId: "tenant-1",
      dedupeKey: "scan-key",
      db: db as any,
      invoke: false,
    });

    expect(result.id).toBe("existing-scan");
    expect(result.result).toMatchObject({
      previous: true,
      deduped: true,
      invoke: { state: "skipped" },
    });
  });

  it("keeps a failed scan job visible when Lambda dispatch fails", async () => {
    const previousFunctionName = process.env.ONTOLOGY_SCAN_FUNCTION_NAME;
    process.env.ONTOLOGY_SCAN_FUNCTION_NAME = "ontology-scan";
    const failedRow = scanRow({
      status: "failed",
      error: "invoke boom",
      result: { invoke: { state: "error", error: "invoke boom" } },
      metrics: { invokeFailure: true },
      finished_at: new Date("2026-05-17T12:01:00.000Z"),
    });
    const db = new FakeScanDb([[], [failedRow]], [[scanRow()]]);
    const lambdaClient = {
      send: vi.fn().mockRejectedValue(new Error("invoke boom")),
    };

    try {
      const result = await startOntologySuggestionScanJob({
        tenantId: "tenant-1",
        dedupeKey: "scan-key",
        db: db as any,
        lambdaClient,
      });

      expect(lambdaClient.send).toHaveBeenCalledTimes(1);
      expect(db.updates[0]).toMatchObject({
        status: "failed",
        error: "invoke boom",
        metrics: { invokeFailure: true },
      });
      expect(result.error).toBe("invoke boom");
      expect(result.result).toMatchObject({
        invoke: { state: "error", error: "invoke boom" },
      });
    } finally {
      if (previousFunctionName === undefined) {
        delete process.env.ONTOLOGY_SCAN_FUNCTION_NAME;
      } else {
        process.env.ONTOLOGY_SCAN_FUNCTION_NAME = previousFunctionName;
      }
    }
  });

  it("turns repeated customer commitments into a coherent change set", async () => {
    const features = extractOntologySuggestionFeatures({
      observations: [
        observation(
          "Acme was promised a rollout plan by 5/24 with Sara as owner.",
        ),
        observation("Marco committed to follow up with Acme on Friday."),
        observation("Acme renewal summary"),
      ],
      activeOntology: activeOntology(),
    });

    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: "tenant-1",
      features,
      activeOntology: activeOntology(),
      llmEnabled: false,
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.title).toBe("Customer commitment model");
    expect(proposals[0]?.items.map((item) => item.targetSlug)).toEqual(
      expect.arrayContaining([
        "commitment",
        "customer_has_commitment",
        "commitment_owned_by",
        "open_commitments",
      ]),
    );
    expect(proposals[0]?.items.every((item) => item.evidence.length > 0)).toBe(
      true,
    );
  });

  it("suggests support case facets without renaming customer", async () => {
    const features = extractOntologySuggestionFeatures({
      observations: [
        observation(
          "Case 123 is awaiting customer logs",
          "zendesk_support_case",
        ),
        observation(
          "Support ticket 456 is blocked on entitlement",
          "support_case",
        ),
      ],
      activeOntology: activeOntology(),
    });

    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: "tenant-1",
      features,
      activeOntology: activeOntology(),
      llmEnabled: false,
    });

    expect(proposals[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemType: "facet_template",
          targetSlug: "support_cases",
          proposedValue: expect.objectContaining({
            entityTypeSlug: "customer",
          }),
        }),
      ]),
    );
    expect(
      JSON.stringify(proposals).includes('"slug":"schema.org/Organization"'),
    ).toBe(false);
  });

  it("returns no proposals when there are no recurring patterns", async () => {
    const features = extractOntologySuggestionFeatures({
      observations: [
        observation("One-off note with no durable ontology signal."),
      ],
      activeOntology: activeOntology(),
    });

    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: "tenant-1",
      features,
      activeOntology: activeOntology(),
      llmEnabled: false,
    });

    expect(features).toEqual([]);
    expect(proposals).toEqual([]);
  });

  it("re-anchors the scan on observation ingest run drop evidence first", async () => {
    const db = new FakeSourceDb([
      // observation ingest runs (primary source — queried first)
      [
        {
          id: "run-1",
          status: "succeeded",
          metrics: {
            unapprovedNodeCount: 2,
            droppedNodeSamples: [
              {
                id: "node-1",
                label: "Sprocket Inc",
                rawType: "vendor",
                dropReason: "unapproved_entity_type",
                propertyKeys: [],
              },
              {
                id: "node-2",
                label: "Gear Co",
                rawType: "Vendor",
                dropReason: "unapproved_entity_type",
                propertyKeys: [],
              },
              {
                id: "node-3",
                label: "doc-chunk",
                rawType: "document",
                dropReason: "structural_node",
                propertyKeys: [],
              },
            ],
          },
          finishedAt: new Date("2026-06-08T12:00:00.000Z"),
          createdAt: new Date("2026-06-08T11:59:00.000Z"),
        },
      ],
      [],
      [],
      [],
    ]);

    const result = await collectOntologySuggestionSources({
      tenantId: "tenant-1",
      db: db as any,
      memoryAdapter: {
        kind: "hindsight" as const,
        inspect: vi.fn().mockResolvedValue([]),
      },
    });

    expect(result.providerStatuses[0]).toEqual({
      provider: "observation_runs",
      state: "ok",
      count: 2,
    });
    const runObservations = result.observations.filter(
      (observation) => observation.metadata?.observationRunId === "run-1",
    );
    expect(runObservations).toHaveLength(2);
    expect(runObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "ontology_gate_rejection",
          sourceRef: "observation_run:run-1",
          sourceLabel: "Sprocket Inc",
          text: expect.stringContaining('unapproved entity type "vendor"'),
          metadata: expect.objectContaining({
            observationRunId: "run-1",
            entitySubtype: "vendor",
            dropReason: "unapproved_entity_type",
            unapprovedNodeCount: 2,
          }),
        }),
      ]),
    );
    // Structural extractor plumbing nodes are not ontology signal.
    expect(
      runObservations.some(
        (observation) => observation.metadata?.graphNodeId === "node-3",
      ),
    ).toBe(false);

    const features = extractOntologySuggestionFeatures({
      observations: result.observations,
      activeOntology: activeOntology(),
    });
    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: "tenant-1",
      features,
      activeOntology: activeOntology(),
      llmEnabled: false,
    });

    expect(proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "rejected-vendor-entity-type",
          items: expect.arrayContaining([
            expect.objectContaining({
              itemType: "entity_type",
              targetSlug: "vendor",
              evidence: expect.arrayContaining([
                expect.objectContaining({
                  sourceRef: "observation_run:run-1",
                }),
              ]),
            }),
          ]),
        }),
      ]),
    );
  });

  it("does not surface drop evidence for entity types that are already approved", async () => {
    const db = new FakeSourceDb([
      [
        {
          id: "run-2",
          status: "succeeded",
          metrics: {
            unapprovedNodeCount: 2,
            droppedNodeSamples: [
              {
                id: "node-1",
                label: "Acme",
                rawType: "customer",
                dropReason: "unapproved_entity_type",
                propertyKeys: [],
              },
              {
                id: "node-2",
                label: "Initech",
                rawType: "customer",
                dropReason: "unapproved_entity_type",
                propertyKeys: [],
              },
            ],
          },
          finishedAt: new Date("2026-06-08T12:00:00.000Z"),
          createdAt: new Date("2026-06-08T11:59:00.000Z"),
        },
      ],
      [],
      [],
      [],
    ]);

    const result = await collectOntologySuggestionSources({
      tenantId: "tenant-1",
      db: db as any,
      memoryAdapter: {
        kind: "hindsight" as const,
        inspect: vi.fn().mockResolvedValue([]),
      },
    });
    const features = extractOntologySuggestionFeatures({
      observations: result.observations,
      // `customer` is already in the active ontology.
      activeOntology: activeOntology(),
    });

    expect(
      features.filter((feature) => feature.kind === "rejected_entity_type"),
    ).toEqual([]);
  });

  it("collects Hindsight memory records as ontology suggestion evidence", async () => {
    const db = new FakeSourceDb([
      [],
      [],
      [],
      [{ id: "user-1", email: "eric@example.com", name: "Eric" }],
    ]);
    const memoryAdapter = {
      kind: "hindsight" as const,
      inspect: vi.fn().mockResolvedValue([
        {
          id: "mem-1",
          tenantId: "tenant-1",
          ownerType: "user",
          ownerId: "user-1",
          threadId: "thread-1",
          kind: "unit",
          sourceType: "thread_turn",
          status: "active",
          content: {
            text: "Acme was promised a rollout plan by 5/24 with Sara as owner.",
          },
          backendRefs: [{ backend: "hindsight", ref: "user_user-1" }],
          createdAt: "2026-05-17T12:00:00.000Z",
          metadata: { fact_type: "observation" },
        },
      ]),
    };

    const result = await collectOntologySuggestionSources({
      tenantId: "tenant-1",
      db: db as any,
      memoryAdapter,
    });

    expect(memoryAdapter.inspect).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerType: "user",
        ownerId: "user-1",
      }),
    );
    expect(result.providerStatuses).toContainEqual({
      provider: "hindsight",
      state: "ok",
      count: 1,
    });
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "hindsight_memory_unit",
          sourceRef: "mem-1",
          text: expect.stringContaining("rollout plan"),
          metadata: expect.objectContaining({
            ownerId: "user-1",
            threadId: "thread-1",
            factType: "observation",
          }),
        }),
      ]),
    );
  });

  it("includes unresolved ontology-gate rejections as suggestion evidence", async () => {
    const db = new FakeSourceDb([
      [],
      [],
      [
        {
          id: "mention-1",
          alias: "Sprocket Inc",
          mentionCount: 2,
          suggestedType: "entity",
          entitySubtype: "vendor",
          sampleContexts: [
            {
              quote: "Rejected ontology candidate: Sprocket Inc",
              source_ref: "r1",
            },
          ],
          lastSeenAt: new Date("2026-05-17T12:00:00.000Z"),
        },
      ],
      [],
    ]);

    const result = await collectOntologySuggestionSources({
      tenantId: "tenant-1",
      db: db as any,
      memoryAdapter: {
        kind: "hindsight" as const,
        inspect: vi.fn().mockResolvedValue([]),
      },
    });

    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "ontology_gate_rejection",
          sourceRef: "mention-1",
          text: expect.stringContaining("entity type vendor"),
        }),
      ]),
    );

    const features = extractOntologySuggestionFeatures({
      observations: result.observations,
      activeOntology: activeOntology(),
    });
    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: "tenant-1",
      features,
      activeOntology: activeOntology(),
      llmEnabled: false,
    });

    expect(proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "rejected-vendor-entity-type",
          items: expect.arrayContaining([
            expect.objectContaining({
              itemType: "entity_type",
              targetSlug: "vendor",
            }),
          ]),
        }),
      ]),
    );
  });

  it("fails malformed model JSON instead of persisting partial suggestions", () => {
    expect(() =>
      parseOntologySynthesisResponse("{ this is not json", []),
    ).toThrow(/parseJsonResponse|JSON/);
    expect(() =>
      parseOntologySynthesisResponse(
        JSON.stringify({ proposals: [{ title: "Missing items" }] }),
        [],
      ),
    ).toThrow(/has no items/);
  });
});

describe("untyped-entity scan source (KTD-2)", () => {
  it("collects untyped kg entities as clustered candidate material", async () => {
    const db = new FakeSourceDb([
      [],
      [],
      [],
      [],
      [
        {
          id: "kg-1",
          label: "Sprocket Inc",
          typeLabel: "vendor",
          summary: null,
          lastSeenAt: new Date("2026-07-01T12:00:00.000Z"),
          updatedAt: new Date("2026-07-01T12:00:00.000Z"),
        },
        {
          id: "kg-2",
          label: "Gear Co",
          typeLabel: "Vendor",
          summary: "Supplies gears.",
          lastSeenAt: null,
          updatedAt: new Date("2026-07-02T12:00:00.000Z"),
        },
      ],
    ]);

    const result = await collectOntologySuggestionSources({
      tenantId: "tenant-1",
      db: db as any,
      memoryAdapter: {
        kind: "hindsight" as const,
        inspect: vi.fn().mockResolvedValue([]),
      },
    });

    expect(result.providerStatuses).toContainEqual({
      provider: "untyped_entities",
      state: "ok",
      count: 2,
    });
    const untyped = result.observations.filter(
      (observation) => observation.sourceKind === "untyped_kg_entity",
    );
    expect(untyped).toHaveLength(2);
    expect(untyped[0]).toMatchObject({
      sourceRef: "kg_entity:kg-1",
      metadata: expect.objectContaining({
        kgEntityId: "kg-1",
        entitySubtype: "vendor",
      }),
    });
  });

  it("clusters untyped entities into at most one candidate per proposed type", async () => {
    const untypedObservation = (
      id: string,
      slug: string,
    ): OntologySuggestionObservation => ({
      sourceKind: "untyped_kg_entity",
      sourceRef: `kg_entity:${id}`,
      sourceLabel: id,
      quote: `Entity ${id} has raw type ${slug}.`,
      text: `Entity ${id} has raw type ${slug}.`,
      observedAt: "2026-07-01T12:00:00.000Z",
      metadata: { kgEntityId: id, entitySubtype: slug },
    });

    const features = extractOntologySuggestionFeatures({
      observations: [
        untypedObservation("kg-1", "vendor"),
        untypedObservation("kg-2", "vendor"),
        untypedObservation("kg-3", "vendor"),
        // Below the cluster minimum — no feature, no candidate.
        untypedObservation("kg-4", "supplier"),
        // Already approved — never a candidate.
        untypedObservation("kg-5", "customer"),
        untypedObservation("kg-6", "customer"),
      ],
      activeOntology: activeOntology(),
    });

    const clusterFeatures = features.filter(
      (feature) => feature.kind === "untyped_entity_cluster",
    );
    expect(clusterFeatures).toHaveLength(1);
    expect(clusterFeatures[0]).toMatchObject({
      frequency: 3,
      metadata: { entityTypeSlug: "vendor" },
    });

    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: "tenant-1",
      features,
      activeOntology: activeOntology(),
      llmEnabled: false,
    });

    const vendorProposals = proposals.filter((proposal) =>
      proposal.items.some(
        (item) =>
          item.itemType === "entity_type" && item.targetSlug === "vendor",
      ),
    );
    expect(vendorProposals).toHaveLength(1);
    expect(vendorProposals[0]?.key).toBe("untyped-vendor-entity-type");
    expect(vendorProposals[0]?.items[0]?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceRef: "kg_entity:kg-1" }),
      ]),
    );
  });

  it("keeps one candidate when a rejected-entity-type feature already proposes the slug", async () => {
    const features = extractOntologySuggestionFeatures({
      observations: [
        {
          sourceKind: "ontology_gate_rejection",
          sourceRef: "mention-1",
          sourceLabel: "Sprocket Inc",
          quote: "Rejected vendor candidate",
          text: "Rejected vendor candidate",
          observedAt: "2026-07-01T12:00:00.000Z",
          metadata: { entitySubtype: "vendor", mentionCount: 2 },
        },
        {
          sourceKind: "untyped_kg_entity",
          sourceRef: "kg_entity:kg-1",
          sourceLabel: "kg-1",
          quote: "Untyped vendor entity",
          text: "Untyped vendor entity",
          observedAt: "2026-07-01T12:00:00.000Z",
          metadata: { kgEntityId: "kg-1", entitySubtype: "vendor" },
        },
        {
          sourceKind: "untyped_kg_entity",
          sourceRef: "kg_entity:kg-2",
          sourceLabel: "kg-2",
          quote: "Untyped vendor entity 2",
          text: "Untyped vendor entity 2",
          observedAt: "2026-07-01T12:00:00.000Z",
          metadata: { kgEntityId: "kg-2", entitySubtype: "vendor" },
        },
      ],
      activeOntology: activeOntology(),
    });

    const proposals = await synthesizeOntologyChangeSetProposals({
      tenantId: "tenant-1",
      features,
      activeOntology: activeOntology(),
      llmEnabled: false,
    });

    expect(
      proposals.filter((proposal) =>
        proposal.items.some(
          (item) =>
            item.itemType === "entity_type" && item.targetSlug === "vendor",
        ),
      ),
    ).toHaveLength(1);
  });
});

describe("persistOntologyChangeSetProposals (KTD-4 upsert)", () => {
  it("drops fingerprinted candidates before any write (AE5/R13)", async () => {
    const queues = emptyPersistContext();
    queues.set(ontologyCandidateRejections, [
      [{ fingerprint: "entity_type:commitment" }],
    ]);
    const db = new FakePersistDb(queues);

    const result = await persistOntologyChangeSetProposals({
      tenantId: "tenant-1",
      jobId: "job-1",
      proposals: [proposalWith()],
      db: db as any,
    });

    expect(result.skippedRejectedSlugs).toEqual(["commitment"]);
    expect(result.createdChangeSetIds).toEqual([]);
    expect(result.updatedChangeSetIds).toEqual([]);
    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it("upserts by slug: preserves operator editedValue and unions evidence", async () => {
    const queues = emptyPersistContext();
    queues.set(ontologyChangeSets, [
      [
        {
          id: "set-1",
          tenant_id: "tenant-1",
          title: "Customer commitment model",
          proposed_by: "suggestion_engine",
          status: "pending_review",
        },
      ],
    ]);
    queues.set(ontologyChangeSetItems, [
      [
        {
          id: "item-1",
          change_set_id: "set-1",
          item_type: "entity_type",
          target_slug: "commitment",
          proposed_value: { slug: "commitment", name: "Old Commitment" },
          edited_value: { slug: "commitment", name: "Operator Edit" },
          status: "pending_review",
          position: 0,
        },
      ],
    ]);
    queues.set(ontologyEvidenceExamples, [
      [
        {
          source_kind: "brain_section",
          source_ref: "evidence-1",
          quote: "Acme was promised a rollout plan.",
        },
      ],
    ]);
    const db = new FakePersistDb(queues);

    const proposal = proposalWith();
    proposal.items[0]!.evidence.push({
      sourceKind: "brain_section",
      sourceRef: "evidence-2",
      sourceLabel: "Acme",
      quote: "Marco committed to follow up on Friday.",
      observedAt: "2026-06-01T12:00:00.000Z",
      metadata: {},
    });

    const result = await persistOntologyChangeSetProposals({
      tenantId: "tenant-1",
      jobId: "job-2",
      proposals: [proposal],
      db: db as any,
    });

    expect(result.mergedItemIds).toEqual(["item-1"]);
    expect(result.updatedChangeSetIds).toEqual(["set-1"]);
    expect(result.createdChangeSetIds).toEqual([]);

    // The merge updates the proposal in place and never touches edited_value.
    const itemUpdates = db.updates.filter(
      (update) => update.table === ontologyChangeSetItems,
    );
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0]!.patch).toMatchObject({
      proposed_value: { slug: "commitment", name: "Commitment" },
      status: "pending_review",
    });
    expect(itemUpdates[0]!.patch).not.toHaveProperty("edited_value");

    // Evidence unions: only the genuinely new quote is inserted.
    const evidenceInserts = db.inserts.filter(
      (insert) => insert.table === ontologyEvidenceExamples,
    );
    expect(evidenceInserts).toHaveLength(1);
    const insertedEvidence = evidenceInserts[0]!.values as Array<
      Record<string, unknown>
    >;
    expect(insertedEvidence).toHaveLength(1);
    expect(insertedEvidence[0]).toMatchObject({
      item_id: "item-1",
      source_ref: "evidence-2",
    });

    // No delete-reinsert: no change-set or item rows were inserted.
    expect(
      db.inserts.filter((insert) => insert.table === ontologyChangeSetItems),
    ).toEqual([]);
  });

  it("inserts fresh proposals with scan provenance on evidence", async () => {
    const db = new FakePersistDb(emptyPersistContext());

    const result = await persistOntologyChangeSetProposals({
      tenantId: "tenant-1",
      jobId: "job-3",
      proposals: [proposalWith()],
      db: db as any,
    });

    expect(result.createdChangeSetIds).toHaveLength(1);
    const changeSetInserts = db.inserts.filter(
      (insert) => insert.table === ontologyChangeSets,
    );
    expect(changeSetInserts).toHaveLength(1);
    expect(changeSetInserts[0]!.values).toMatchObject({
      proposed_by: "suggestion_engine",
      status: "pending_review",
    });
    const itemInserts = db.inserts.filter(
      (insert) => insert.table === ontologyChangeSetItems,
    );
    expect(itemInserts).toHaveLength(1);
    expect(itemInserts[0]!.values).toMatchObject({
      target_slug: "commitment",
      position: 0,
    });
    const evidenceInserts = db.inserts.filter(
      (insert) => insert.table === ontologyEvidenceExamples,
    );
    expect(evidenceInserts).toHaveLength(1);
    expect(
      (evidenceInserts[0]!.values as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      metadata: expect.objectContaining({
        scanJobId: "job-3",
        proposalKey: "test-proposal",
      }),
    });
  });

  it("surfaces approved-definition collisions as conflicts, never duplicates (R14)", async () => {
    const queues = emptyPersistContext();
    queues.set(ontologyEntityTypes, [[{ slug: "commitment" }]]);
    const db = new FakePersistDb(queues);

    const result = await persistOntologyChangeSetProposals({
      tenantId: "tenant-1",
      jobId: "job-4",
      proposals: [proposalWith()],
      db: db as any,
    });

    expect(result.conflicts).toEqual([
      {
        slug: "commitment",
        itemType: "entity_type",
        reason: "approved_definition",
      },
    ]);
    expect(db.inserts).toEqual([]);
  });

  it("drops zero-evidence items for scans but keeps them for pack installs", async () => {
    const zeroEvidenceProposal = (): OntologyChangeSetProposal => {
      const proposal = proposalWith();
      proposal.items[0]!.evidence = [];
      return proposal;
    };

    const scanDb = new FakePersistDb(emptyPersistContext());
    const scanResult = await persistOntologyChangeSetProposals({
      tenantId: "tenant-1",
      jobId: "job-5",
      proposals: [zeroEvidenceProposal()],
      db: scanDb as any,
    });
    expect(scanResult.createdChangeSetIds).toEqual([]);
    expect(scanDb.inserts).toEqual([]);

    const packDb = new FakePersistDb(emptyPersistContext());
    const packResult = await persistOntologyChangeSetProposals({
      tenantId: "tenant-1",
      proposals: [zeroEvidenceProposal()],
      proposedBy: "pack_install",
      db: packDb as any,
    });
    expect(packResult.createdChangeSetIds).toHaveLength(1);
    const changeSetInserts = packDb.inserts.filter(
      (insert) => insert.table === ontologyChangeSets,
    );
    expect(changeSetInserts[0]!.values).toMatchObject({
      proposed_by: "pack_install",
    });
  });
});
