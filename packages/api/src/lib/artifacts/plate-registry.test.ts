/**
 * Plate registry (THINK-153 U1): resolution layering, token guard, exemplar
 * assembly. All through the injectable PlateStore seam — no live DB.
 */
import { describe, expect, it } from "vitest";
import { compileDocument, headingSlug } from "./document-compositor.js";
import {
  CORE_PLATE_SLUGS,
  PLATFORM_PLATES,
  getPlatformPlate,
} from "./plate-definitions.js";
import {
  buildContractPreviewExemplar,
  buildPlateExemplar,
  listPlates,
  parseTenantDocumentPalette,
  resolvePlate,
  validatePlatePalette,
  visiblePlateSummaries,
  type PlateRow,
  type PlateStore,
  type TenantDocumentPalette,
} from "./plate-registry.js";

const TENANT = "00000000-0000-0000-0000-000000000001";

function fakeStore(
  rows: PlateRow[] = [],
  palette: TenantDocumentPalette = { light: {}, dark: {} },
): PlateStore {
  return {
    getPlateRow: async (_tenantId, slug) =>
      rows.find((r) => r.slug === slug) ?? null,
    listPlateRows: async () => rows,
    getTenantDocumentPalette: async () => palette,
  };
}

describe("resolvePlate layering (KTD2)", () => {
  it("ownContract: true — the stored contract IS the contract; floor does not merge in", async () => {
    const store = fakeStore([
      {
        slug: "qbr",
        origin: "platform_override",
        config: {
          ownContract: true,
          sections: [
            // One floor section renamed and re-tiered, the rest removed.
            {
              id: "business-outcomes",
              title: "Outcomes (renamed)",
              tier: "suggested",
              guidance: "Own words.",
            },
            {
              id: "custom-extras",
              title: "Custom Extras",
              tier: "required",
              guidance: "Tenant addition.",
            },
          ],
          analyses: [
            {
              key: "renamed-metric",
              op: "ratio_pct",
              presentation: { directive: "stats" },
            },
          ],
        } as never,
        hidden: false,
      },
    ]);
    const plate = (await resolvePlate(TENANT, "qbr", store))!;
    expect(plate.sections?.map((s) => s.id)).toEqual([
      "business-outcomes",
      "custom-extras",
    ]);
    expect(plate.sections?.[0].title).toBe("Outcomes (renamed)");
    // Tier is NOT clamped to the floor — ownership means no raise-only rule.
    expect(plate.sections?.[0].tier).toBe("suggested");
    expect(plate.analyses?.map((a) => a.key)).toEqual(["renamed-metric"]);
    expect(plate.customized).toBe(true);
  });

  it("platform slug with no rows resolves to platform values", async () => {
    const plate = await resolvePlate(TENANT, "qbr", fakeStore());
    expect(plate).not.toBeNull();
    expect(plate!.displayName).toBe("QBR");
    expect(plate!.eyebrow).toBe("QUARTERLY BUSINESS REVIEW");
    expect(plate!.origin).toBe("platform");
    expect(plate!.customized).toBe(false);
    expect(plate!.tokensLight["--accent"]).toBe("#3d5aa8");
  });

  it("tenant palette flows into every plate lacking overrides (AE2/R8)", async () => {
    const store = fakeStore([], {
      light: { "--bg": "#ffffff", "--accent": "#112233" },
      dark: { "--bg": "#000000" },
    });
    // Core plate: no own palette — tenant palette wins everywhere.
    const report = await resolvePlate(TENANT, "report", store);
    expect(report!.tokensLight["--bg"]).toBe("#ffffff");
    expect(report!.tokensLight["--accent"]).toBe("#112233");
    // Business plate: the tenant palette sits ABOVE the platform definition
    // (R8) — the brand accent applies unless a PLATE ROW override wins.
    const qbr = await resolvePlate(TENANT, "qbr", store);
    expect(qbr!.tokensLight["--bg"]).toBe("#ffffff");
    expect(qbr!.tokensLight["--accent"]).toBe("#112233");
    expect(qbr!.tokensDark["--bg"]).toBe("#000000");
  });

  it("per-plate override beats tenant palette beats platform (AE2)", async () => {
    const store = fakeStore(
      [
        {
          slug: "qbr",
          origin: "platform_override",
          config: { paletteLight: { "--accent": "#aa0000" } },
          hidden: false,
        },
      ],
      { light: { "--accent": "#112233", "--ink": "#222222" }, dark: {} },
    );
    const plate = await resolvePlate(TENANT, "qbr", store);
    expect(plate!.tokensLight["--accent"]).toBe("#aa0000"); // override wins
    expect(plate!.tokensLight["--ink"]).toBe("#222222"); // palette fills rest
    expect(plate!.customized).toBe(true);
  });

  it("un-overridden tokens keep flowing from an updated platform definition (AE2)", async () => {
    // The tenant overrode --accent only; the platform's soft/text values
    // continue to resolve from code — a platform update would flow through.
    const store = fakeStore([
      {
        slug: "qbr",
        origin: "platform_override",
        config: { paletteLight: { "--accent": "#aa0000" } },
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "qbr", store);
    const platform = getPlatformPlate("qbr")!;
    expect(plate!.tokensLight["--accent-soft"]).toBe(
      platform.paletteLight["--accent-soft"],
    );
  });

  it("tenant-created slug resolves entirely from its row", async () => {
    const store = fakeStore([
      {
        slug: "board-update",
        origin: "tenant",
        config: {
          displayName: "Board Update",
          useFor: "Monthly update for the board.",
          eyebrow: "BOARD UPDATE",
          titleSuffix: "Board Update",
          paletteLight: { "--accent": "#334455" },
          allowedDirectives: ["stats"],
        },
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "board-update", store);
    expect(plate!.origin).toBe("tenant");
    expect(plate!.displayName).toBe("Board Update");
    expect(plate!.tokensLight["--accent"]).toBe("#334455");
    expect(plate!.allowedDirectives).toEqual(["stats"]);
  });

  it("unknown slug returns null", async () => {
    expect(await resolvePlate(TENANT, "nope", fakeStore())).toBeNull();
  });

  it("slug collision: tenant-created row shadows the platform definition (KTD1)", async () => {
    const store = fakeStore([
      {
        slug: "qbr",
        origin: "tenant",
        config: { displayName: "Our QBR", eyebrow: "OUR QBR" },
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "qbr", store);
    expect(plate!.origin).toBe("tenant");
    expect(plate!.displayName).toBe("Our QBR");
    // Platform accent does NOT leak through a shadowing tenant row.
    expect(plate!.tokensLight["--accent"]).toBeUndefined();
    const all = await listPlates(TENANT, store);
    expect(all.filter((p) => p.slug === "qbr")).toHaveLength(1);
    expect(all.find((p) => p.slug === "qbr")!.origin).toBe("tenant");
  });
});

describe("listPlates + visibility", () => {
  it("lists the 9 platform plates in definition order, tenant plates after", async () => {
    const store = fakeStore([
      {
        slug: "zeta",
        origin: "tenant",
        config: { displayName: "Zeta" },
        hidden: false,
      },
      {
        slug: "alpha",
        origin: "tenant",
        config: { displayName: "Alpha" },
        hidden: false,
      },
    ]);
    const all = await listPlates(TENANT, store);
    expect(all).toHaveLength(PLATFORM_PLATES.length + 2);
    expect(all.slice(0, PLATFORM_PLATES.length).map((p) => p.slug)).toEqual(
      PLATFORM_PLATES.map((p) => p.slug),
    );
    expect(all.slice(-2).map((p) => p.slug)).toEqual(["alpha", "zeta"]);
  });

  it("hidden plate excluded from summaries but still resolvable", async () => {
    const store = fakeStore([
      {
        slug: "ideation",
        origin: "platform_override",
        config: {},
        hidden: true,
      },
    ]);
    const summaries = visiblePlateSummaries(await listPlates(TENANT, store));
    expect(summaries.map((s) => s.slug)).not.toContain("ideation");
    const plate = await resolvePlate(TENANT, "ideation", store);
    expect(plate).not.toBeNull();
    expect(plate!.hidden).toBe(true);
  });
});

describe("token guard (R7/AE3)", () => {
  it("rejects bad names, unsafe values, and off-vocabulary tokens", () => {
    expect(validatePlatePalette({ "--x;injection": "#fff" }).ok).toBe(false);
    expect(
      validatePlatePalette({ "--accent": "url(javascript:alert(1))" }).ok,
    ).toBe(false);
    expect(validatePlatePalette({ "--accent": "expression(x)" }).ok).toBe(
      false,
    );
    expect(validatePlatePalette({ "--accent": "@import 'x'" }).ok).toBe(false);
    expect(validatePlatePalette({ "--accent": "a".repeat(181) }).ok).toBe(
      false,
    );
    expect(validatePlatePalette({ "--not-a-plate-token": "#fff" }).ok).toBe(
      false,
    );
    const multi = validatePlatePalette({
      "--accent": "#fff",
      "--bogus": "#000",
    });
    expect(multi.ok).toBe(false);
    expect(multi.errors).toHaveLength(1);
  });

  it("accepts valid hex/rgb/oklch values across the vocabulary", () => {
    expect(
      validatePlatePalette({
        "--accent": "#0f6b5c",
        "--bg": "rgb(250, 249, 247)",
        "--ink": "oklch(0.28 0.02 260)",
        "--mono": 'ui-monospace,"SF Mono",Menlo,monospace',
      }).ok,
    ).toBe(true);
  });

  it("resolution re-filters unsafe stored values (defense in depth)", async () => {
    const store = fakeStore([
      {
        slug: "report",
        origin: "platform_override",
        config: {
          paletteLight: {
            "--accent": "url(javascript:alert(1))",
            "--ink": "#111111",
          },
        },
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "report", store);
    expect(plate!.tokensLight["--accent"]).toBeUndefined();
    expect(plate!.tokensLight["--ink"]).toBe("#111111");
  });
});

describe("tenant document palette parsing", () => {
  it("reads features.documentPalette and drops garbage", () => {
    expect(
      parseTenantDocumentPalette({
        documentPalette: {
          light: { "--bg": "#ffffff", "--evil": "url(x)" },
          dark: "nope",
        },
        artifactStyle: { appletTheme: "ignored" },
      }),
    ).toEqual({ light: { "--bg": "#ffffff" }, dark: {} });
    expect(parseTenantDocumentPalette(null)).toEqual({ light: {}, dark: {} });
    expect(parseTenantDocumentPalette("junk")).toEqual({
      light: {},
      dark: {},
    });
  });
});

describe("exemplar builder (KTD7)", () => {
  it("a plate excluding tw:chart produces an exemplar with timeline and no chart block that compiles cleanly", async () => {
    const proposal = await resolvePlate(TENANT, "proposal", fakeStore());
    const exemplar = buildPlateExemplar(proposal!);
    expect(exemplar.markdownBody).not.toContain("tw:chart");
    expect(exemplar.markdownBody).toContain("tw:stats");
    expect(exemplar.markdownBody).toContain("tw:verdict-grid");
    expect(exemplar.markdownBody).toContain("tw:timeline");
    // The exemplar must compile cleanly through the real pipeline WITH the
    // plate's own directive gate: exactly what save validation compiles.
    const compiled = compileDocument({
      plate: proposal!,
      title: exemplar.title,
      abstract: exemplar.abstract,
      markdownBody: exemplar.markdownBody,
    });
    expect(compiled.ok).toBe(true);
  });

  it("a plate allowing all directives produces one block per directive", async () => {
    const qbr = await resolvePlate(TENANT, "qbr", fakeStore());
    const exemplar = buildPlateExemplar(qbr!);
    expect(exemplar.markdownBody).toContain("tw:stats");
    expect(exemplar.markdownBody).toContain("tw:verdict-grid");
    expect(exemplar.markdownBody).toContain("tw:timeline");
    expect(exemplar.markdownBody).toContain("tw:chart");
    const compiled = compileDocument({
      plate: qbr!,
      title: exemplar.title,
      abstract: exemplar.abstract,
      markdownBody: exemplar.markdownBody,
    });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.warnings).toEqual([]);
  });

  it("a plate excluding tw:timeline rejects it with DIRECTIVE_GENRE_RESTRICTED (AE5)", async () => {
    const plate = await resolvePlate(
      TENANT,
      "rollout-plan",
      fakeStore([
        {
          slug: "rollout-plan",
          origin: "tenant",
          config: {
            displayName: "Rollout Plan",
            useFor: "Internal rollout plans.",
            allowedDirectives: ["stats", "verdict-grid"],
          },
          hidden: false,
        },
      ]),
    );
    const result = compileDocument({
      plate: plate!,
      title: "Rollout",
      abstract: "",
      markdownBody:
        "## Body\n\n```tw:timeline\nitems:\n  - { label: Kickoff }\n  - { label: Build, current: true }\n  - { label: Launch }\n```\n",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe("DIRECTIVE_GENRE_RESTRICTED");
    expect(result.diagnostics[0].message).toContain("rollout-plan");
    expect(result.diagnostics[0].message).toContain("tw:stats");
    expect(result.diagnostics[0].message).toContain("tw:verdict-grid");
  });
});

describe("platform definitions snapshot", () => {
  it("core four carry the retired GENRE_TEMPLATES values verbatim with empty palettes", () => {
    // Snapshot of the deleted GENRE_TEMPLATES constant (THINK-154) — the
    // registry definitions must keep these values byte-for-byte.
    const legacy: Record<string, { eyebrow: string; titleSuffix: string }> = {
      ideation: { eyebrow: "IDEATION", titleSuffix: "Ideation" },
      plan: { eyebrow: "PLAN", titleSuffix: "Plan" },
      report: { eyebrow: "REPORT", titleSuffix: "Report" },
      brief: { eyebrow: "DECISION BRIEF", titleSuffix: "Brief" },
    };
    for (const slug of CORE_PLATE_SLUGS) {
      const plate = getPlatformPlate(slug)!;
      expect(plate.eyebrow).toBe(legacy[slug].eyebrow);
      expect(plate.titleSuffix).toBe(legacy[slug].titleSuffix);
      expect(plate.paletteLight).toEqual({});
      expect(plate.paletteDark).toEqual({});
      expect(plate.allowedDirectives).toBe("all");
    }
  });

  it("every platform palette value passes the token guard", () => {
    for (const plate of PLATFORM_PLATES) {
      expect(
        validatePlatePalette({ ...plate.paletteLight }),
        plate.slug,
      ).toMatchObject({ ok: true });
      expect(
        validatePlatePalette({ ...plate.paletteDark }),
        plate.slug,
      ).toMatchObject({ ok: true });
    }
  });

  it("business plates carry distinct accents and use-for lines", () => {
    const accents = PLATFORM_PLATES.filter(
      (p) => !(CORE_PLATE_SLUGS as readonly string[]).includes(p.slug),
    ).map((p) => p.paletteLight["--accent"]);
    expect(new Set(accents).size).toBe(accents.length);
    for (const plate of PLATFORM_PLATES) {
      expect(plate.useFor.length).toBeGreaterThan(20);
    }
  });
});

describe("content contract resolution — tenant rows + floorless platform additions (THINK-183 U2 / THINK-188)", () => {
  const SECTIONS = [
    {
      id: "pipeline-health",
      title: "Pipeline Health",
      tier: "required-if-material",
      guidance: "Stage-by-stage funnel with conversion rates.",
      suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
    },
    {
      id: "coaching-notes",
      title: "Coaching Notes",
      tier: "suggested",
      guidance: "Specific behaviors to keep or change.",
    },
  ];
  const ANALYSES = [
    {
      key: "pipeline-conversion",
      op: "funnel_conversion",
      presentation: { directive: "chart", chartType: "funnel" },
      source: "model-supplied",
    },
  ];

  it("a plate with no contract keys resolves with sections/analyses absent (R3)", async () => {
    const plate = await resolvePlate(TENANT, "report", fakeStore());
    expect(plate!.sections).toBeUndefined();
    expect(plate!.analyses).toBeUndefined();
  });

  it("platform_override contract config round-trips into ResolvedPlate", async () => {
    const store = fakeStore([
      {
        slug: "report",
        origin: "platform_override",
        config: { sections: SECTIONS, analyses: ANALYSES } as never,
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "report", store);
    expect(plate!.sections).toEqual([
      { ...SECTIONS[0] },
      { ...SECTIONS[1], suggestedDirectives: undefined },
    ]);
    expect(plate!.analyses).toEqual(ANALYSES);
    expect(plate!.customized).toBe(true);
  });

  it("tenant-created rows carry their own contract", async () => {
    const store = fakeStore([
      {
        slug: "deal-desk",
        origin: "tenant",
        config: {
          displayName: "Deal Desk",
          useFor: "Deal desk review",
          sections: SECTIONS,
          analyses: ANALYSES,
        } as never,
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "deal-desk", store);
    expect(plate!.sections).toHaveLength(2);
    expect(plate!.analyses).toHaveLength(1);
  });

  it("resolution drops malformed stored contract entries (defense in depth)", async () => {
    const store = fakeStore([
      {
        slug: "report",
        origin: "platform_override",
        config: {
          sections: [
            SECTIONS[0],
            { id: "NOT A SLUG", title: "x", tier: "required", guidance: "g" },
            { id: "no-tier", title: "No Tier", guidance: "g" },
            {
              id: "pipeline-health",
              title: "Dup",
              tier: "required",
              guidance: "g",
            },
          ],
          analyses: [
            ANALYSES[0],
            {
              key: "bad-op",
              op: "median_absolute_deviation",
              presentation: { directive: "chart" },
            },
            {
              key: "bad-kind",
              op: "trend",
              presentation: { directive: "hologram" },
            },
          ],
        } as never,
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "report", store);
    expect(plate!.sections?.map((s) => s.id)).toEqual(["pipeline-health"]);
    expect(plate!.analyses?.map((a) => a.key)).toEqual(["pipeline-conversion"]);
  });

  it("exemplar for a full contract plate (manifest + analyses) compiles clean with computed output", async () => {
    const store = fakeStore([
      {
        slug: "report",
        origin: "platform_override",
        config: { sections: SECTIONS, analyses: ANALYSES } as never,
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "report", store);
    const exemplar = buildPlateExemplar(plate!);
    expect(exemplar.markdownBody).toContain("tw:analysis");
    expect(exemplar.markdownBody).toContain("analysis: pipeline-conversion");
    const compiled = compileDocument({
      plate: plate!,
      title: exemplar.title,
      abstract: exemplar.abstract,
      markdownBody: exemplar.markdownBody,
    });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      // The op example's stage counts (120 → 80) compute to 66.7%.
      expect(compiled.renderHtml).toContain("66.7%");
    }
  });

  it("exemplar for a manifest-bearing plate emits every section heading and compiles through gate 2", async () => {
    const store = fakeStore([
      {
        slug: "report",
        origin: "platform_override",
        config: { sections: SECTIONS } as never,
        hidden: false,
      },
    ]);
    const plate = await resolvePlate(TENANT, "report", store);
    const exemplar = buildPlateExemplar(plate!);
    expect(exemplar.markdownBody).toContain("## Pipeline Health");
    expect(exemplar.markdownBody).toContain("## Coaching Notes");
    const compiled = compileDocument({
      plate: plate!,
      title: exemplar.title,
      abstract: exemplar.abstract,
      markdownBody: exemplar.markdownBody,
    });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      expect(compiled.renderHtml).toContain('id="pipeline-health"');
    }
  });
});

describe("dispatch summaries carry the contract floor (THINK-183 U6/KTD8)", () => {
  it("a contract-bearing plate's summary includes section ids/titles and analysis keys with input hints", async () => {
    const store = fakeStore([
      {
        slug: "report",
        origin: "platform_override",
        config: {
          sections: [
            {
              id: "pipeline-health",
              title: "Pipeline Health",
              tier: "required-if-material",
              guidance: "Funnel with rates.",
            },
            {
              id: "coaching-notes",
              title: "Coaching Notes",
              tier: "suggested",
              guidance: "Not enforced.",
            },
          ],
          analyses: [
            {
              key: "pipeline-conversion",
              op: "funnel_conversion",
              presentation: { directive: "chart", chartType: "funnel" },
            },
          ],
        } as never,
        hidden: false,
      },
    ]);
    const summaries = visiblePlateSummaries(await listPlates(TENANT, store));
    const srr = summaries.find((s) => s.slug === "report")!;
    // Suggested-tier sections are for THINK-185/189, not the dispatch floor.
    expect(srr.sections).toEqual([
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "required-if-material",
      },
    ]);
    expect(srr.analyses).toEqual([
      {
        key: "pipeline-conversion",
        op: "funnel_conversion",
        inputHint: "ordered stages: [{ label, count }], >=2 stages",
      },
    ]);
  });

  it("a contract-less plate's summary keeps the original three-field shape", async () => {
    const summaries = visiblePlateSummaries(
      await listPlates(TENANT, fakeStore()),
    );
    for (const summary of summaries.filter((p) =>
      (CORE_PLATE_SLUGS as readonly string[]).includes(p.slug),
    )) {
      expect(Object.keys(summary).sort()).toEqual([
        "displayName",
        "slug",
        "useFor",
      ]);
    }
  });
});

describe("platform plate contracts (THINK-183 U7 — the live swap)", () => {
  const BUSINESS_SLUGS = [
    "qbr",
    "proposal",
    "weekly-status",
    "sales-rep-review",
    "opportunity-review",
  ];

  it("every business plate carries a manifest and at least one analysis; manifests are pairwise distinct (R12)", () => {
    const manifests = BUSINESS_SLUGS.map((slug) => {
      const plate = getPlatformPlate(slug)!;
      expect(plate.sections?.length, slug).toBeGreaterThan(0);
      expect(plate.analyses?.length, slug).toBeGreaterThan(0);
      return JSON.stringify(plate.sections!.map((s) => s.id));
    });
    expect(new Set(manifests).size).toBe(manifests.length);
  });

  it("core plates stay contract-less (inert path preserved)", () => {
    for (const slug of CORE_PLATE_SLUGS) {
      const plate = getPlatformPlate(slug)!;
      expect(plate.sections).toBeUndefined();
      expect(plate.analyses).toBeUndefined();
    }
  });

  it("every section id equals the heading slug of its title (KTD6)", () => {
    for (const plate of PLATFORM_PLATES) {
      for (const section of plate.sections ?? []) {
        expect(headingSlug(section.title), `${plate.slug}/${section.id}`).toBe(
          section.id,
        );
        expect(section.guidance.length).toBeGreaterThan(20);
      }
    }
  });

  it("Sales Rep Review: pipeline-health is required-if-material with a funnel suggestion backed by funnel_conversion (AE1 contract)", () => {
    const srr = getPlatformPlate("sales-rep-review")!;
    const pipeline = srr.sections!.find((s) => s.id === "pipeline-health")!;
    expect(pipeline.tier).toBe("required-if-material");
    expect(pipeline.suggestedDirectives).toEqual([
      { kind: "chart", chartType: "funnel" },
    ]);
    const analysis = srr.analyses!.find(
      (a) => a.key === "pipeline-conversion",
    )!;
    expect(analysis.op).toBe("funnel_conversion");
    expect(analysis.presentation).toEqual({
      directive: "chart",
      chartType: "funnel",
    });
  });

  it("Proposal declares no chart-presenting analyses and its suggestions respect its directive restriction", () => {
    const proposal = getPlatformPlate("proposal")!;
    for (const analysis of proposal.analyses!) {
      expect(analysis.presentation.directive).not.toBe("chart");
      expect(proposal.allowedDirectives).toContain(
        analysis.presentation.directive,
      );
    }
    for (const section of proposal.sections!) {
      for (const d of section.suggestedDirectives ?? []) {
        expect(proposal.allowedDirectives).toContain(d.kind);
      }
    }
  });

  it("all five business exemplars compile clean and pass preflight (gates 2+3)", async () => {
    const { runDocumentPreflight } = await import("./document-preflight.js");
    for (const slug of BUSINESS_SLUGS) {
      const plate = (await resolvePlate(TENANT, slug, fakeStore()))!;
      const exemplar = buildPlateExemplar(plate);
      const compiled = compileDocument({
        plate,
        title: exemplar.title,
        abstract: exemplar.abstract,
        markdownBody: exemplar.markdownBody,
      });
      expect(compiled.ok, `${slug} exemplar compile`).toBe(true);
      if (!compiled.ok) continue;
      const preflight = runDocumentPreflight({
        renderHtml: compiled.renderHtml,
        digestMarkdown: exemplar.markdownBody,
      });
      expect(preflight.ok, `${slug} exemplar preflight`).toBe(true);
    }
  });

  it("AE1 end-to-end at the lib level: a Sales Rep Review without pipeline-health and without a waiver rejects", async () => {
    const plate = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      fakeStore(),
    ))!;
    const digest = `## Quota Attainment

Attainment held at 82% of target.

## Coaching Notes

Keep the discovery call cadence; tighten follow-up notes.
`;
    const result = compileDocument({
      plate,
      title: "Q3 Rep Review",
      abstract: "Quarterly rep review.",
      markdownBody: digest,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe("REQUIRED_SECTION_MISSING");
    expect(result.diagnostics[0].message).toContain("Pipeline Health");
    expect(result.diagnostics[0].message).toContain("tw:chart (funnel)");
    expect(result.diagnostics[0].message).toContain(
      "waiving is the expected path",
    );
  });
});

describe("floor-model layered merge (THINK-188 U1)", () => {
  function customizedStore(config: Record<string, unknown>) {
    return fakeStore([
      {
        slug: "sales-rep-review",
        origin: "platform_override",
        config: config as never,
        hidden: false,
      },
    ]);
  }
  const TERRITORY = {
    id: "territory-notes",
    title: "Territory Notes",
    tier: "suggested",
    guidance: "Notes on territory coverage.",
  };

  it("covers AE3: overrides patch their field, other floor fields keep flowing from platform, additions append last", async () => {
    const store = customizedStore({
      sectionOverrides: {
        "quota-attainment": { guidance: "Attainment vs our fiscal-year plan." },
      },
      sections: [TERRITORY],
    });
    const plate = (await resolvePlate(TENANT, "sales-rep-review", store))!;
    const floorDef = getPlatformPlate("sales-rep-review")!;
    const ids = plate.sections!.map((s) => s.id);
    // Floor order preserved, addition appended last.
    expect(ids).toEqual([
      ...floorDef.sections!.map((s) => s.id),
      "territory-notes",
    ]);
    const quota = plate.sections!.find((s) => s.id === "quota-attainment")!;
    expect(quota.guidance).toBe("Attainment vs our fiscal-year plan.");
    // A non-overridden floor field still reads the PLATFORM value — a
    // platform guidance improvement propagates (AE3).
    const pipeline = plate.sections!.find((s) => s.id === "pipeline-health")!;
    expect(pipeline.guidance).toBe(
      floorDef.sections!.find((s) => s.id === "pipeline-health")!.guidance,
    );
    expect(plate.customized).toBe(true);
  });

  it("tier overrides raise but never lower (resolution clamp)", async () => {
    const raised = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      customizedStore({
        sectionOverrides: { "quota-attainment": { tier: "required" } },
      }),
    ))!;
    expect(
      raised.sections!.find((s) => s.id === "quota-attainment")!.tier,
    ).toBe("required");
    const lowered = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      customizedStore({
        sectionOverrides: { "coaching-notes": { tier: "suggested" } },
      }),
    ))!;
    // coaching-notes is required on the platform floor; the clamp holds.
    expect(lowered.sections!.find((s) => s.id === "coaching-notes")!.tier).toBe(
      "required",
    );
  });

  it("drops overrides keyed to unknown floor ids and additions colliding with floor ids", async () => {
    const plate = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      customizedStore({
        sectionOverrides: { "not-a-floor-section": { guidance: "x" } },
        sections: [
          {
            id: "pipeline-health",
            title: "Pipeline Health",
            tier: "suggested",
            guidance: "attempted floor replacement",
          },
          TERRITORY,
        ],
      }),
    ))!;
    const floorDef = getPlatformPlate("sales-rep-review")!;
    const pipeline = plate.sections!.find((s) => s.id === "pipeline-health")!;
    // The colliding addition was dropped — the floor entry survives intact.
    expect(pipeline.tier).toBe("required-if-material");
    expect(pipeline.guidance).toBe(
      floorDef.sections!.find((s) => s.id === "pipeline-health")!.guidance,
    );
    expect(plate.sections!.map((s) => s.id)).toContain("territory-notes");
  });

  it("floor analyses always present; tenant additions append; key collisions dropped", async () => {
    const plate = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      customizedStore({
        analyses: [
          {
            key: "win-rate",
            op: "ratio_pct",
            presentation: { directive: "stats" },
          },
          {
            key: "pipeline-conversion",
            op: "trend",
            presentation: { directive: "stats" },
          },
        ],
      }),
    ))!;
    const keys = plate.analyses!.map((a) => a.key);
    expect(keys).toEqual([
      "pipeline-conversion",
      "quota-attainment",
      "win-rate",
    ]);
    // The colliding addition did not replace the floor analysis.
    expect(
      plate.analyses!.find((a) => a.key === "pipeline-conversion")!.op,
    ).toBe("funnel_conversion");
  });

  it("inert proof: a platform plate with no row resolves its code-defined contract unchanged", async () => {
    const plate = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      fakeStore(),
    ))!;
    const floorDef = getPlatformPlate("sales-rep-review")!;
    expect(plate.sections).toEqual(floorDef.sections);
    expect(plate.analyses).toEqual(floorDef.analyses);
  });

  it("style-only platform row (palette/hidden) leaves the contract at pure platform values", async () => {
    const plate = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      customizedStore({ paletteLight: { "--accent": "#123456" } }),
    ))!;
    const floorDef = getPlatformPlate("sales-rep-review")!;
    expect(plate.sections).toEqual(floorDef.sections);
    expect(plate.analyses).toEqual(floorDef.analyses);
  });
});

describe("contract preview exemplar (THINK-188 U3)", () => {
  it("every op's sampleInputs computes clean (R10 pin, all six ops)", async () => {
    const { computeAnalysis, getAnalysisOp, ANALYSIS_OPS } =
      await import("./document-analyses.js");
    for (const op of ANALYSIS_OPS) {
      const spec = getAnalysisOp(op)!;
      const result = computeAnalysis({ op, inputs: spec.sampleInputs });
      expect(result.ok, `${op} sampleInputs must compute clean`).toBe(true);
      if (result.ok) {
        for (const stat of result.stats) {
          expect(stat.value, `${op} stat`).not.toMatch(/NaN|Infinity|n\/a/);
        }
      }
    }
  });

  it("covers AE5: the SRR preview renders every non-waived section, a computed funnel, and the waiver demo; passes preflight", async () => {
    const { runDocumentPreflight } = await import("./document-preflight.js");
    const plate = (await resolvePlate(
      TENANT,
      "sales-rep-review",
      fakeStore(),
    ))!;
    const preview = buildContractPreviewExemplar(plate);
    // The demo waives the LAST required-if-material section (pipeline-health);
    // quota-attainment (also RIM but earlier) renders normally.
    expect(preview.markdownBody).toContain("## Quota Attainment");
    expect(preview.markdownBody).toContain("## Coaching Notes");
    // Section bodies are the section's OWN guidance, not static filler.
    expect(preview.markdownBody).toContain("not narrated from memory");
    expect(preview.markdownBody).not.toContain(
      "Representative content for this section",
    );
    expect(preview.markdownBody).not.toContain("## Where things stand");
    expect(preview.markdownBody).toContain("tw:waiver");
    expect(preview.markdownBody).toContain("section: pipeline-health");
    expect(preview.markdownBody).not.toContain("## Pipeline Health");
    const compiled = compileDocument({
      plate,
      title: preview.title,
      abstract: preview.abstract,
      markdownBody: preview.markdownBody,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    // Funnel computed from curated sample data: 88/145 = 60.7%.
    expect(compiled.renderHtml).toContain("60.7%");
    expect(compiled.renderHtml).toContain("Section omitted");
    expect(compiled.renderHtml).toContain("Section waived:");
    expect(
      runDocumentPreflight({
        renderHtml: compiled.renderHtml,
        digestMarkdown: preview.markdownBody,
      }).ok,
    ).toBe(true);
  });

  it("a contract with only required + suggested sections still gets a waiver demo (falls back to last required)", async () => {
    const store = fakeStore([
      {
        slug: "deal-desk",
        origin: "tenant",
        config: {
          displayName: "Deal Desk",
          useFor: "Deal desk review",
          sections: [
            {
              id: "summary",
              title: "Summary",
              tier: "required",
              guidance: "Headline.",
            },
            {
              id: "risks",
              title: "Risks",
              tier: "required",
              guidance: "What could kill it.",
            },
            {
              id: "notes",
              title: "Notes",
              tier: "suggested",
              guidance: "Anything else.",
            },
          ],
        } as never,
        hidden: false,
      },
    ]);
    const plate = (await resolvePlate(TENANT, "deal-desk", store))!;
    const preview = buildContractPreviewExemplar(plate);
    expect(preview.markdownBody).toContain("section: risks");
    expect(preview.markdownBody).not.toContain("## Risks");
    const compiled = compileDocument({
      plate,
      title: preview.title,
      abstract: preview.abstract,
      markdownBody: preview.markdownBody,
    });
    expect(compiled.ok).toBe(true);
  });

  it("zero enforced sections → no waiver demo, no conflict; compiles clean", async () => {
    const store = fakeStore([
      {
        slug: "scratch",
        origin: "tenant",
        config: {
          displayName: "Scratch",
          useFor: "Loose notes",
          sections: [
            {
              id: "notes",
              title: "Notes",
              tier: "suggested",
              guidance: "Anything.",
            },
          ],
        } as never,
        hidden: false,
      },
    ]);
    const plate = (await resolvePlate(TENANT, "scratch", store))!;
    const preview = buildContractPreviewExemplar(plate);
    expect(preview.markdownBody).not.toContain("tw:waiver");
    expect(preview.markdownBody).toContain("## Notes");
    const compiled = compileDocument({
      plate,
      title: preview.title,
      abstract: preview.abstract,
      markdownBody: preview.markdownBody,
    });
    expect(compiled.ok).toBe(true);
  });

  it("contract-less plates degrade to the save exemplar byte-identically", async () => {
    const plate = (await resolvePlate(TENANT, "report", fakeStore()))!;
    expect(buildContractPreviewExemplar(plate)).toEqual(
      buildPlateExemplar(plate),
    );
  });

  it("gate-exemplar pin: buildPlateExemplar output for every platform plate is unchanged by U3", async () => {
    // The save gates must keep compiling the SAME lean exemplar — the rich
    // preview is display-only. Pin the shape signals the gates depend on.
    for (const def of PLATFORM_PLATES) {
      const plate = (await resolvePlate(TENANT, def.slug, fakeStore()))!;
      const exemplar = buildPlateExemplar(plate);
      expect(exemplar.markdownBody).toContain("## Where things stand");
      expect(exemplar.markdownBody).toContain("## Detail by area");
      // The rich-preview-only artifacts never leak into the gate exemplar.
      expect(exemplar.markdownBody).not.toContain("tw:waiver");
      expect(exemplar.markdownBody).not.toContain("Contract preview");
      for (const section of def.sections ?? []) {
        expect(exemplar.markdownBody).toContain(`## ${section.title}`);
      }
    }
  });
});
