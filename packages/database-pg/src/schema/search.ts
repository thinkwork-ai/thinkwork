import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * THINK-263 R15/KTD-8 — the search flywheel's sensor. One append-only row per
 * broker query (parallel per-rail calls share a query_id): raw query text is
 * kept because it is the demand-queue input for wiki-compile (flywheel phase),
 * guarded by a 180-day retention window (enforced operationally; see the
 * migration header) and tenant-scoped access on any operator read path.
 * Written fire-and-forget — telemetry failure never fails the search.
 */
export const searchQueries = pgTable("search_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenant_id: uuid("tenant_id").notNull(),
  user_id: uuid("user_id"),
  query_id: uuid("query_id"),
  query_text: text("query_text").notNull(),
  sources: jsonb("sources").notNull(),
  leg_hit_counts: jsonb("leg_hit_counts").notNull(),
  leg_statuses: jsonb("leg_statuses").notNull(),
  total_hits: integer("total_hits").notNull().default(0),
  escalated: boolean("escalated").notNull().default(false),
  duration_ms: integer("duration_ms"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
