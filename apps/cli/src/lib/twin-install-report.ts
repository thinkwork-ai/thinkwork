/**
 * Install report for `thinkwork twin install` (THINK-334, R3/KTD-8).
 *
 * Aggregates per-step entries into one honest found/created/skipped/failed
 * table with the db-migrate-manual exit-code posture: 0 = complete,
 * 1 = missing/failed, 2 = usage. A step never reported as attempted after
 * the first failure — the runner appends entries in execution order and
 * stops on failure, so the report reflects exactly what ran.
 */

export type StepState = "found" | "created" | "skipped" | "failed" | "pending";

export interface ReportEntry {
  /** Resource or step name, e.g. "etl stack: neptune". */
  resource: string;
  state: StepState;
  detail: string;
}

export interface InstallReport {
  entries: ReportEntry[];
  /** Steps that never ran because an earlier step failed. */
  notAttempted: string[];
}

export function createReport(): InstallReport {
  return { entries: [], notAttempted: [] };
}

export function record(
  report: InstallReport,
  resource: string,
  state: StepState,
  detail: string,
): void {
  report.entries.push({ resource, state, detail });
}

export function markNotAttempted(report: InstallReport, steps: string[]): void {
  report.notAttempted.push(...steps);
}

export function reportHasFailure(report: InstallReport): boolean {
  return report.entries.some(
    (e) => e.state === "failed" || e.state === "pending",
  );
}

/** Exit-code contract: 0 = complete, 1 = failed or work remaining. */
export function reportExitCode(report: InstallReport): 0 | 1 {
  return reportHasFailure(report) || report.notAttempted.length > 0 ? 1 : 0;
}

export function isZeroChange(report: InstallReport): boolean {
  return (
    report.notAttempted.length === 0 &&
    report.entries.length > 0 &&
    report.entries.every((e) => e.state === "found" || e.state === "skipped")
  );
}

const STATE_LABEL: Record<StepState, string> = {
  found: "found ",
  created: "created",
  skipped: "skipped",
  failed: "FAILED ",
  pending: "PENDING",
};

export function renderReport(report: InstallReport): string {
  const lines: string[] = ["", "Twin install report:"];
  const width = Math.max(8, ...report.entries.map((e) => e.resource.length));
  for (const e of report.entries) {
    lines.push(
      `  ${e.resource.padEnd(width)}  ${STATE_LABEL[e.state]}  ${e.detail}`,
    );
  }
  if (report.notAttempted.length > 0) {
    lines.push("", "Not attempted (blocked by the failure above):");
    for (const step of report.notAttempted) lines.push(`  - ${step}`);
  }
  if (reportExitCode(report) === 0) {
    lines.push(
      "",
      isZeroChange(report)
        ? "Complete — no changes (everything already installed)."
        : "Complete.",
    );
  } else {
    lines.push(
      "",
      "Install INCOMPLETE — re-run after fixing the failure; steps are idempotent.",
    );
  }
  return lines.join("\n");
}
