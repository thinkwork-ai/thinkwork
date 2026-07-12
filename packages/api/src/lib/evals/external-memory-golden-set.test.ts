import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOLDEN_EXPECTATIONS,
  checkClaimFaithfulness,
  checkDuplicatePageRate,
  checkEntityPrecision,
  checkProvenanceCompleteness,
  checkRetractionCorrectness,
  collectGoldenSetSnapshot,
  evaluateGoldenSet,
  type GoldenSetExpectations,
  type GoldenSetReaders,
  type GoldenSetSnapshot,
} from "./external-memory-golden-set.js";

const EXPECTATIONS: GoldenSetExpectations = {
  entityName: "Acme",
  nameVariants: ["acme", "acme corp"],
  activeClaims: [
    { ontologyPredicate: "customer.name", valueHash: "hash-name" },
    { ontologyPredicate: "customer.domain" },
  ],
  retractedValueFragments: ["annual revenue 5,000"],
};

function healthySnapshot(): GoldenSetSnapshot {
  return {
    canonicalEntities: [
      {
        id: "ce-1",
        displayName: "Acme",
        normalizedName: "acme",
        status: "active",
      },
      // Merged duplicates do not count against precision.
      {
        id: "ce-2",
        displayName: "Acme Corp",
        normalizedName: "acme corp",
        status: "merged",
      },
    ],
    entityPages: [
      {
        id: "page-1",
        canonicalEntityId: "ce-1",
        title: "Acme",
        status: "active",
        sectionSourceRefs: ["mem-1", "mem-2"],
      },
    ],
    claims: [
      {
        id: "claim-1",
        subjectKey: "twenty:company:co-1",
        ontologyPredicate: "customer.name",
        valueHash: "hash-name",
        status: "active",
        effectiveTo: null,
        activeEvidenceEdges: 2,
      },
      {
        id: "claim-2",
        subjectKey: "web:page:https://acme.com",
        ontologyPredicate: "customer.domain",
        valueHash: "hash-domain",
        status: "active",
        effectiveTo: null,
        activeEvidenceEdges: 1,
      },
      {
        id: "claim-3",
        subjectKey: "twenty:company:co-1",
        ontologyPredicate: "customer.annual_recurring_revenue",
        valueHash: "hash-arr",
        status: "retracted",
        effectiveTo: new Date("2026-07-11T00:00:00.000Z"),
        activeEvidenceEdges: 0,
      },
    ],
    recallHits: [{ text: "Acme is headquartered in Springfield." }],
  };
}

describe("evaluateGoldenSet", () => {
  it("passes on a healthy cross-source snapshot", () => {
    const result = evaluateGoldenSet(healthySnapshot(), EXPECTATIONS);
    expect(result.pass).toBe(true);
    expect(result.checks.map((c) => c.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
  });

  it("is deterministic across runs", () => {
    const a = evaluateGoldenSet(healthySnapshot(), EXPECTATIONS);
    const b = evaluateGoldenSet(healthySnapshot(), EXPECTATIONS);
    expect(a).toEqual(b);
  });
});

describe("entity_precision", () => {
  it("fails when two active canonical entities share the golden identity", () => {
    const snapshot = healthySnapshot();
    snapshot.canonicalEntities.push({
      id: "ce-3",
      displayName: "ACME Inc",
      normalizedName: "acme",
      status: "active",
    });
    const check = checkEntityPrecision(snapshot, EXPECTATIONS);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("2 active canonical entities");
  });

  it("fails when no active canonical entity exists", () => {
    const snapshot = healthySnapshot();
    snapshot.canonicalEntities = [];
    expect(checkEntityPrecision(snapshot, EXPECTATIONS).status).toBe("fail");
  });
});

describe("duplicate_page_rate", () => {
  it("fails when two active pages share one canonical id", () => {
    const snapshot = healthySnapshot();
    snapshot.entityPages.push({
      id: "page-2",
      canonicalEntityId: "ce-1",
      title: "Acme (dup)",
      status: "active",
      sectionSourceRefs: ["mem-3"],
    });
    const check = checkDuplicatePageRate(snapshot);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("2 active pages");
  });

  it("fails when a same-name page exists WITHOUT a canonical id", () => {
    const snapshot = healthySnapshot();
    snapshot.entityPages.push({
      id: "page-2",
      canonicalEntityId: null,
      title: "Acme Corp",
      status: "active",
      sectionSourceRefs: [],
    });
    const check = checkDuplicatePageRate(snapshot);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("without a canonical id");
  });

  it("ignores archived duplicates", () => {
    const snapshot = healthySnapshot();
    snapshot.entityPages.push({
      id: "page-2",
      canonicalEntityId: "ce-1",
      title: "Acme (old)",
      status: "archived",
      sectionSourceRefs: [],
    });
    expect(checkDuplicatePageRate(snapshot).status).toBe("pass");
  });
});

describe("claim_faithfulness", () => {
  it("fails when an expected active claim is missing", () => {
    const snapshot = healthySnapshot();
    snapshot.claims = snapshot.claims.filter(
      (c) => c.ontologyPredicate !== "customer.domain",
    );
    const check = checkClaimFaithfulness(snapshot, EXPECTATIONS);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("customer.domain");
  });

  it("fails when the active value hash differs from the fixture", () => {
    const snapshot = healthySnapshot();
    snapshot.claims[0]!.valueHash = "hash-other";
    const check = checkClaimFaithfulness(snapshot, EXPECTATIONS);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("value hash");
  });

  it("fails temporal closure when a retracted claim has an open interval", () => {
    const snapshot = healthySnapshot();
    snapshot.claims[2]!.effectiveTo = null;
    const check = checkClaimFaithfulness(snapshot, EXPECTATIONS);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("OPEN interval");
  });
});

describe("provenance_completeness", () => {
  it("fails when an active claim has zero active evidence edges", () => {
    const snapshot = healthySnapshot();
    snapshot.claims[0]!.activeEvidenceEdges = 0;
    const check = checkProvenanceCompleteness(snapshot);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("zero active evidence edges");
  });

  it("fails when the canonical page has no section sources", () => {
    const snapshot = healthySnapshot();
    snapshot.entityPages[0]!.sectionSourceRefs = [];
    const check = checkProvenanceCompleteness(snapshot);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("zero section sources");
  });
});

describe("retraction_correctness", () => {
  it("fails when a retracted value fragment appears in recall", () => {
    const snapshot = healthySnapshot();
    snapshot.recallHits = [
      { text: "Acme annual revenue 5,000,000 USD per the CRM." },
    ];
    const check = checkRetractionCorrectness(snapshot, EXPECTATIONS);
    expect(check.status).toBe("fail");
    expect(check.details[0]).toContain("still present in recall");
  });

  it("reports skipped (not pass) when recall is unavailable but fragments are expected", () => {
    const snapshot = healthySnapshot();
    snapshot.recallHits = null;
    const check = checkRetractionCorrectness(snapshot, EXPECTATIONS);
    expect(check.status).toBe("skipped");
  });

  it("skipped checks do not fail the overall result", () => {
    const snapshot = healthySnapshot();
    snapshot.recallHits = null;
    expect(evaluateGoldenSet(snapshot, EXPECTATIONS).pass).toBe(true);
  });
});

describe("collectGoldenSetSnapshot", () => {
  it("wires injected readers and only passes ACTIVE canonical ids downstream", async () => {
    const calls: Record<string, unknown[]> = {};
    const readers: GoldenSetReaders = {
      async findCanonicalEntities(variants) {
        calls.find = [variants];
        return [
          {
            id: "ce-1",
            displayName: "Acme",
            normalizedName: "acme",
            status: "active",
          },
          {
            id: "ce-9",
            displayName: "Acme Old",
            normalizedName: "acme",
            status: "merged",
          },
        ];
      },
      async listEntityPages(ids, variants) {
        calls.pages = [ids, variants];
        return [];
      },
      async listClaims(ids) {
        calls.claims = [ids];
        return [];
      },
      async recall(query) {
        calls.recall = [query];
        return null;
      },
    };
    const snapshot = await collectGoldenSetSnapshot(
      readers,
      DEFAULT_GOLDEN_EXPECTATIONS,
    );
    expect(calls.find).toEqual([DEFAULT_GOLDEN_EXPECTATIONS.nameVariants]);
    expect(calls.pages?.[0]).toEqual(["ce-1"]);
    expect(calls.claims).toEqual([["ce-1"]]);
    expect(calls.recall).toEqual(["Acme"]);
    expect(snapshot.canonicalEntities).toHaveLength(2);
    expect(snapshot.recallHits).toBeNull();
  });
});
