import type { LakeHouseRunEvidence } from "../../src/edge-integration";

export type ParityCheckStatus = "passed" | "failed" | "incomplete";

export interface FivetranComparisonSummary {
  streamName: string;
  fivetranRowCount?: number;
  meltanoRowCount?: number;
  freshnessLagMinutes?: number;
  cursorHandling?: ParityCheckStatus;
  lateCorrections?: ParityCheckStatus;
  deleteReversals?: ParityCheckStatus;
  schemaDrift?: ParityCheckStatus;
  downstreamDbt?: ParityCheckStatus;
}

export interface ParityReport {
  status: ParityCheckStatus;
  integrationKey: string;
  bundleVersion: string;
  runId: string;
  comparisons: FivetranComparisonSummary[];
  findings: string[];
  decision: "expand_substrate" | "continue_mcpherson_specific" | "not_ready";
}

export function buildParityReport(input: {
  evidence: LakeHouseRunEvidence;
  comparisons: FivetranComparisonSummary[];
}): ParityReport {
  const findings: string[] = [];
  const evidenceStreams = new Set(
    input.evidence.extracts.map((extract) => extract.streamName),
  );

  if (input.comparisons.length === 0) {
    findings.push("No Fivetran comparison data supplied");
  }

  for (const comparison of input.comparisons) {
    if (!evidenceStreams.has(comparison.streamName)) {
      findings.push(`${comparison.streamName}: missing Meltano evidence`);
    }
    if (
      comparison.fivetranRowCount === undefined ||
      comparison.meltanoRowCount === undefined
    ) {
      findings.push(`${comparison.streamName}: missing row-count comparison`);
    } else if (comparison.fivetranRowCount !== comparison.meltanoRowCount) {
      findings.push(`${comparison.streamName}: row counts differ`);
    }
    for (const key of [
      "cursorHandling",
      "lateCorrections",
      "deleteReversals",
      "schemaDrift",
      "downstreamDbt",
    ] as const) {
      if (!comparison[key] || comparison[key] === "incomplete") {
        findings.push(`${comparison.streamName}: ${key} incomplete`);
      } else if (comparison[key] === "failed") {
        findings.push(`${comparison.streamName}: ${key} failed`);
      }
    }
  }

  const status: ParityCheckStatus =
    findings.length === 0
      ? "passed"
      : findings.some(
            (finding) =>
              finding.includes("missing") ||
              finding === "No Fivetran comparison data supplied",
          )
        ? "incomplete"
        : "failed";

  return {
    status,
    integrationKey: input.evidence.integrationKey,
    bundleVersion: input.evidence.bundleVersion,
    runId: input.evidence.runId,
    comparisons: input.comparisons,
    findings,
    decision: status === "passed" ? "expand_substrate" : "not_ready",
  };
}
