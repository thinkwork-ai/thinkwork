---
title: Env-gated features are dead in prod unless the flag is wired into terraform
date: 2026-06-13
category: workflow-issues
module: packages/api eval-worker, terraform/modules/app
problem_type: workflow_issue
component: development_workflow
severity: critical
applies_when:
  - "A code path is gated behind process.env.SOMEFLAG"
  - "Tests inject or set the flag in-process rather than reading the deployed env"
  - "The flag's only honest source of truth is a Lambda/service environment block in terraform"
tags: [env-flag, terraform, feature-flag, fail-closed, deploy-verification, eval]
---

# Env-gated features are dead in prod unless the flag is wired into terraform

## Context

The Evaluations Trust Core shipped a Bedrock LLM rubric judge gated behind `EVAL_LLM_JUDGE`. The flag was read correctly in code (`llmJudgeEnabled()` in `packages/api/src/lib/evals/engines/in-house.ts`) and every unit/integration test exercised the judge by injecting it in-process — all green across 11 shipped units. But `EVAL_LLM_JUDGE` was wired into **zero terraform**, so it was unset on the deployed Lambda. In production the judge never ran: every `llm-rubric` fell to a heuristic fallback that returned `pass / 1.00` for any non-refusal rubric. The headline trust number was meaningless and nothing in CI caught it. A human running the feature by hand caught it in minutes (a non-table answer scoring a perfect pass).

## Guidance

When a feature is gated behind an environment flag, "the code reads it" and "the tests pass" do not mean it is on in production. Before calling it done:

1. **Verify the flag is set in the deployed environment**, not just in code/tests:
   ```bash
   aws lambda get-function-configuration --function-name <fn> \
     --query "Environment.Variables.<FLAG>" --output text
   ```
   or grep the service's terraform env block (`terraform/modules/app/lambda-api/handlers.tf` and friends). If the flag isn't there, the feature is off in prod regardless of green tests.

2. **Make the disabled path fail-closed and visible**, never a silent success. The judge's fallback originally defaulted `passed = true` for unrecognized rubrics — so a misconfiguration looked like a perfect score. The fix made the fallback throw → record `error/evaluator_error` (unscored) for anything it can't honestly evaluate. A loud "unscored" surfaces the gap; a silent pass hides it.

3. **Don't let in-process test injection stand in for deployment wiring.** A test that does `judge: bedrockLlmJudge` proves the judge *works when wired*; it says nothing about whether prod wires it. If a flag has a deployed home, add a check that the deployed home is set (a deploy smoke, a terraform assertion, or a manual `get-function-configuration` in the acceptance step).

## Why This Matters

This is a class of bug CI structurally cannot catch: tests control their own environment, so an env-gated feature is always "on" in the test world and may be permanently off in the deployed world. The blast radius is silent — the feature appears shipped (merged, green, deployed) while being inert. For a trust-bearing feature (an eval score an operator relies on), a silent-pass fallback turns the inert state into actively misleading output.

## When to Apply

- Any `process.env.X`-gated behavior with a deployed home (Lambda env, ECS task def, SSM).
- Especially when the disabled path has a fallback that could be mistaken for success.
- During acceptance/validation: add "confirm the flag is set on the deployed resource" as an explicit step, and prefer a real end-to-end run over trusting the suite.

## Examples

Before (dead in prod, silent): flag read in code, set nowhere in terraform; fallback returns `pass`.

After (live + fail-closed):
```hcl
# terraform/modules/app/lambda-api/handlers.tf — eval-worker env
EVAL_LLM_JUDGE      = "1"
EVAL_JUDGE_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
```
```ts
// disabled/unsupported path no longer returns a vacuous pass:
// non-refusal rubric with no real judge → throw → error/evaluator_error (unscored)
```
Acceptance step: `aws lambda get-function-configuration ... EVAL_LLM_JUDGE` returns `1`, then run one real eval and confirm the verdict reflects the actual output.

## Related
- `docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md` (U12)
- Pairs with the "bare lambda invoke ≠ E2E agent test" and vitest env-capture-timing learnings — all variants of "the deployed environment is not the test environment."
