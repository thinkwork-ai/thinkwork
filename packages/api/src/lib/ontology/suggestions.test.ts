import { describe, expect, it, vi } from "vitest";
import {
  buildOntologyScanDedupeKey,
  collectOntologySuggestionSources,
  extractOntologySuggestionFeatures,
  parseOntologySynthesisResponse,
  startOntologySuggestionScanJob,
  synthesizeOntologyChangeSetProposals,
  type ActiveOntologySnapshot,
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
    // Structural Cognee plumbing nodes are not ontology signal.
    expect(
      runObservations.some(
        (observation) => observation.metadata?.cogneeNodeId === "node-3",
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
