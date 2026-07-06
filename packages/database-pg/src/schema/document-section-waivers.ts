/**
 * Document section waivers (THINK-183 KTD5/R10).
 *
 * When a plate's section manifest requires a section the model cannot back
 * with data, the emission carries an explicit tw:waiver — rendered inline and
 * in the provenance footer, and recorded here so waiver counts and reasons
 * are queryable per document and per plate (the THINK-189 conformance seam).
 *
 * Head semantics: rows are rewritten (delete + reinsert) on every successful
 * emission of a manifest-bearing plate, matching document-head semantics — a
 * re-emission without waivers clears prior rows.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core";
import { artifacts } from "./artifacts";

export const DOCUMENT_WAIVER_TIERS = [
  "required",
  "required-if-material",
] as const;
export type DocumentWaiverTier = (typeof DOCUMENT_WAIVER_TIERS)[number];

export const documentSectionWaivers = pgTable(
  "document_section_waivers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Waivers belong to their document artifact: cascade the delete.
    artifact_id: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    /** The plate the document was emitted against (denormalized for R10). */
    plate_slug: text("plate_slug").notNull(),
    /** Manifest section id (slug-shaped, KTD6). */
    section_id: text("section_id").notNull(),
    tier: text("tier").notNull(),
    reason: text("reason").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("document_section_waivers_artifact_section_uidx").on(
      table.artifact_id,
      table.section_id,
    ),
    index("document_section_waivers_tenant_plate_idx").on(
      table.tenant_id,
      table.plate_slug,
    ),
    check(
      "document_section_waivers_tier_check",
      sql`${table.tier} IN ('required', 'required-if-material')`,
    ),
  ],
);
