import { getDb } from "@thinkwork/database-pg";
import { documentPlates } from "@thinkwork/database-pg/schema";
import { GraphQLError } from "graphql";
import { and, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { DOCUMENT_GENRE_SLUG_RE } from "../../../lib/artifacts/document-emission.js";
import { getPlatformPlate } from "../../../lib/artifacts/plate-definitions.js";
import {
  drizzlePlateStore,
  resolveCandidatePlate,
} from "../../../lib/artifacts/plate-registry.js";
import type { DocumentPlateConfig } from "@thinkwork/database-pg/schema";
import {
  badInput,
  boundedAnalyses,
  boundedDirectives,
  boundedPalette,
  boundedSections,
  boundedSectionOverrides,
  plateToGraphql,
  requirePlateAdmin,
  validateCandidatePlate,
} from "./shared.js";

interface SaveDocumentPlateInput {
  tenantId?: string | null;
  slug: string;
  displayName?: string | null;
  useFor?: string | null;
  eyebrow?: string | null;
  titleSuffix?: string | null;
  paletteLight?: unknown;
  paletteDark?: unknown;
  allowedDirectives?: unknown;
  hidden?: boolean | null;
  /** THINK-188 contract fields: tenant plates carry the full contract;
   * platform plates carry additions + sectionOverrides under the floor. */
  sections?: unknown;
  analyses?: unknown;
  sectionOverrides?: unknown;
}

function text(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * Create or update a plate (R1/R4/R5, KTD7). Platform slugs accept palette
 * overrides + hidden only and reset to platform defaults when saved empty;
 * tenant slugs carry the full config. The three-gate validation runs against
 * the WOULD-BE resolved plate; failures throw with diagnostics and persist
 * nothing.
 */
export async function saveDocumentPlate(
  _parent: unknown,
  args: { input: SaveDocumentPlateInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  const tenantId = await requirePlateAdmin(ctx, input.tenantId);
  const slug = input.slug?.trim().toLowerCase();
  if (!slug || !DOCUMENT_GENRE_SLUG_RE.test(slug)) {
    throw badInput(
      "slug must be a lowercase slug (letters, digits, hyphens, ≤64 chars)",
    );
  }

  const store = drizzlePlateStore();
  const existingRow = await store.getPlateRow(tenantId, slug);
  const platform = getPlatformPlate(slug);

  const paletteLight = boundedPalette(input.paletteLight, "paletteLight");
  const paletteDark = boundedPalette(input.paletteDark, "paletteDark");
  const allowedDirectives = boundedDirectives(input.allowedDirectives);

  // KTD1 collision rule: an existing tenant-created row shadows the platform
  // definition — its slug keeps full tenant semantics.
  const isPlatformPath = platform !== null && existingRow?.origin !== "tenant";

  const sections = boundedSections(input.sections);
  const analyses = boundedAnalyses(input.analyses);

  let origin: "platform_override" | "tenant";
  let config: DocumentPlateConfig;
  if (isPlatformPath) {
    // R4 narrowed by THINK-188 R8: built-in plates accept palette overrides,
    // hidden, and content-contract deltas under the floor rules — additions
    // plus per-floor-section patches. Identity fields stay locked.
    if (
      text(input.displayName) !== undefined ||
      text(input.useFor) !== undefined ||
      text(input.eyebrow) !== undefined ||
      text(input.titleSuffix) !== undefined ||
      allowedDirectives !== undefined
    ) {
      throw badInput(
        `"${slug}" is a platform plate: palette overrides, hidden, and content-contract additions/overrides can be changed — identity fields and allowed directives cannot. Create a tenant plate to define new structure.`,
      );
    }
    const floorSections = platform!.sections ?? [];
    const floorAnalysisKeys = new Set(
      (platform!.analyses ?? []).map((a) => a.key),
    );
    const sectionOverrides = boundedSectionOverrides(
      input.sectionOverrides,
      floorSections,
    );
    const floorIds = new Set(floorSections.map((s) => s.id));
    for (const addition of sections ?? []) {
      if (floorIds.has(addition.id)) {
        throw badInput(
          `sections: "${addition.id}" is a platform floor section and cannot be redefined (floor rule). Patch it via sectionOverrides instead.`,
        );
      }
    }
    for (const addition of analyses ?? []) {
      if (floorAnalysisKeys.has(addition.key)) {
        throw badInput(
          `analyses: "${addition.key}" is a platform floor analysis and cannot be redefined (floor rule).`,
        );
      }
    }
    origin = "platform_override";
    config = {
      ...(paletteLight && Object.keys(paletteLight).length > 0
        ? { paletteLight }
        : {}),
      ...(paletteDark && Object.keys(paletteDark).length > 0
        ? { paletteDark }
        : {}),
      ...(sections && sections.length > 0 ? { sections } : {}),
      ...(analyses && analyses.length > 0 ? { analyses } : {}),
      ...(sectionOverrides ? { sectionOverrides } : {}),
    };
  } else {
    if (platform && !existingRow) {
      // Unreachable by construction (isPlatformPath covers it) — guard kept
      // for clarity if the branching above changes.
      throw badInput(`"${slug}" is a platform plate`);
    }
    if (input.sectionOverrides !== undefined) {
      throw badInput(
        "sectionOverrides applies only to platform plates — tenant plates own their contract; edit sections directly.",
      );
    }
    origin = "tenant";
    const prior = existingRow?.config ?? {};
    config = {
      displayName: text(input.displayName) ?? prior.displayName,
      useFor: text(input.useFor) ?? prior.useFor,
      eyebrow: text(input.eyebrow) ?? prior.eyebrow,
      titleSuffix: text(input.titleSuffix) ?? prior.titleSuffix,
      paletteLight: paletteLight ?? prior.paletteLight,
      paletteDark: paletteDark ?? prior.paletteDark,
      allowedDirectives: allowedDirectives ?? prior.allowedDirectives,
      sections: sections ?? prior.sections,
      analyses: analyses ?? prior.analyses,
    };
    if (!config.displayName || !config.useFor) {
      throw badInput(
        "displayName and useFor are required when creating a tenant plate",
      );
    }
  }

  const hidden = input.hidden ?? existingRow?.hidden ?? false;

  // Reset affordance (R4): a platform plate saved with no deltas and not
  // hidden returns to pure platform definition — the row is removed.
  const isReset = isPlatformPath && Object.keys(config).length === 0 && !hidden;

  // Three-gate validation on the WOULD-BE resolved plate (skipped for reset —
  // platform definitions are validated by the library snapshot tests).
  const candidate = await resolveCandidatePlate(
    tenantId,
    slug,
    { origin, config, hidden },
    store,
  );
  if (!candidate) throw badInput(`Unable to resolve plate "${slug}"`);
  if (!isReset) {
    const verdict = validateCandidatePlate(candidate, {
      light: paletteLight,
      dark: paletteDark,
    });
    if (!verdict.ok) {
      throw new GraphQLError(
        `Plate validation failed: ${verdict.diagnostics
          .map((d) => `[${d.code}] ${d.message}`)
          .join(" | ")}`,
        {
          extensions: {
            code: "PLATE_VALIDATION_FAILED",
            diagnostics: verdict.diagnostics,
          },
        },
      );
    }
  }

  const db = getDb();
  if (isReset) {
    await db
      .delete(documentPlates)
      .where(
        and(
          eq(documentPlates.tenant_id, tenantId),
          eq(documentPlates.slug, slug),
        ),
      );
    const restored = await resolveCandidatePlate(
      tenantId,
      slug,
      { origin, config: {}, hidden: false },
      store,
    );
    return plateToGraphql({ ...restored!, customized: false }, null);
  }

  await db
    .insert(documentPlates)
    .values({
      tenant_id: tenantId,
      slug,
      origin,
      config,
      hidden,
    })
    .onConflictDoUpdate({
      target: [documentPlates.tenant_id, documentPlates.slug],
      set: { origin, config, hidden, updated_at: new Date() },
    });

  return plateToGraphql(
    { ...candidate, customized: origin === "platform_override" },
    Object.keys(config).length > 0 ? (config as Record<string, unknown>) : null,
  );
}
