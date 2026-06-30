import { describe, expect, it } from "vitest";

import {
  LAYERS,
  LAYER_STATUSES,
  OPPORTUNITY_TABS,
  PROTOTYPE_PAGES,
  STAGES,
  STAGE_GUIDANCE,
  TOOL_STEPS,
  stageIndex,
} from "./fixtures/prototype-pages";
import {
  PROTOTYPE_LOCAL_STORAGE_PATTERNS,
  PROTOTYPE_OPPORTUNITY_SEEDS,
  PROTOTYPE_OVERLAY_BUCKETS,
  PROTOTYPE_PIPELINE_SEED,
} from "./fixtures/prototype-seed-data";

describe("Twenty client engagement prototype behavior", () => {
  it("represents every prototype page in the app route model", () => {
    expect(PROTOTYPE_PAGES.map((page) => page.prototypeFile)).toEqual([
      "client-dashboard.html",
      "discovery-value-alignment.html",
      "discovery-presession-brief.html",
      "discovery-tool-guide.html",
      "discovery-tool.html",
      "opportunity-pipeline.html",
    ]);
    expect(new Set(PROTOTYPE_PAGES.map((page) => page.routeSegment)).size).toBe(
      PROTOTYPE_PAGES.length,
    );
  });

  it("keeps stage labels, guidance, and unlock order aligned to the prototype", () => {
    expect(STAGES.map((stage) => [stage.value, stage.label])).toEqual([
      ["IDENTIFIED", "Identified"],
      ["VALUE_ALIGNMENT", "Value Alignment"],
      ["DISCOVERY_SCOPE", "Discovery & Scope"],
      ["SOW_DELIVERED", "SOW Delivered"],
      ["ACTIVE_ENGAGEMENT", "Active Engagement"],
      ["CLOSED_LOST", "Closed Lost"],
      ["DEFERRED", "Deferred"],
    ]);
    expect(stageIndex("SOW_DELIVERED")).toBe(3);
    expect(stageIndex("ACTIVE_ENGAGEMENT")).toBe(4);
    expect(STAGE_GUIDANCE).toHaveLength(5);
    expect(
      OPPORTUNITY_TABS.filter((tab) => tab.minStage).map((tab) => [
        tab.label,
        tab.minStage,
        tab.lockedLabel,
      ]),
    ).toEqual([
      ["Baseline Capture", "SOW_DELIVERED", "Available after SOW is delivered"],
      ["KPI Framework", "SOW_DELIVERED", "Available after SOW is delivered"],
      [
        "30/60/90 Check-ins",
        "ACTIVE_ENGAGEMENT",
        "Available after engagement is active",
      ],
      [
        "Executive View",
        "ACTIVE_ENGAGEMENT",
        "Available after engagement is active",
      ],
    ]);
  });

  it("keeps layer types and statuses aligned to the prototype", () => {
    expect(LAYERS.map((layer) => [layer.type, layer.label])).toEqual([
      ["CORE_PROBLEM", "Core Problem"],
      ["OPTIMIZATION", "Optimization Opportunity"],
      ["STRATEGIC_CONTROL", "Strategic Control"],
    ]);
    expect(
      LAYER_STATUSES.map((status) => [status.value, status.label]),
    ).toEqual([
      ["IDENTIFIED", "Identified"],
      ["IN_DISCOVERY", "In Discovery"],
      ["QUALIFYING", "Qualifying"],
      ["READY_FOR_SOW", "Ready for SOW"],
      ["APPROVED", "Approved"],
      ["DEFERRED", "Deferred"],
    ]);
  });

  it("models disabled prototype tool actions as coming-soon actions", () => {
    const sowStep = TOOL_STEPS.find((step) => step.name === "SOW");

    expect(TOOL_STEPS.map((step) => step.step)).toEqual([
      "Step 1",
      "Step 2",
      "Step 3",
      "Step 4",
    ]);
    expect(sowStep).toMatchObject({
      pageId: null,
      prototypeUrl: null,
      activeStages: ["SOW_DELIVERED"],
      doneStages: ["ACTIVE_ENGAGEMENT"],
    });
    expect(sowStep?.disabledReason).toContain("placeholder");
  });

  it("maps every prototype localStorage bucket to plugin app overlay state", () => {
    expect(
      PROTOTYPE_LOCAL_STORAGE_PATTERNS.map((pattern) =>
        PROTOTYPE_OVERLAY_BUCKETS.some((bucket) =>
          bucket.legacyKeyPattern.startsWith(pattern),
        ),
      ),
    ).toEqual(PROTOTYPE_LOCAL_STORAGE_PATTERNS.map(() => true));
    expect(
      PROTOTYPE_OVERLAY_BUCKETS.map((bucket) => [
        bucket.legacyKeyPattern,
        bucket.scope,
        bucket.providerRecordType,
      ]),
    ).toEqual([
      ["tw_acct_v1_<companyId>", "company", "company"],
      ["tw_opp_v1_<opportunityId>", "opportunity", "opportunity"],
      ["tw_client_<clientName>", "company", "company"],
      ["tw_opp_pipeline_v3", "app", "app"],
    ]);
    for (const bucket of PROTOTYPE_OVERLAY_BUCKETS) {
      expect(bucket.sectionKeys.length).toBeGreaterThan(0);
      expect(bucket.sourcePages.length).toBeGreaterThan(0);
    }
  });

  it("captures prototype seed records needed by the React conversion", () => {
    expect(PROTOTYPE_OPPORTUNITY_SEEDS.map((seed) => seed.id)).toEqual([
      "c203680f-4d36-461b-b134-25aef43d62c5",
      "a3754b84-3fc4-4ad1-adeb-99c19cf7a019",
    ]);
    expect(PROTOTYPE_PIPELINE_SEED).toMatchObject({
      storageKey: "tw_opp_pipeline_v3",
      useCaseAccountCount: 1,
      strategicOpportunityCount: 3,
      layerTitles: [
        "Core Problem",
        "Optimization Opportunity",
        "Strategic Control",
      ],
    });
  });
});
