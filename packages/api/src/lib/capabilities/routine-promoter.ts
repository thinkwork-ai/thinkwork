/**
 * Production Routine proposal promoter (THINK-280 U6).
 *
 * Wires {@link RoutineProposalPromoter} to the single deterministic-routines
 * Git publisher in `@thinkwork/lambda` (`commitRoutineBundle`) — it does NOT
 * introduce a second Routine publisher. The heavy client (Octokit, Secrets
 * Manager, the routine-exec-git gate invoke) is dynamically imported so
 * partially-mocked resolver suites never pull the AWS SDK, matching the
 * admission folder-writer convention.
 *
 * Flow: commit the exact bundle with the expected-head lock, gate the SHA
 * hermetically (routine-exec-git's fixture gate is the sole writer of
 * `validated_sha`), and map the result. A stale head → `commit_conflict`;
 * a red gate → `validation_failed`; a green gate with the SHA promoted →
 * `promoted`.
 *
 * Live dependency-readiness evaluation and the capability-private session
 * that installs the fixture adapter registry into the executor are a U7
 * follow-up; U6 reports readiness as "unknown" alongside the hermetic
 * verdict.
 */

import type {
  RoutineProposalBundle,
  RoutineProposalPromoter,
  RoutinePromotionResult,
} from "./routine-proposal.js";

export function createDefaultRoutineProposalPromoter(): RoutineProposalPromoter {
  return {
    async promote({ proposal, bundle }): Promise<RoutinePromotionResult> {
      const { commitRoutineBundle } =
        await import("@thinkwork/lambda/routine-repo-tools");
      try {
        const result = await commitRoutineBundle({
          tenantId: proposal.tenant_id,
          slug: bundle.slug,
          routineId: proposal.routine_id ?? null,
          displayName: bundle.slug,
          code: bundle.code,
          fixtures: bundle.fixtures.map((f) => ({
            input: f.input,
            expected: f.expected,
            ...(f.mode ? { mode: f.mode } : {}),
            ...(f.invariantPaths ? { invariantPaths: f.invariantPaths } : {}),
          })),
          invariants: bundle.invariants,
          dependencies: bundle.dependencies,
          principal: {
            mode: bundle.principal.mode,
            // The capability-headless executor requires the pinned principal
            // under `servicePrincipalId` for service mode (it fails closed with
            // "service principal mode requires servicePrincipalId" otherwise).
            // Writing it as `subjectId` — which the executor treats as a user
            // subject, never the service principal — made every service-mode
            // headless run fail. Verified live during the THINK-280 dogfood.
            ...(bundle.principal.servicePrincipalId
              ? { servicePrincipalId: bundle.principal.servicePrincipalId }
              : {}),
          },
          provenance: { evidence: bundle.evidence },
          approvedFingerprint: proposal.payload_fingerprint,
        });

        if (result.status === "conflict") {
          return {
            outcome: "commit_conflict",
            reason: `branch moved to ${result.headSha?.slice(0, 12) ?? "unknown"} — re-review and retry`,
          };
        }

        const gate = result.gate;
        const green =
          gate?.status === "gate_green" || gate?.gate?.status === "green";
        const hermetic = gate?.gate
          ? {
              status: gate.gate.status,
              fixtures: gate.gate.fixtures.map((f) => ({
                path: f.path,
                passed: f.passed,
                ...(f.detail ? { detail: f.detail } : {}),
              })),
            }
          : undefined;

        if (!green) {
          return {
            outcome: "validation_failed",
            commitSha: result.commitSha,
            ...(hermetic ? { hermetic } : {}),
            reason: gate?.gate?.errorMessage ?? "hermetic fixture gate was red",
          };
        }

        return {
          outcome: "promoted",
          commitSha: result.commitSha,
          validatedSha: result.validatedSha ?? result.commitSha ?? null,
          ...(hermetic ? { hermetic } : {}),
          // Live dependency-readiness evaluation lands with U7.
          readiness: { ready: true, reasons: ["hermetic_green"] },
        };
      } catch (err) {
        return {
          outcome: "error",
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
