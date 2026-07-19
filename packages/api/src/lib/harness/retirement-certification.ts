export type RuntimeType = "pi" | "agentcore";

export const REQUIRED_RETIREMENT_SURFACES = [
  "multiplayer-eric",
  "multiplayer-sursum",
  "skills",
  "memory",
  "attachments",
  "artifact",
  "question-resume",
  "goal",
  "lastmile",
  "twenty-eric",
  "twenty-sursum",
  "web-search",
  "web-extract",
  "brain",
  "email",
  "browser",
  "sandbox",
  "automation",
  "schedule",
] as const;

export type RetirementSurface = (typeof REQUIRED_RETIREMENT_SURFACES)[number];

export interface RuntimeWindowStats {
  runtimeType: RuntimeType;
  turns: number;
  succeeded: number;
  failed: number;
  missingFinalization: number;
  missingUsage: number;
  missingCost: number;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  totalCostUsd: number;
}

export interface SurfaceEvidence {
  surface: string;
  threadId: string;
  turnId: string;
  runtimeType: string | null;
  status: string;
  finalized: boolean;
  usagePresent: boolean;
  costRows: number;
  piCostRows: number;
  invocationSource: string;
  completedOperations: string[];
  principalIds: string[];
  credentialOwners: string[];
  semanticEvidence: boolean;
  semanticDetail: string;
}

export interface EvalEvidence {
  id: string;
  expectedRuntime: RuntimeType;
  actualRuntime: string | null;
  status: string;
  totalTests: number;
  passed: number;
  failed: number;
  errored: number;
  costPartial: boolean | null;
}

export interface RetirementCertificationInput {
  windowStart: Date;
  windowEnd: Date;
  minimumWindowHours: number;
  minimumSuccessRate: number;
  maximumP95DurationMs: number;
  runtimeStats: RuntimeWindowStats[];
  surfaces: SurfaceEvidence[];
  evals: EvalEvidence[];
  mixedRuntimeThreads: number;
  piCostRowsOnAgentcoreTurns: number;
  orphanToolStarts: number;
  uncertainToolOutcomes: number;
  enrollmentDriftFailures: number;
  canaryCount: number;
  canaryMatches: number;
  rollbackRehearsed: boolean;
  capacityAdmitted: boolean;
}

export type CertificationCheckStatus = "pass" | "pending" | "fail";

export interface CertificationCheck {
  name: string;
  status: CertificationCheckStatus;
  detail: string;
}

export interface RetirementCertificationResult {
  verdict: "PASS" | "IN_PROGRESS" | "FAIL";
  windowHours: number;
  checks: CertificationCheck[];
  missingSurfaces: string[];
}

function check(
  checks: CertificationCheck[],
  name: string,
  status: CertificationCheckStatus,
  detail: string,
): void {
  checks.push({ name, status, detail });
}

function runtimeStats(
  input: RetirementCertificationInput,
  runtimeType: RuntimeType,
): RuntimeWindowStats | undefined {
  return input.runtimeStats.find((row) => row.runtimeType === runtimeType);
}

function validSurface(row: SurfaceEvidence): boolean {
  return (
    row.runtimeType === "agentcore" &&
    row.status === "succeeded" &&
    row.finalized &&
    row.usagePresent &&
    row.costRows > 0 &&
    row.piCostRows === 0 &&
    row.semanticEvidence
  );
}

export function evaluateRetirementCertification(
  input: RetirementCertificationInput,
): RetirementCertificationResult {
  const checks: CertificationCheck[] = [];
  const windowHours =
    (input.windowEnd.getTime() - input.windowStart.getTime()) / 3_600_000;
  check(
    checks,
    "parallel_soak_window",
    windowHours >= input.minimumWindowHours ? "pass" : "pending",
    `${windowHours.toFixed(2)}h / ${input.minimumWindowHours}h required`,
  );

  for (const runtimeType of ["pi", "agentcore"] as const) {
    const stats = runtimeStats(input, runtimeType);
    const successRate = stats?.turns ? stats.succeeded / stats.turns : 0;
    check(
      checks,
      `${runtimeType}_observed`,
      stats && stats.turns > 0 ? "pass" : "pending",
      `${stats?.turns ?? 0} turns`,
    );
    check(
      checks,
      `${runtimeType}_success_rate`,
      !stats || stats.turns === 0
        ? "pending"
        : successRate >= input.minimumSuccessRate
          ? "pass"
          : "fail",
      `${(successRate * 100).toFixed(1)}% / ${(input.minimumSuccessRate * 100).toFixed(1)}% minimum`,
    );
    if (runtimeType === "agentcore") {
      check(
        checks,
        "agentcore_complete_records",
        !stats || stats.turns === 0
          ? "pending"
          : stats.missingFinalization === 0 &&
              stats.missingUsage === 0 &&
              stats.missingCost === 0
            ? "pass"
            : "fail",
        `missing finalization=${stats?.missingFinalization ?? 0}, usage=${stats?.missingUsage ?? 0}, cost=${stats?.missingCost ?? 0}`,
      );
      check(
        checks,
        "agentcore_p95_latency",
        stats?.p95DurationMs == null
          ? "pending"
          : stats.p95DurationMs <= input.maximumP95DurationMs
            ? "pass"
            : "fail",
        `${stats?.p95DurationMs ?? "unknown"}ms / ${input.maximumP95DurationMs}ms maximum`,
      );
    }
  }

  const surfaceMap = new Map(input.surfaces.map((row) => [row.surface, row]));
  const missingSurfaces = REQUIRED_RETIREMENT_SURFACES.filter((surface) => {
    const evidence = surfaceMap.get(surface);
    return !evidence || !validSurface(evidence);
  });
  for (const surface of REQUIRED_RETIREMENT_SURFACES) {
    const evidence = surfaceMap.get(surface);
    check(
      checks,
      `surface:${surface}`,
      !evidence ? "pending" : validSurface(evidence) ? "pass" : "fail",
      evidence
        ? `${evidence.turnId}: ${evidence.semanticDetail}`
        : "no authoritative turn evidence supplied",
    );
  }

  const eric = surfaceMap.get("multiplayer-eric");
  const sursum = surfaceMap.get("multiplayer-sursum");
  const principalOverlap =
    eric && sursum
      ? eric.principalIds.some((principal) =>
          sursum.principalIds.includes(principal),
        )
      : false;
  check(
    checks,
    "multiplayer_distinct_principals",
    !eric || !sursum
      ? "pending"
      : eric.principalIds.length > 0 &&
          sursum.principalIds.length > 0 &&
          !principalOverlap
        ? "pass"
        : "fail",
    `Eric=${eric?.principalIds.join(",") || "missing"}; SurSum=${sursum?.principalIds.join(",") || "missing"}`,
  );

  const twentyEric = surfaceMap.get("twenty-eric");
  const twentySursum = surfaceMap.get("twenty-sursum");
  const sharedCredentialOwner =
    twentyEric && twentySursum
      ? twentyEric.credentialOwners.some((owner) =>
          twentySursum.credentialOwners.includes(owner),
        )
      : false;
  check(
    checks,
    "twenty_distinct_credential_owners",
    !twentyEric || !twentySursum
      ? "pending"
      : twentyEric.credentialOwners.length > 0 &&
          twentySursum.credentialOwners.length > 0 &&
          !sharedCredentialOwner
        ? "pass"
        : "fail",
    `Eric=${twentyEric?.credentialOwners.join(",") || "missing"}; SurSum=${twentySursum?.credentialOwners.join(",") || "missing"}`,
  );

  const evalMap = new Map(input.evals.map((row) => [row.expectedRuntime, row]));
  for (const runtimeType of ["pi", "agentcore"] as const) {
    const evidence = evalMap.get(runtimeType);
    const passed =
      evidence?.status === "completed" &&
      evidence.actualRuntime === runtimeType &&
      evidence.totalTests > 0 &&
      evidence.passed === evidence.totalTests &&
      evidence.failed === 0 &&
      evidence.errored === 0 &&
      evidence.costPartial === false;
    check(
      checks,
      `eval_profile:${runtimeType}`,
      !evidence ? "pending" : passed ? "pass" : "fail",
      evidence
        ? `${evidence.id}: runtime=${evidence.actualRuntime}, ${evidence.passed}/${evidence.totalTests} passed, partialCost=${evidence.costPartial}`
        : "no eval run supplied",
    );
  }

  for (const [name, value] of [
    ["mixed_runtime_threads", input.mixedRuntimeThreads],
    ["pi_cost_rows_on_agentcore_turns", input.piCostRowsOnAgentcoreTurns],
    ["orphan_tool_starts", input.orphanToolStarts],
    ["uncertain_tool_outcomes", input.uncertainToolOutcomes],
    ["enrollment_drift_failures", input.enrollmentDriftFailures],
  ] as const) {
    check(checks, name, value === 0 ? "pass" : "fail", String(value));
  }
  check(
    checks,
    "secret_canary_scan",
    input.canaryCount === 0
      ? "pending"
      : input.canaryMatches === 0
        ? "pass"
        : "fail",
    input.canaryCount === 0
      ? "no injected canaries supplied"
      : `${input.canaryMatches} matches across ${input.canaryCount} canaries`,
  );

  check(
    checks,
    "capacity_admitted",
    input.capacityAdmitted ? "pass" : "pending",
    input.capacityAdmitted
      ? "capacity probe admitted the intended load"
      : "capacity evidence not supplied or not admitted",
  );
  check(
    checks,
    "rollback_rehearsed",
    input.rollbackRehearsed ? "pass" : "pending",
    input.rollbackRehearsed
      ? "AgentCore -> Pi -> AgentCore new-thread default rehearsal recorded"
      : "rollback rehearsal not yet recorded",
  );

  const verdict = checks.some((row) => row.status === "fail")
    ? "FAIL"
    : checks.some((row) => row.status === "pending")
      ? "IN_PROGRESS"
      : "PASS";
  return { verdict, windowHours, checks, missingSurfaces };
}
