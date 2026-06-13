---
title: Bounded retry + error taxonomy for Bedrock/Lambda throttling in SQS eval workers
date: 2026-06-13
category: best-practices
module: packages/api eval-worker, packages/evals-core
problem_type: best_practice
component: background_job
severity: high
applies_when:
  - "An SQS-driven Lambda worker invokes Bedrock (or another throttle-prone AWS API) per message"
  - "A throttled or timed-out message must not silently dead-letter without a result row"
  - "A score/verdict is computed downstream and infra failures must not be counted as behavioral failures"
tags: [bedrock, throttling, sqs, retry, dlq, eval, error-taxonomy, fail-closed]
---

# Bounded retry + error taxonomy for Bedrock/Lambda throttling in SQS eval workers

## Context

The eval-worker (`packages/api/src/handlers/eval-worker.ts`) fans out one SQS message per eval case and invokes the agent runtime + a Bedrock Converse judge. Two failure modes corrupted results: (1) Bedrock/Lambda throttling threw, the message redrove, and on exhaustion it landed in the DLQ **with no result row** — the run sat `running` until a 15-minute reconciler closed it. (2) Invoke timeouts were converted into a synthetic failing assertion, so an infra timeout scored as a *behavioral* `fail` and dragged down the agent's pass rate. Both made the headline number untrustworthy.

## Guidance

Treat infrastructure outcomes as a first-class, non-scoring verdict class, and make retry exhaustion produce a row rather than silence:

1. **Classify infra outcomes as `error` with a cause**, never as behavioral `fail`. Add an `error_cause` (`timeout | throttle | evaluator_error | reconciler | infra_other`) and compute the score over clean executions only (`pass_rate = passed / (passed + failed)`, errors excluded). A timeout is `error/timeout`, not a failed assertion.

2. **Match the real throttle shapes**, not just one. The retryable matcher must cover `$metadata.httpStatusCode === 429`, error names (`ThrottlingException`, `TooManyRequestsException`, `ServiceQuotaExceededException`), and message variants (`Lambda throttled`, `Rate exceeded`). Keep genuine timeouts **non-retryable** via SQS — they already consumed their budget; record `error/timeout` immediately instead of burning redrives.

3. **Bound retries to the queue's `maxReceiveCount` and write a row on the final receive.** Plumb the redrive `maxReceiveCount` to the worker as an env var sourced from the *same* terraform local as the queue policy (so they can't drift — the original code's comment said 3 while the policy said 5). Compare `ApproximateReceiveCount` against it; on the final receive, **catch instead of rethrow** and write `error/throttle`. Non-final receives rethrow to redrive as normal. This guarantees every case terminates with a result instead of vanishing into the DLQ.

4. **Engine/judge crashes are `error/evaluator_error`, not `fail`.** A Converse error or an unparseable verdict must not silently degrade to a heuristic that emits a behavioral fail. Throw a typed error the worker maps to `error/evaluator_error`; let throttles from the judge rethrow so they redrive like any other throttle.

## Why This Matters

A score is only trustworthy if infra noise is excluded from it. Counting timeouts/throttles as behavioral failures (or losing them entirely to the DLQ) means the number conflates "the agent did the wrong thing" with "the harness was flaky" — exactly the conflation that made a prior 62% pass rate unactionable. Bounding retries to the queue policy and always writing a terminal row also removes the "stuck at running until the reconciler fires" tail.

## When to Apply

- Any SQS→Lambda worker calling Bedrock or another throttle-prone API where a downstream metric aggregates per-message outcomes.
- Whenever a message could exhaust redrives — write a terminal row on the last receive rather than relying solely on a reconciler.
- Whenever infra failures and behavioral failures share an output channel — split them with an explicit cause.

## Examples

Final-receive handling (shape, not literal):
```ts
const finalReceive = receiveCount >= evalFanoutMaxReceiveCount(); // env from the same tf local as the redrive policy
try {
  // ... invoke + score ...
} catch (err) {
  if (isRetryableEvalInfrastructureError(err) && !finalReceive) throw err; // redrive
  await writeResult({ status: "error", error_cause: classifyCause(err) });  // timeout|throttle|evaluator_error|infra_other
}
```
Aggregation excludes errors: a run of `100 pass / 21 fail / 68 error` reports `pass_rate = 100/(100+21) = 0.8264`, with the 68 errors shown as run health, not score.

## Related
- `docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md` (U3, U12)
- Aligns with the agentic-AI fault-taxonomy principle: infrastructure faults belong in a separate analysis track from behavioral failures.
