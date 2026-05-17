import { describe, expect, it, vi } from "vitest";
import {
  buildOntologyScanDedupeKey,
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
