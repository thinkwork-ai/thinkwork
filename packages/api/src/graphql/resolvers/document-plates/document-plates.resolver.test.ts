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
