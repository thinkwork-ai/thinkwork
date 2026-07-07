/**
 * Document conformance recording (THINK-189 U3): every successful emission
 * on a manifest-bearing plate appends one report row — the compositor's
 * structural facts plus everything the async judge sweeper needs to score
 * the exact emission later (a content-addressed digest pin and a manifest
 * snapshot frozen at record time).
 *
 * Best-effort by contract (R3): callers wrap this so a recording failure
 * logs and never blocks, fails, or delays the emission.
 */

import { createHash } from "node:crypto";
import { getDb } from "@thinkwork/database-pg";
import { documentConformanceReports } from "@thinkwork/database-pg/schema";
import type {
  AnalysisFact,
  CompositorSectionFacts,
  SectionFact,
} from "./document-compositor.js";
import type {
  PlateAnalysisSpec,
  PlateSectionSpec,
} from "./plate-definitions.js";
import {
  artifactContentKey,
  writeArtifactPayloadToS3,
} from "./payload-storage.js";

/**
 * The judge-relevant slice of the resolved plate, frozen onto the report row
 * at record time so later plate edits never skew judgment of older reports.
 */
export interface ConformanceManifestSnapshot {
  sections: Array<{
    id: string;
    title: string;
    tier: string;
    guidance: string;
    suggestedDirectives: Array<{ kind: string; chartType?: string }>;
  }>;
  analyses: Array<{
    key: string;
    op: string;
    presentation: { directive: string; chartType?: string };
  }>;
}

export function buildManifestSnapshot(plate: {
  sections?: readonly PlateSectionSpec[];
  analyses?: readonly PlateAnalysisSpec[];
}): ConformanceManifestSnapshot {
  return {
    sections: (plate.sections ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      tier: s.tier,
      guidance: s.guidance,
      suggestedDirectives: (s.suggestedDirectives ?? []).map((d) => ({
        kind: d.kind,
        ...(d.chartType !== undefined ? { chartType: d.chartType } : {}),
      })),
    })),
    analyses: (plate.analyses ?? []).map((a) => ({
      key: a.key,
      op: a.op,
      presentation: {
        directive: a.presentation.directive,
        ...(a.presentation.chartType !== undefined
          ? { chartType: a.presentation.chartType }
          : {}),
      },
    })),
  };
}

/**
 * A report is judgeable when the judge's finding types have something to
 * anchor on: thin-section judgment needs section guidance; asserted-not-
 * computed judgment needs a declared analysis. Neither → judge_status starts
 * `skipped` and the sweeper never claims the row.
 */
export function isJudgeable(snapshot: ConformanceManifestSnapshot): boolean {
  return (
    snapshot.sections.some((s) => s.guidance.trim().length > 0) ||
    snapshot.analyses.length > 0
  );
}

export interface ConformanceRecordInput {
  tenantId: string;
  artifactId: string;
  plateSlug: string;
  documentStatus: "draft" | "final";
  /** The emitted digest — pinned content-addressed so the judge scores it. */
  digestMarkdown: string;
  sectionFacts: CompositorSectionFacts;
  manifestSnapshot: ConformanceManifestSnapshot;
}

export interface ConformanceReportRow {
  tenant_id: string;
  artifact_id: string;
  plate_slug: string;
  document_status: string;
  digest_revision: string;
  manifest_snapshot: ConformanceManifestSnapshot;
  sections: SectionFact[];
  analyses: AnalysisFact[];
  judge_status: "pending" | "skipped";
}

/** Pure row construction — the digest revision is the digest-only sha256
 * (distinct from the finalize pin's digest+render hash; both live in the
 * same content-addressed key namespace). */
export function buildConformanceReportRow(
  input: ConformanceRecordInput,
): ConformanceReportRow {
  const digestRevision = createHash("sha256")
    .update(input.digestMarkdown)
    .digest("hex");
  return {
    tenant_id: input.tenantId,
    artifact_id: input.artifactId,
    plate_slug: input.plateSlug,
    document_status: input.documentStatus,
    digest_revision: digestRevision,
    manifest_snapshot: input.manifestSnapshot,
    sections: input.sectionFacts.sections,
    analyses: input.sectionFacts.analyses,
    judge_status: isJudgeable(input.manifestSnapshot) ? "pending" : "skipped",
  };
}

/** Injectable seams so tests exercise recording without a live DB/S3. */
export interface ConformanceRecordDeps {
  writePayload: typeof writeArtifactPayloadToS3;
  insertReport: (row: ConformanceReportRow) => Promise<void>;
}

function defaultRecordDeps(): ConformanceRecordDeps {
  return {
    writePayload: writeArtifactPayloadToS3,
    insertReport: async (row) => {
      await getDb().insert(documentConformanceReports).values(row);
    },
  };
}

export const CONFORMANCE_DIGEST_CONTENT_TYPE = "text/markdown; charset=utf-8";

/**
 * Record one conformance report: pin the digest at its content-addressed
 * revision key (idempotent — same digest re-emitted writes the same bytes to
 * the same key), then insert the report row. Drafts have no finalize pin, so
 * the recorder owns this write for every report uniformly.
 */
export async function recordDocumentConformance(
  input: ConformanceRecordInput,
  deps: ConformanceRecordDeps = defaultRecordDeps(),
): Promise<void> {
  const row = buildConformanceReportRow(input);
  await deps.writePayload({
    tenantId: input.tenantId,
    key: artifactContentKey({
      tenantId: input.tenantId,
      artifactId: input.artifactId,
      revision: row.digest_revision,
    }),
    body: input.digestMarkdown,
    contentType: CONFORMANCE_DIGEST_CONTENT_TYPE,
  });
  await deps.insertReport(row);
}

// ---------------------------------------------------------------------------
// Aggregation (THINK-189 U6): per-plate, per-section rates over the report
// corpus for the operator Plates surface. Judge coverage may lag structural
// coverage, so judge-derived counts carry their own denominator (judgedRuns)
// — the UI must never present a judge rate over a silently smaller sample.
// ---------------------------------------------------------------------------

/** How much corpus one summary reads: the newest N reports for the plate. */
export const CONFORMANCE_SUMMARY_MAX_REPORTS = 500;

export interface ConformanceReportCorpusRow {
  sections: SectionFact[];
  analyses: AnalysisFact[];
  judgeStatus: string;
  judgeFindings: {
    thinSections?: Array<{ sectionId: string }>;
    assertedNotComputed?: Array<{ sectionId: string }>;
  } | null;
}

/** Injectable read seam so tests exercise aggregation without a live DB. */
export interface ConformanceReportReadStore {
  listByTenantAndPlate(
    tenantId: string,
    plateSlug: string,
    limit: number,
  ): Promise<ConformanceReportCorpusRow[]>;
}

export function drizzleConformanceReportReadStore(): ConformanceReportReadStore {
  return {
    listByTenantAndPlate: async (tenantId, plateSlug, limit) => {
      const { documentConformanceReports: table } =
        await import("@thinkwork/database-pg/schema");
      const { and, desc, eq } = await import("drizzle-orm");
      const rows = await getDb()
        .select({
          sections: table.sections,
          analyses: table.analyses,
          judge_status: table.judge_status,
          judge_findings: table.judge_findings,
        })
        .from(table)
        .where(
          and(eq(table.tenant_id, tenantId), eq(table.plate_slug, plateSlug)),
        )
        .orderBy(desc(table.created_at))
        .limit(limit);
      return rows.map((row) => ({
        sections: (row.sections ?? []) as SectionFact[],
        analyses: (row.analyses ?? []) as AnalysisFact[],
        judgeStatus: row.judge_status,
        judgeFindings:
          row.judge_findings as ConformanceReportCorpusRow["judgeFindings"],
      }));
    },
  };
}

export interface PlateConformanceSectionSummary {
  sectionId: string;
  /** Reports whose facts include this manifest section. */
  runCount: number;
  presentCount: number;
  waivedCount: number;
  missingCount: number;
  /** Runs where the section declared at least one suggested directive. */
  directiveSuggestedRuns: number;
  /** Of those, runs where at least one suggested directive was used. */
  directiveUsedRuns: number;
  /** Judge coverage denominator for this section (complete verdicts only). */
  judgedRuns: number;
  judgedThinRuns: number;
  assertedNotComputedRuns: number;
}

export interface PlateConformanceAnalysisSummary {
  key: string;
  /** Reports whose plate declared this analysis at emission time. */
  declaredRuns: number;
  computedRuns: number;
}

export interface PlateConformanceSummary {
  plateSlug: string;
  reportCount: number;
  /** Reports with a complete judge verdict — the judge-rate denominator. */
  judgedReportCount: number;
  pendingCount: number;
  errorCount: number;
  skippedCount: number;
  sections: PlateConformanceSectionSummary[];
  analyses: PlateConformanceAnalysisSummary[];
}

/**
 * Aggregate the newest reports for one plate (R7/AE2/AE4). Sections and
 * analyses are keyed by what each report's own facts declared, so manifest
 * edits between emissions aggregate honestly (a section added yesterday has
 * yesterday-sized run counts, not the whole corpus).
 */
export async function summarizePlateConformance(
  tenantId: string,
  plateSlug: string,
  store: ConformanceReportReadStore = drizzleConformanceReportReadStore(),
): Promise<PlateConformanceSummary> {
  const rows = await store.listByTenantAndPlate(
    tenantId,
    plateSlug,
    CONFORMANCE_SUMMARY_MAX_REPORTS,
  );

  const sections = new Map<string, PlateConformanceSectionSummary>();
  const analyses = new Map<string, PlateConformanceAnalysisSummary>();
  let judgedReportCount = 0;
  let pendingCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const judged = row.judgeStatus === "complete";
    if (judged) judgedReportCount += 1;
    else if (row.judgeStatus === "pending") pendingCount += 1;
    else if (row.judgeStatus === "error") errorCount += 1;
    else if (row.judgeStatus === "skipped") skippedCount += 1;

    const thinIds = new Set(
      (row.judgeFindings?.thinSections ?? []).map((f) => f.sectionId),
    );
    const assertedIds = new Set(
      (row.judgeFindings?.assertedNotComputed ?? []).map((f) => f.sectionId),
    );

    for (const fact of row.sections) {
      let entry = sections.get(fact.id);
      if (!entry) {
        entry = {
          sectionId: fact.id,
          runCount: 0,
          presentCount: 0,
          waivedCount: 0,
          missingCount: 0,
          directiveSuggestedRuns: 0,
          directiveUsedRuns: 0,
          judgedRuns: 0,
          judgedThinRuns: 0,
          assertedNotComputedRuns: 0,
        };
        sections.set(fact.id, entry);
      }
      entry.runCount += 1;
      if (fact.status === "present") entry.presentCount += 1;
      else if (fact.status === "waived") entry.waivedCount += 1;
      else entry.missingCount += 1;
      if (fact.suggestedDirectives.length > 0) {
        entry.directiveSuggestedRuns += 1;
        if (fact.suggestedDirectives.some((d) => d.used)) {
          entry.directiveUsedRuns += 1;
        }
      }
      if (judged) {
        entry.judgedRuns += 1;
        if (thinIds.has(fact.id)) entry.judgedThinRuns += 1;
        if (assertedIds.has(fact.id)) entry.assertedNotComputedRuns += 1;
      }
    }

    for (const fact of row.analyses) {
      let entry = analyses.get(fact.key);
      if (!entry) {
        entry = { key: fact.key, declaredRuns: 0, computedRuns: 0 };
        analyses.set(fact.key, entry);
      }
      entry.declaredRuns += 1;
      if (fact.computed) entry.computedRuns += 1;
    }
  }

  return {
    plateSlug,
    reportCount: rows.length,
    judgedReportCount,
    pendingCount,
    errorCount,
    skippedCount,
    sections: [...sections.values()].sort((a, b) =>
      a.sectionId.localeCompare(b.sectionId),
    ),
    analyses: [...analyses.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}
