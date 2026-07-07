/**
 * Document conformance reports (THINK-189).
 *
 * One row per successful document emission on a manifest-bearing plate: the
 * deterministic structural facts computed at compile time (sections
 * present/missing/waived, body size, suggested directives used/skipped,
 * declared analyses computed/absent) plus an asynchronous LLM-judge layer
 * (thin sections, asserted-not-computed numbers) written by the conformance
 * judge sweeper.
 *
 * Append semantics: rows accumulate as a corpus over runs — unlike
 * document_section_waivers, which keeps only head state. Aggregated per
 * plate by summarizePlateConformance for the operator Plates surface.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core";
import { artifacts } from "./artifacts";

export const CONFORMANCE_JUDGE_STATUSES = [
  "pending",
  "complete",
  "error",
  "skipped",
] as const;
export type ConformanceJudgeStatus =
  (typeof CONFORMANCE_JUDGE_STATUSES)[number];

export const documentConformanceReports = pgTable(
  "document_conformance_reports",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Reports belong to their document artifact: cascade the delete.
    artifact_id: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    /** The plate the document was emitted against (denormalized for R7). */
    plate_slug: text("plate_slug").notNull(),
    /** Document status at emission time (draft | finalized). */
    document_status: text("document_status").notNull(),
    /**
     * Content-addressed digest key from the emission's pin — the judge
     * scores exactly this digest, never the mutable S3 head (the artifact
     * may recompile between record and judge).
     */
    digest_revision: text("digest_revision").notNull(),
    /**
     * Judge-relevant slice of the resolved plate at record time (section
     * ids, tiers, guidance, declared analyses), so later plate edits don't
     * skew judgment of older reports.
     */
    manifest_snapshot: jsonb("manifest_snapshot").notNull(),
    /** Structural facts: SectionFact[] from the compositor (THINK-189 U1). */
    sections: jsonb("sections").notNull(),
    /** Declared-analysis facts: AnalysisFact[] from the compositor. */
    analyses: jsonb("analyses").notNull(),
    judge_status: text("judge_status").notNull().default("pending"),
    judge_attempts: integer("judge_attempts").notNull().default(0),
    judge_model: text("judge_model"),
    /** Judge verdict: { thinSections: [...], assertedNotComputed: [...] }. */
    judge_findings: jsonb("judge_findings"),
    judge_completed_at: timestamp("judge_completed_at", {
      withTimezone: true,
    }),
    judge_error: text("judge_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("document_conformance_reports_tenant_plate_created_idx").on(
      table.tenant_id,
      table.plate_slug,
      table.created_at,
    ),
    // Sweeper scan: pending rows only.
    index("document_conformance_reports_judge_pending_idx")
      .on(table.created_at)
      .where(sql`${table.judge_status} = 'pending'`),
    check(
      "document_conformance_reports_judge_status_check",
      sql`${table.judge_status} IN ('pending', 'complete', 'error', 'skipped')`,
    ),
  ],
);
