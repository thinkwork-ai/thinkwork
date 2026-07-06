import { getDb } from "@thinkwork/database-pg";
import { tenantSettings } from "@thinkwork/database-pg/schema";
import { GraphQLError } from "graphql";
import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import {
  resolvePlatformPlate,
  validatePlatePalette,
} from "../../../lib/artifacts/plate-registry.js";
import {
  boundedPalette,
  requirePlateAdmin,
  validateCandidatePlate,
} from "./shared.js";

interface UpdateTenantDocumentPaletteInput {
  tenantId?: string | null;
  light: unknown;
  dark: unknown;
}

/**
 * Set the tenant-wide document palette (R8, KTD6): brand token values that
 * apply beneath every plate. Validated by the same three gates as a plate
 * save, then written to tenant_settings.features.documentPalette via a
 * read-modify-write that preserves sibling feature keys.
 */
export async function updateTenantDocumentPalette(
  _parent: unknown,
  args: { input: UpdateTenantDocumentPaletteInput },
  ctx: GraphQLContext,
): Promise<{ light: string; dark: string }> {
  const tenantId = await requirePlateAdmin(ctx, args.input.tenantId);
  const light = boundedPalette(args.input.light, "light") ?? {};
  const dark = boundedPalette(args.input.dark, "dark") ?? {};

  const diagnostics: Array<{ code: string; message: string }> = [];
  for (const [label, palette] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    const verdict = validatePlatePalette(palette);
    if (!verdict.ok) {
      diagnostics.push(
        ...verdict.errors.map((message) => ({
          code: "PLATE_TOKEN_INVALID",
          message: `${label}: ${message}`,
        })),
      );
    }
  }
  if (diagnostics.length === 0) {
    // Compile gate: the report exemplar with the new palette applied.
    const base = resolvePlatformPlate("report")!;
    const verdict = validateCandidatePlate(
      {
        ...base,
        tokensLight: { ...base.tokensLight, ...light },
        tokensDark: { ...base.tokensDark, ...dark },
      },
      {},
    );
    if (!verdict.ok) diagnostics.push(...verdict.diagnostics);
  }
  if (diagnostics.length > 0) {
    throw new GraphQLError(
      `Palette validation failed: ${diagnostics
        .map((d) => `[${d.code}] ${d.message}`)
        .join(" | ")}`,
      {
        extensions: { code: "PLATE_VALIDATION_FAILED", diagnostics },
      },
    );
  }

  const db = getDb();
  const [row] = await db
    .select({ id: tenantSettings.id, features: tenantSettings.features })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenant_id, tenantId))
    .limit(1);
  const priorFeatures =
    row?.features &&
    typeof row.features === "object" &&
    !Array.isArray(row.features)
      ? (row.features as Record<string, unknown>)
      : {};
  const features = {
    ...priorFeatures,
    documentPalette: { light, dark },
  };
  if (row) {
    await db
      .update(tenantSettings)
      .set({ features, updated_at: new Date() })
      .where(eq(tenantSettings.id, row.id));
  } else {
    await db.insert(tenantSettings).values({
      tenant_id: tenantId,
      features,
    });
  }

  return { light: JSON.stringify(light), dark: JSON.stringify(dark) };
}
