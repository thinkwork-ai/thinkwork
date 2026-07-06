/**
 * Plate registry GraphQL surface (THINK-153 U3): permissions, three-gate save
 * validation, R4/R5 semantics, preview behavior, palette sibling
 * preservation. Real resolution + validation logic runs; the DB and authz
 * layers are mocked at their module seams.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlateRow } from "../../../lib/artifacts/plate-registry.js";

const mocks = vi.hoisted(() => ({
  requireTenantAdmin: vi.fn(),
  requireTenantMember: vi.fn(),
  resolveCallerTenantId: vi.fn(),
  // Fake plate store state
  rows: [] as Array<{
    slug: string;
    origin: string;
    config: Record<string, unknown>;
    hidden: boolean;
  }>,
  tenantPalette: { light: {}, dark: {} } as {
    light: Record<string, string>;
    dark: Record<string, string>;
  },
  // DB write/read recording
  inserted: [] as Array<Record<string, unknown>>,
  deleted: 0,
  artifactRefs: [] as Array<{ id: string }>,
  settingsRow: null as null | { id: string; features: unknown },
  settingsUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mocks.requireTenantAdmin,
  requireTenantMember: mocks.requireTenantMember,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mocks.resolveCallerTenantId,
}));

vi.mock("../../../lib/artifacts/plate-registry.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../lib/artifacts/plate-registry.js")
    >();
  const fakeStore = () => ({
    getPlateRow: async (_t: string, slug: string) =>
      (mocks.rows.find((r) => r.slug === slug) as PlateRow | undefined) ?? null,
    listPlateRows: async () => mocks.rows as PlateRow[],
    getTenantDocumentPalette: async () => mocks.tenantPalette,
  });
  return { ...actual, drizzlePlateStore: fakeStore };
});

vi.mock("@thinkwork/database-pg", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@thinkwork/database-pg")>()),
  getDb: () => ({
    select: (_fields?: unknown) => ({
      from: (table: { _tableName?: string } & Record<string, unknown>) => ({
        where: () => ({
          limit: () => {
            // artifacts reference check vs tenant_settings read — decide by
            // the table object's known columns.
            if ("s3_key" in table || "thread_id" in table) {
              return Promise.resolve(mocks.artifactRefs);
            }
            return Promise.resolve(
              mocks.settingsRow ? [mocks.settingsRow] : [],
            );
          },
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.inserted.push(values);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.settingsUpdates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
    delete: () => ({
      where: () => {
        mocks.deleted += 1;
        return Promise.resolve();
      },
    }),
  }),
}));

import {
  boundedAnalyses,
  boundedSections,
  boundedSectionOverrides,
  parseDraftConfig,
  validateCandidatePlate,
} from "./shared.js";
import { documentPlates } from "./documentPlates.query.js";
import { documentPlatePreview } from "./documentPlatePreview.query.js";
import { saveDocumentPlate } from "./saveDocumentPlate.mutation.js";
import { deleteDocumentPlate } from "./deleteDocumentPlate.mutation.js";
import { updateTenantDocumentPalette } from "./updateTenantDocumentPalette.mutation.js";

const TENANT = "00000000-0000-0000-0000-000000000001";
const ctx = {
  auth: { tenantId: TENANT, principalId: "user-1", authType: "cognito" },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.tenantPalette = { light: {}, dark: {} };
  mocks.inserted = [];
  mocks.deleted = 0;
  mocks.artifactRefs = [];
  mocks.settingsRow = null;
  mocks.settingsUpdates = [];
  mocks.requireTenantMember.mockResolvedValue("member");
  mocks.requireTenantAdmin.mockResolvedValue("admin");
});

describe("documentPlates query", () => {
  it("lists the platform library for members; hidden plates only for operators", async () => {
    mocks.rows = [
      {
        slug: "ideation",
        origin: "platform_override",
        config: {},
        hidden: true,
      },
    ];
    const memberView = (await documentPlates({}, {}, ctx)) as Array<{
      slug: string;
    }>;
    expect(memberView.map((p) => p.slug)).not.toContain("ideation");
    expect(memberView.map((p) => p.slug)).toContain("qbr");

    mocks.requireTenantMember.mockResolvedValue("admin");
    const operatorView = (await documentPlates({}, {}, ctx)) as Array<{
      slug: string;
      hidden: boolean;
    }>;
    expect(operatorView.find((p) => p.slug === "ideation")?.hidden).toBe(true);
  });

  it("marks customized platform plates and surfaces their overrides", async () => {
    mocks.rows = [
      {
        slug: "qbr",
        origin: "platform_override",
        config: { paletteLight: { "--accent": "#aa0000" } },
        hidden: false,
      },
    ];
    const view = (await documentPlates({}, {}, ctx)) as Array<{
      slug: string;
      customized: boolean;
      overrides: string | null;
      tokensLight: string;
    }>;
    const qbr = view.find((p) => p.slug === "qbr")!;
    expect(qbr.customized).toBe(true);
    expect(JSON.parse(qbr.overrides!)).toEqual({
      paletteLight: { "--accent": "#aa0000" },
    });
    expect(JSON.parse(qbr.tokensLight)["--accent"]).toBe("#aa0000");
  });
});

describe("saveDocumentPlate", () => {
  it("happy path: valid tenant plate persists and returns the resolved view", async () => {
    const result = (await saveDocumentPlate(
      {},
      {
        input: {
          slug: "board-update",
          displayName: "Board Update",
          useFor: "Monthly update for the board.",
          eyebrow: "BOARD UPDATE",
          paletteLight: JSON.stringify({ "--accent": "#334455" }),
        },
      },
      ctx,
    )) as { slug: string; origin: string; tokensLight: string };
    expect(result.slug).toBe("board-update");
    expect(result.origin).toBe("tenant");
    expect(JSON.parse(result.tokensLight)["--accent"]).toBe("#334455");
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0].origin).toBe("tenant");
  });

  it("rejects a bad token value with diagnostics and persists nothing (AE3)", async () => {
    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "board-update",
            displayName: "Board Update",
            useFor: "Monthly update.",
            paletteLight: JSON.stringify({
              "--accent": "url(javascript:alert(1))",
            }),
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/PLATE_TOKEN_INVALID/);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("platform plate: structural edits refused, palette override persists delta only", async () => {
    await expect(
      saveDocumentPlate(
        {},
        { input: { slug: "qbr", displayName: "Renamed" } },
        ctx,
      ),
    ).rejects.toThrow(/platform plate/);

    const result = (await saveDocumentPlate(
      {},
      {
        input: {
          slug: "qbr",
          paletteLight: JSON.stringify({ "--accent": "#123456" }),
        },
      },
      ctx,
    )) as { customized: boolean; origin: string };
    expect(result.origin).toBe("platform");
    expect(result.customized).toBe(true);
    expect(mocks.inserted[0].origin).toBe("platform_override");
    expect(mocks.inserted[0].config).toEqual({
      paletteLight: { "--accent": "#123456" },
    });
  });

  it("reset: platform plate saved with empty config and hidden=false deletes the row (R4)", async () => {
    mocks.rows = [
      {
        slug: "qbr",
        origin: "platform_override",
        config: { paletteLight: { "--accent": "#aa0000" } },
        hidden: false,
      },
    ];
    const result = (await saveDocumentPlate(
      {},
      {
        input: {
          slug: "qbr",
          paletteLight: "{}",
          paletteDark: "{}",
          hidden: false,
        },
      },
      ctx,
    )) as { customized: boolean; tokensLight: string };
    expect(mocks.deleted).toBe(1);
    expect(result.customized).toBe(false);
    expect(JSON.parse(result.tokensLight)["--accent"]).toBe("#3d5aa8");
  });

  it("member calling save → authorization error", async () => {
    mocks.requireTenantAdmin.mockRejectedValue(
      new Error("Tenant admin role required"),
    );
    await expect(
      saveDocumentPlate({}, { input: { slug: "x", displayName: "X" } }, ctx),
    ).rejects.toThrow("Tenant admin role required");
  });
});

describe("deleteDocumentPlate", () => {
  it("platform plate delete refused", async () => {
    const result = await deleteDocumentPlate({}, { slug: "report" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("hide");
  });

  it("tenant plate delete blocked while artifacts reference the slug, allowed after", async () => {
    mocks.rows = [
      {
        slug: "board-update",
        origin: "tenant",
        config: { displayName: "Board Update", useFor: "x" },
        hidden: false,
      },
    ];
    mocks.artifactRefs = [{ id: "a1" }];
    const blocked = await deleteDocumentPlate(
      {},
      { slug: "board-update" },
      ctx,
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("hide");

    mocks.artifactRefs = [];
    const allowed = await deleteDocumentPlate(
      {},
      { slug: "board-update" },
      ctx,
    );
    expect(allowed.ok).toBe(true);
    expect(mocks.deleted).toBe(1);
  });
});

describe("documentPlatePreview", () => {
  it("known slug returns compiled HTML containing the plate's eyebrow", async () => {
    const result = await documentPlatePreview({}, { slug: "qbr" }, ctx);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain("QUARTERLY BUSINESS REVIEW");
    expect(result.html).toContain("--accent:#3d5aa8;");
  });

  it("draftConfig overrides tokens in the returned HTML without persisting (operator only)", async () => {
    await expect(
      documentPlatePreview(
        {},
        { slug: "qbr", draftConfig: { paletteLight: "{}" } },
        ctx,
      ),
    ).rejects.toThrow(/operator/i);

    mocks.requireTenantMember.mockResolvedValue("admin");
    const result = await documentPlatePreview(
      {},
      {
        slug: "qbr",
        draftConfig: {
          paletteLight: JSON.stringify({ "--accent": "#0000aa" }),
        },
      },
      ctx,
    );
    expect(result.html).toContain("--accent:#0000aa;");
    expect(mocks.inserted).toHaveLength(0);
  });

  it("invalid draftConfig returns diagnostics, not HTML", async () => {
    mocks.requireTenantMember.mockResolvedValue("admin");
    const result = await documentPlatePreview(
      {},
      {
        slug: "qbr",
        draftConfig: {
          paletteLight: JSON.stringify({ "--accent": "expression(x)" }),
        },
      },
      ctx,
    );
    expect(result.html).toBeNull();
    expect(result.diagnostics[0].code).toBe("PLATE_TOKEN_INVALID");
  });

  it("member querying a hidden slug → not-found; operator → HTML (list-detail parity)", async () => {
    mocks.rows = [
      { slug: "qbr", origin: "platform_override", config: {}, hidden: true },
    ];
    await expect(
      documentPlatePreview({}, { slug: "qbr" }, ctx),
    ).rejects.toThrow(/Unknown plate/);

    mocks.requireTenantMember.mockResolvedValue("owner");
    const result = await documentPlatePreview({}, { slug: "qbr" }, ctx);
    expect(result.html).toContain("QUARTERLY BUSINESS REVIEW");
  });

  it("oversized draftConfig rejected before compile", async () => {
    mocks.requireTenantMember.mockResolvedValue("admin");
    const big: Record<string, string> = {};
    for (let i = 0; i < 30; i++) big[`--t${i}`] = "#fff";
    await expect(
      documentPlatePreview(
        {},
        { slug: "qbr", draftConfig: { paletteLight: JSON.stringify(big) } },
        ctx,
      ),
    ).rejects.toThrow(/entries/);
  });
});

describe("updateTenantDocumentPalette", () => {
  it("preserves unrelated features keys (read-modify-write)", async () => {
    mocks.settingsRow = {
      id: "settings-1",
      features: { artifactStyle: { appletTheme: ":root{}" }, other: 1 },
    };
    const result = await updateTenantDocumentPalette(
      {},
      {
        input: {
          light: JSON.stringify({ "--accent": "#112233" }),
          dark: JSON.stringify({ "--accent": "#8899aa" }),
        },
      },
      ctx,
    );
    expect(JSON.parse(result.light)).toEqual({ "--accent": "#112233" });
    expect(mocks.settingsUpdates).toHaveLength(1);
    const features = mocks.settingsUpdates[0].features as Record<
      string,
      unknown
    >;
    expect(features.artifactStyle).toEqual({ appletTheme: ":root{}" });
    expect(features.other).toBe(1);
    expect(features.documentPalette).toEqual({
      light: { "--accent": "#112233" },
      dark: { "--accent": "#8899aa" },
    });
  });

  it("rejects an unsafe palette value with no write", async () => {
    await expect(
      updateTenantDocumentPalette(
        {},
        {
          input: {
            light: JSON.stringify({ "--accent": "url(javascript:x)" }),
            dark: "{}",
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/PLATE_TOKEN_INVALID/);
    expect(mocks.settingsUpdates).toHaveLength(0);
    expect(mocks.inserted).toHaveLength(0);
  });
});

describe("content contract save gates (THINK-183 U2)", () => {
  const goodSection = {
    id: "pipeline-health",
    title: "Pipeline Health",
    tier: "required",
    guidance: "Stage-by-stage funnel with conversion rates.",
    suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
  };
  const goodAnalysis = {
    key: "pipeline-conversion",
    op: "funnel_conversion",
    presentation: { directive: "chart", chartType: "funnel" },
  };

  it("accepts a well-formed contract", () => {
    expect(boundedSections([goodSection])).toEqual([goodSection]);
    expect(boundedAnalyses([goodAnalysis])).toEqual([
      { ...goodAnalysis, params: undefined, source: "model-supplied" },
    ]);
  });

  it("rejects an unregistered analysis op, listing available ops (AE5)", () => {
    expect(() =>
      boundedAnalyses([{ ...goodAnalysis, op: "median_absolute_deviation" }]),
    ).toThrow(/Available ops: funnel_conversion.*trend/);
  });

  it("rejects duplicate section ids", () => {
    expect(() => boundedSections([goodSection, goodSection])).toThrow(
      /duplicate id "pipeline-health"/,
    );
  });

  it("rejects non-slug section ids (uppercase, spaces, overlong)", () => {
    for (const id of ["Pipeline-Health", "pipeline health", "a".repeat(65)]) {
      expect(() =>
        boundedSections([{ ...goodSection, id, title: id }]),
      ).toThrow(/slug/);
    }
  });

  it("rejects a title whose slug differs from the section id (KTD6)", () => {
    expect(() =>
      boundedSections([{ ...goodSection, title: "Funnel Overview" }]),
    ).toThrow(/slugs to "funnel-overview", not "pipeline-health"/);
  });

  it("rejects an unknown tier", () => {
    expect(() =>
      boundedSections([{ ...goodSection, tier: "mandatory" }]),
    ).toThrow(/tier must be one of/);
  });

  it("rejects unknown suggested directive kinds and chart types", () => {
    expect(() =>
      boundedSections([
        { ...goodSection, suggestedDirectives: [{ kind: "hologram" }] },
      ]),
    ).toThrow(/unknown suggested directive kind/i);
    expect(() =>
      boundedSections([
        {
          ...goodSection,
          suggestedDirectives: [{ kind: "chart", chartType: "treemap" }],
        },
      ]),
    ).toThrow(/unknown chart type/i);
  });

  it("rejects an analysis presentation with an unknown directive kind", () => {
    expect(() =>
      boundedAnalyses([
        { ...goodAnalysis, presentation: { directive: "hologram" } },
      ]),
    ).toThrow(/presentation.directive must be one of/);
  });

  it("rejects duplicate analysis keys and a non-model-supplied source", () => {
    expect(() => boundedAnalyses([goodAnalysis, goodAnalysis])).toThrow(
      /duplicate key/,
    );
    expect(() =>
      boundedAnalyses([{ ...goodAnalysis, source: "binding" }]),
    ).toThrow(/model-supplied/);
  });

  it("gate 1b rejects a chart-presented analysis on a plate whose allowedDirectives excludes charts", async () => {
    const { resolvePlatformPlate } =
      await import("../../../lib/artifacts/plate-registry.js");
    const proposal = resolvePlatformPlate("proposal")!;
    const verdict = validateCandidatePlate(
      {
        ...proposal,
        analyses: [
          {
            key: "pipeline-conversion",
            op: "funnel_conversion",
            presentation: { directive: "chart", chartType: "funnel" },
            source: "model-supplied",
          },
        ],
      },
      {},
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.diagnostics[0].code).toBe(
        "PLATE_ANALYSIS_PRESENTATION_RESTRICTED",
      );
    }
  });

  it("parseDraftConfig threads contract keys through (preview path)", () => {
    const draft = parseDraftConfig({
      sections: [goodSection],
      analyses: [goodAnalysis],
    });
    expect(draft.sections).toHaveLength(1);
    expect(draft.analyses).toHaveLength(1);
  });
});

describe("floor save gates (THINK-188 U2)", () => {
  const TERRITORY = {
    id: "territory-notes",
    title: "Territory Notes",
    tier: "suggested",
    guidance: "Notes on territory coverage this period.",
  };

  it("covers AE1 (API half): lowering a floor tier rejects naming the floor rule; raise + guidance succeeds", async () => {
    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "sales-rep-review",
            sectionOverrides: {
              "coaching-notes": { tier: "suggested" },
            },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/cannot lower the platform floor/);
    expect(mocks.inserted).toHaveLength(0);

    const result = (await saveDocumentPlate(
      {},
      {
        input: {
          slug: "sales-rep-review",
          sectionOverrides: {
            "quota-attainment": {
              tier: "required",
              guidance: "Attainment vs our fiscal-year plan.",
            },
          },
        },
      },
      ctx,
    )) as { origin: string };
    expect(result.origin).toBe("platform");
    expect(mocks.inserted).toHaveLength(1);
    const config = mocks.inserted[0].config as Record<string, unknown>;
    expect(config.sectionOverrides).toEqual({
      "quota-attainment": {
        tier: "required",
        guidance: "Attainment vs our fiscal-year plan.",
      },
    });
  });

  it("clearing a raised tier back to the platform floor is accepted (not a ratchet)", async () => {
    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "sales-rep-review",
            sectionOverrides: {
              "quota-attainment": { tier: "required-if-material" },
            },
          },
        },
        ctx,
      ),
    ).resolves.toBeTruthy();
  });

  it("covers AE1: an addition colliding with a floor id rejects; a fresh addition round-trips", async () => {
    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "sales-rep-review",
            sections: [
              {
                id: "pipeline-health",
                title: "Pipeline Health",
                tier: "suggested",
                guidance: "attempted replacement",
              },
            ],
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/platform floor section and cannot be redefined/);

    const result = (await saveDocumentPlate(
      {},
      { input: { slug: "sales-rep-review", sections: [TERRITORY] } },
      ctx,
    )) as { origin: string };
    expect(result.origin).toBe("platform");
    const config = mocks.inserted.at(-1)!.config as Record<string, unknown>;
    expect(config.sections).toEqual([TERRITORY]);
  });

  it("rejects overrides keyed to unknown floor ids, listing the floor", async () => {
    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "sales-rep-review",
            sectionOverrides: { "churn-analysis": { guidance: "x" } },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/not a platform floor section.*quota-attainment/);
  });

  it("rejects a floor-analysis key collision and a chart-presented addition on a chart-restricted plate", async () => {
    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "sales-rep-review",
            analyses: [
              {
                key: "pipeline-conversion",
                op: "trend",
                presentation: { directive: "stats" },
              },
            ],
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/platform floor analysis/);

    // Proposal excludes charts; gate 1b holds for platform additions too.
    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "proposal",
            analyses: [
              {
                key: "win-trend",
                op: "trend",
                presentation: { directive: "chart", chartType: "line" },
              },
            ],
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/PLATE_ANALYSIS_PRESENTATION_RESTRICTED/);
  });

  it("tier-clamp boundary: every lower pairing rejects, equal and higher pass", async () => {
    const TIERS = ["suggested", "required-if-material", "required"] as const;
    const floor = [{ id: "s", tier: "x" }];
    for (const floorTier of TIERS) {
      for (const overrideTier of TIERS) {
        floor[0] = { id: "s", tier: floorTier };
        const attempt = () =>
          boundedSectionOverrides({ s: { tier: overrideTier } }, floor);
        if (TIERS.indexOf(overrideTier) < TIERS.indexOf(floorTier)) {
          expect(attempt, `${floorTier} -> ${overrideTier}`).toThrow(
            /cannot lower the platform floor/,
          );
        } else {
          expect(attempt(), `${floorTier} -> ${overrideTier}`).toEqual({
            s: { tier: overrideTier },
          });
        }
      }
    }
  });

  it("platform identity fields stay locked with the narrowed message", async () => {
    await expect(
      saveDocumentPlate(
        {},
        { input: { slug: "sales-rep-review", displayName: "Renamed" } },
        ctx,
      ),
    ).rejects.toThrow(/identity fields and allowed directives cannot/);
  });

  it("wipe guard (server half): palette-only save that resends contract state preserves the deltas", async () => {
    const result = (await saveDocumentPlate(
      {},
      {
        input: {
          slug: "sales-rep-review",
          paletteLight: JSON.stringify({ "--accent": "#123456" }),
          sections: [TERRITORY],
          sectionOverrides: {
            "quota-attainment": { guidance: "Fiscal-year attainment." },
          },
        },
      },
      ctx,
    )) as { origin: string };
    expect(result.origin).toBe("platform");
    const config = mocks.inserted.at(-1)!.config as Record<string, unknown>;
    expect(config.paletteLight).toEqual({ "--accent": "#123456" });
    expect(config.sections).toEqual([TERRITORY]);
    expect(config.sectionOverrides).toBeTruthy();
  });

  it("a platform row holding only contract deltas resets when saved empty", async () => {
    mocks.rows = [
      {
        slug: "sales-rep-review",
        origin: "platform_override",
        config: { sections: [TERRITORY] },
        hidden: false,
      },
    ];
    const result = (await saveDocumentPlate(
      {},
      { input: { slug: "sales-rep-review" } },
      ctx,
    )) as { customized: boolean };
    expect(mocks.deleted).toBe(1);
    expect(result.customized).toBe(false);
  });

  it("tenant plates: full contract persists; sectionOverrides is rejected", async () => {
    const result = (await saveDocumentPlate(
      {},
      {
        input: {
          slug: "deal-desk",
          displayName: "Deal Desk",
          useFor: "Deal desk reviews.",
          sections: [TERRITORY],
          analyses: [
            {
              key: "win-rate",
              op: "ratio_pct",
              presentation: { directive: "stats" },
            },
          ],
        },
      },
      ctx,
    )) as { origin: string };
    expect(result.origin).toBe("tenant");
    const config = mocks.inserted.at(-1)!.config as Record<string, unknown>;
    expect(config.sections).toEqual([TERRITORY]);
    expect(
      (config.analyses as Array<{ key: string }>).map((a) => a.key),
    ).toEqual(["win-rate"]);

    await expect(
      saveDocumentPlate(
        {},
        {
          input: {
            slug: "deal-desk-2",
            displayName: "Deal Desk 2",
            useFor: "x",
            sectionOverrides: { anything: { guidance: "y" } },
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/applies only to platform plates/);
  });
});

describe("GraphQL contract surface (THINK-188 U4)", () => {
  it("annotates floor provenance: platform sections carry source + overridden flags, additions carry tenant", async () => {
    mocks.rows = [
      {
        slug: "sales-rep-review",
        origin: "platform_override",
        config: {
          sectionOverrides: {
            "quota-attainment": { guidance: "Fiscal-year attainment." },
          },
          sections: [
            {
              id: "territory-notes",
              title: "Territory Notes",
              tier: "suggested",
              guidance: "Coverage notes.",
            },
          ],
        },
        hidden: false,
      },
    ];
    const plates = (await documentPlates(
      {},
      { tenantId: TENANT },
      ctx,
    )) as Array<{ slug: string; sections: string | null }>;
    const srr = plates.find((p) => p.slug === "sales-rep-review")!;
    const sections = JSON.parse(srr.sections!) as Array<{
      id: string;
      source: string;
      overridden?: Record<string, boolean>;
    }>;
    const quota = sections.find((s) => s.id === "quota-attainment")!;
    expect(quota.source).toBe("platform");
    expect(quota.overridden).toEqual({ guidance: true });
    const pipeline = sections.find((s) => s.id === "pipeline-health")!;
    expect(pipeline.source).toBe("platform");
    expect(pipeline.overridden).toBeUndefined();
    const territory = sections.find((s) => s.id === "territory-notes")!;
    expect(territory.source).toBe("tenant");
  });

  it("a pristine platform plate carries annotated sections with no overridden markers; contract-less plates return null", async () => {
    const plates = (await documentPlates(
      {},
      { tenantId: TENANT },
      ctx,
    )) as Array<{ slug: string; sections: string | null; analyses: string | null }>;
    const srr = plates.find((p) => p.slug === "sales-rep-review")!;
    const sections = JSON.parse(srr.sections!) as Array<{
      source: string;
      overridden?: unknown;
    }>;
    expect(sections.every((s) => s.source === "platform")).toBe(true);
    expect(sections.every((s) => s.overridden === undefined)).toBe(true);
    const analyses = JSON.parse(srr.analyses!) as Array<{ source: string }>;
    expect(analyses.every((a) => a.source === "platform")).toBe(true);
    const report = plates.find((p) => p.slug === "report")!;
    expect(report.sections).toBeNull();
    expect(report.analyses).toBeNull();
  });

  it("save accepts AWSJSON string-encoded contract fields (wire shape) and persists the delta", async () => {
    const result = (await saveDocumentPlate(
      {},
      {
        input: {
          slug: "sales-rep-review",
          sections: JSON.stringify([
            {
              id: "territory-notes",
              title: "Territory Notes",
              tier: "suggested",
              guidance: "Coverage notes.",
            },
          ]),
          sectionOverrides: JSON.stringify({
            "quota-attainment": { tier: "required" },
          }),
        },
      },
      ctx,
    )) as { sections: string | null };
    const config = mocks.inserted.at(-1)!.config as Record<string, unknown>;
    expect(
      (config.sections as Array<{ id: string }>).map((s) => s.id),
    ).toEqual(["territory-notes"]);
    expect(config.sectionOverrides).toEqual({
      "quota-attainment": { tier: "required" },
    });
    // The mutation returns the resolved, annotated contract.
    const sections = JSON.parse(result.sections!) as Array<{
      id: string;
      tier: string;
      overridden?: Record<string, boolean>;
    }>;
    expect(
      sections.find((s) => s.id === "quota-attainment")!.overridden,
    ).toEqual({ tier: true });
    expect(sections.map((s) => s.id)).toContain("territory-notes");
  });

  it("preview draftConfig with contract fields compiles the draft contract, not the stored one", async () => {
    mocks.requireTenantMember.mockResolvedValue("admin");
    const result = (await documentPlatePreview(
      {},
      {
        tenantId: TENANT,
        slug: "deal-desk",
        draftConfig: {
          displayName: "Deal Desk",
          useFor: "Deal desk reviews.",
          sections: JSON.stringify([
            {
              id: "summary",
              title: "Summary",
              tier: "required",
              guidance: "Headline outcome.",
            },
            {
              id: "risks",
              title: "Risks",
              tier: "required-if-material",
              guidance: "What could kill the deal.",
            },
          ]),
          analyses: JSON.stringify([
            {
              key: "win-rate",
              op: "ratio_pct",
              presentation: { directive: "stats" },
            },
          ]),
        },
      },
      ctx,
    )) as { html: string | null; diagnostics: unknown[] };
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain('id="summary"');
    // Rich preview: computed sample analysis (82.4%) + waiver demo on the
    // last enforced (required-if-material) section.
    expect(result.html).toContain("82.4%");
    expect(result.html).toContain("Section omitted");
  });
});
