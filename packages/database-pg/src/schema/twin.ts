import { sql } from "drizzle-orm";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./core.js";

/**
 * Materialization suggestions (Company Brain U8 / R8): when a cohort
 * question needs a limited (or undeclared) facet, the gap surfaces to
 * operators on the ontology surface — persisted, deduped by
 * (tenant, entity type, facet) with a hit counter, dismissible. Created by
 * hand-rolled migration 0273 (markers), not db:push.
 */
export const twinMaterializationSuggestions = pgTable(
  "twin_materialization_suggestions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    entity_type_slug: text("entity_type_slug").notNull(),
    facet_slug: text("facet_slug").notNull(),
    hit_count: integer("hit_count").notNull().default(1),
    /** Most recent question shape that hit the gap (context for operators). */
    last_question: text("last_question"),
    dismissed_at: timestamp("dismissed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_twin_materialization_suggestions").on(
      table.tenant_id,
      table.entity_type_slug,
      table.facet_slug,
    ),
  ],
);
