/**
 * Plate registry (THINK-153 U1): resolution layering, token guard, exemplar
 * assembly. All through the injectable PlateStore seam — no live DB.
 */
import { describe, expect, it } from "vitest";
import { compileDocument } from "./document-compositor.js";
import { GENRE_TEMPLATES } from "./document-templates.js";
import {
  CORE_PLATE_SLUGS,
  PLATFORM_PLATES,
  getPlatformPlate,
} from "./plate-definitions.js";
import {
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
  it("a plate excluding tw:chart produces an exemplar with no chart block that compiles cleanly", async () => {
    const proposal = await resolvePlate(TENANT, "proposal", fakeStore());
    const exemplar = buildPlateExemplar(proposal!);
    expect(exemplar.markdownBody).not.toContain("tw:chart");
    expect(exemplar.markdownBody).toContain("tw:stats");
    expect(exemplar.markdownBody).toContain("tw:verdict-grid");
    // Pre-U2 the compositor still keys on the legacy genre enum; the exemplar
    // body itself must compile cleanly through the real pipeline.
    const compiled = compileDocument({
      genre: "report",
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
    expect(exemplar.markdownBody).toContain("tw:chart");
    const compiled = compileDocument({
      genre: "report",
      title: exemplar.title,
      abstract: exemplar.abstract,
      markdownBody: exemplar.markdownBody,
    });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.warnings).toEqual([]);
  });
});

describe("platform definitions snapshot", () => {
  it("core four match today's GENRE_TEMPLATES verbatim with empty palettes", () => {
    for (const slug of CORE_PLATE_SLUGS) {
      const plate = getPlatformPlate(slug)!;
      expect(plate.eyebrow).toBe(GENRE_TEMPLATES[slug].eyebrow);
      expect(plate.titleSuffix).toBe(GENRE_TEMPLATES[slug].titleSuffix);
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
