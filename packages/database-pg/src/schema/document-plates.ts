/**
 * Plate registry (THINK-153): tenant-scoped document genre plates.
 *
 * Platform plates (4 core + business library) are CODE-DEFINED in
 * packages/api (plate-definitions.ts) — this table stores only tenant deltas:
 *
 * - origin = 'platform_override': a tenant's token/hidden delta on a
 *   code-defined platform plate. Config carries only the overridden fields;
 *   resolution merges it over the platform definition.
 * - origin = 'tenant': a tenant-created plate. Config is the full definition.
 *   If a future platform plate slug collides with an existing tenant row, the
 *   tenant row wins and the platform definition is shadowed for that tenant.
 *
 * Config is jsonb (displayName, useFor, eyebrow, titleSuffix, paletteLight,
 * paletteDark, allowedDirectives) — validated at save by the KTD7 three-gate
 * pipeline (token guard + exemplar compile + DocSpector preflight); rows are
 * never written unvalidated.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core";

export const DOCUMENT_PLATE_ORIGINS = ["platform_override", "tenant"] as const;
export type DocumentPlateOrigin = (typeof DOCUMENT_PLATE_ORIGINS)[number];

/** Section manifest entry (THINK-183); mirrors PlateSectionSpec in api. */
export interface DocumentPlateSectionConfig {
  id: string;
  title: string;
  tier: "required" | "required-if-material" | "suggested";
  guidance: string;
  suggestedDirectives?: Array<{ kind: string; chartType?: string }>;
}

/** Declared analysis (THINK-183); mirrors PlateAnalysisSpec in api. */
export interface DocumentPlateAnalysisConfig {
  key: string;
  op: string;
  params?: Record<string, unknown>;
  presentation: { directive: string; chartType?: string };
  source?: "model-supplied";
}

/**
 * Tenant patch on ONE platform floor section (THINK-188 KTD1). Keyed by the
 * floor section's id in DocumentPlateConfig.sectionOverrides. Deliberately
 * carries no `id`/`title` — retitling a floor section is unrepresentable —
 * and `tier` may only raise (validated at save, clamped at resolution).
 */
export interface DocumentPlateSectionOverrideConfig {
  guidance?: string;
  tier?: "required" | "required-if-material" | "suggested";
  suggestedDirectives?: Array<{ kind: string; chartType?: string }>;
}

/**
 * Partial for platform_override rows; full definition for tenant rows.
 *
 * Contract-key semantics differ by origin (THINK-188 KTD1 — the floor model):
 * - origin = 'tenant': `sections`/`analyses` are the FULL contract (THINK-183
 *   semantics, unchanged).
 * - origin = 'platform_override': `sections`/`analyses` are tenant ADDITIONS
 *   layered onto the platform floor, and `sectionOverrides` patches floor
 *   sections by id. Removal of a floor entry is inexpressible by shape.
 * - origin = 'platform_override' with `ownContract: true`: the tenant took
 *   full ownership of the contract — `sections`/`analyses` are the FULL
 *   contract (tenant semantics) and the platform floor no longer merges in.
 *   Palette/identity layering is unchanged; Reset returns to the platform
 *   definition by deleting the row.
 */
export interface DocumentPlateConfig {
  displayName?: string;
  useFor?: string;
  eyebrow?: string;
  titleSuffix?: string;
  /** CSS custom-property overrides, plate token vocabulary only. */
  paletteLight?: Record<string, string>;
  paletteDark?: Record<string, string>;
  /** Directive kinds this plate's documents may use; absent = all. */
  allowedDirectives?: string[];
  /** Content contract: full manifest (tenant) or additions (platform). */
  sections?: DocumentPlateSectionConfig[];
  /** Content contract: full analyses (tenant) or additions (platform). */
  analyses?: DocumentPlateAnalysisConfig[];
  /** Floor-section patches by platform section id (platform rows only). */
  sectionOverrides?: Record<string, DocumentPlateSectionOverrideConfig>;
  /** Platform rows only: tenant owns the full contract; no floor merge. */
  ownContract?: boolean;
}

export const documentPlates = pgTable(
  "document_plates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    origin: text("origin").notNull(),
    config: jsonb("config")
      .$type<DocumentPlateConfig>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    hidden: boolean("hidden").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("document_plates_tenant_slug_uidx").on(
      table.tenant_id,
      table.slug,
    ),
    index("document_plates_tenant_idx").on(table.tenant_id),
    check(
      "document_plates_origin_check",
      sql`${table.origin} IN ('platform_override', 'tenant')`,
    ),
    check(
      "document_plates_slug_check",
      sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{0,63}$'`,
    ),
  ],
);
