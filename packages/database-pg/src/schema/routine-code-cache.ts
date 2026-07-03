/**
 * Git-backed routine bookkeeping tables (deterministic routines v1).
 *
 * routine_code_cache — DB index over the S3 read-through code cache keyed
 * by commit SHA (S3 canonical, DB derived index — the eval-datasets
 * pattern). Authoritative for "which SHA is validated for this routine";
 * routines.validated_sha is a denormalized fast-path pointer written only
 * by the fixture gate.
 *
 * Cache keys: tenants/<tenant-slug>/routines/<routine-slug>/<sha>/
 *
 * Plan: docs/plans/2026-07-03-004-feat-deterministic-routines-v1-plan.md
 * (U1, KTD-7).
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
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { routines } from "./routines";

export const routineCodeCache = pgTable(
  "routine_code_cache",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    routine_id: uuid("routine_id")
      .references(() => routines.id)
      .notNull(),
    // Full commit SHA this cache entry was fetched at.
    sha: text("sha").notNull(),
    // S3 prefix holding the module + fixtures snapshot for this SHA.
    s3_key: text("s3_key").notNull(),
    // Fixture-gate outcome for this SHA. 'pending' until the gate runs;
    // 'green' promotes the SHA to validated; 'red' pins execution to the
    // prior validated SHA and opens a repair.
    fixture_status: text("fixture_status").notNull().default("pending"),
    // Machine-readable gate detail (per-fixture results / diff) for the
    // repair agent and the run UI.
    fixture_result_json: text("fixture_result_json"),
    fetched_at: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    validated_at: timestamp("validated_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("idx_routine_code_cache_routine_sha").on(
      table.routine_id,
      table.sha,
    ),
    index("idx_routine_code_cache_tenant").on(table.tenant_id),
    check(
      "routine_code_cache_fixture_status_enum",
      sql`${table.fixture_status} IN ('pending', 'green', 'red')`,
    ),
  ],
);

export const routineCodeCacheRelations = relations(
  routineCodeCache,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [routineCodeCache.tenant_id],
      references: [tenants.id],
    }),
    routine: one(routines, {
      fields: [routineCodeCache.routine_id],
      references: [routines.id],
    }),
  }),
);
