---
title: "Evaluation Runs System Workflow ignored selected test cases"
date: "2026-05-03"
category: "logic-errors"
module: "packages/api/src/handlers/eval-runner.ts"
problem_type: "logic_error"
component: "background_job"
symptoms:
  - "CLI smoke passed one --test-case but the Evaluation Run expanded to all 96 enabled test cases"
  - "system_workflow_runs and Step Functions execution existed, making the launch path look healthy"
  - "SnapshotTestPack step output recorded totalTests: 96 and no selected test case ids"
root_cause: "scope_issue"
resolution_type: "code_fix"
severity: "medium"
related_components:
  - "packages/api/src/graphql/resolvers/evaluations/index.ts"
  - "packages/api/src/lib/system-workflows/asl.ts"
  - "apps/cli/src/commands/eval/run.ts"
tags:
  - "evaluation-runs"
  - "system-workflows"
  - "step-functions"
  - "eval-runner"
  - "test-case-scope"
  - "smoke-test"
---

# Evaluation Runs System Workflow ignored selected test cases

## Problem

The Evaluation Runs System Workflow smoke started a run from the CLI with a single explicit `--test-case`, but the deployed `eval-runner` executed the entire 96-test starter pack. The System Workflow launch path itself was healthy, which made the bug easy to miss unless the smoke checked the domain run's effective `totalTests` and the workflow step output.

## Symptoms

- `thinkwork eval run --test-case <id> --watch` returned a valid run id and moved to `running`.
- `eval get <runId> --no-results` showed `totalTests: 96` instead of `1`.
- `system_workflow_runs` had a valid `evaluation-runs` row with a Step Functions execution ARN.
- `system_workflow_step_events` showed `SnapshotTestPack` and `RunEvaluation` rows, but `SnapshotTestPack.output_json` only included `categories: []` and `totalTests: 96`.
- The first full-suite smoke continued to spend time and evaluator calls on unrelated categories even though the operator selected one test case.

## What Didn't Work

- **Only verifying the launcher.** The smoke proved `startEvalRun` could create an `eval_runs` row, start the `evaluation-runs` state machine, and record a System Workflow run. That did not prove the worker honored the same scope the launcher received.
- **Looking only at GraphQL input.** `startEvalRun` did forward `testCaseIds` into `startSystemWorkflow`, so the resolver and CLI surfaces looked correct. The missing handoff was later, inside the Lambda task worker.
- **Cancelling the run as a fix.** `cancelEvalRun` only marks the `eval_runs` row `cancelled`; it does not stop the Step Functions execution or an already-running Lambda task. Treat cancel as a UI/domain operation unless `StopExecution` is explicitly wired.

## Solution

Make the workflow input part of the runner's scope contract. The runner now reads `event.input.testCaseIds`, gives explicit selected test cases precedence over category filters, and records the selected ids in `SnapshotTestPack` output.

```ts
interface EvalRunnerEvent {
  runId: string;
  systemWorkflowRunId?: string;
  systemWorkflowExecutionArn?: string;
  tenantId?: string;
  input?: {
    testCaseIds?: unknown;
  } | null;
}

export function selectedTestCaseIdsFromEvent(event: EvalRunnerEvent): string[] {
  const ids = event.input?.testCaseIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}
```

```ts
const selectedTestCaseIds = selectedTestCaseIdsFromEvent(event);
const caseConditions = [
  eq(evalTestCases.tenant_id, run.tenant_id),
  eq(evalTestCases.enabled, true),
];

if (selectedTestCaseIds.length > 0) {
  caseConditions.push(inArray(evalTestCases.id, selectedTestCaseIds));
} else if (run.categories.length > 0) {
  caseConditions.push(inArray(evalTestCases.category, run.categories));
}

const cases = await db
  .select()
  .from(evalTestCases)
  .where(and(...caseConditions));
```

The smoke was rerun after PR #775 deployed to dev:

- Eval run `59146ff7-0b2e-4796-8716-4acc7fbfe75a` completed with `passed: 1`, `failed: 0`, `totalTests: 1`, `passRate: 1`.
- System Workflow run `17cec7a0-0d1f-43e7-a2b7-247b4aa5163c` reached `succeeded`.
- `SnapshotTestPack.output_json` included `totalTests: 1` and `testCaseIds: ["54501247-c55e-4131-a914-4c1a1bee8a9f"]`.
- `score-summary` evidence recorded `1/1 tests passed (100.0%)`.

## Why This Works

`categories` are persisted on `eval_runs`, but explicit test-case picks are not. Once Evaluation Runs moved behind a Standard parent state machine, the selected ids became transient workflow input rather than domain-row state. The original runner only looked at the persisted row:

```ts
run.categories.length > 0
  ? inArray(evalTestCases.category, run.categories)
  : sql`true`
```

For a CLI call with `--test-case`, `run.categories` is empty, so the old predicate became `true` and selected every enabled case for the tenant. Reading `event.input.testCaseIds` restores the lost scope and preserves existing behavior:

- `testCaseIds` present: run exactly those enabled tenant-scoped test cases.
- no `testCaseIds`, categories present: run enabled tests in those categories.
- neither present: run all enabled test cases.

Recording `testCaseIds` in `SnapshotTestPack` also makes future smoke failures visible from the System Workflow evidence trail, not only from the evaluation domain row.

## Prevention

- Smoke both layers for every System Workflow adapter: the domain object and the `system_workflow_*` records. A Step Functions execution ARN proves launch, not semantic correctness.
- Include the effective worker scope in the first checkpoint step output. For Evaluation Runs, `SnapshotTestPack` should always expose `totalTests`, `categories`, and `testCaseIds`.
- When wrapping a legacy worker with a System Workflow parent, audit every transient input that is not persisted on the domain row. If the worker needs it, pass and test it explicitly.
- Keep a focused parser/helper test for compact workflow input. The regression test for `selectedTestCaseIdsFromEvent` covers valid ids and malformed/missing input so malformed workflow payloads fall back to category/all behavior instead of throwing.
- After deploying a workflow adapter fix, rerun the smallest real dev smoke that exercises the corrected contract. For this bug, one selected test case was the right smoke; category/all runs would not have caught it.

## Related Issues

- PR #775: `fix(system-workflows): scope eval runner test cases`.
- PR #773: CLI GraphQL serialization fix that unblocked the Evaluation Runs smoke.
- `docs/plans/2026-05-02-013-chore-evaluation-runs-system-workflow-smoke-plan.md` — smoke plan and execution evidence.
- `docs/plans/2026-05-02-008-feat-system-workflow-runtime-eval-adapter-plan.md` — original Evaluation Runs System Workflow adapter plan.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` — related lesson: successful orchestration mechanics can still hide semantic no-ops unless evidence records the invariant being tested.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — related lesson: deployed smoke must verify the real target state, not just local code or migration assumptions.
