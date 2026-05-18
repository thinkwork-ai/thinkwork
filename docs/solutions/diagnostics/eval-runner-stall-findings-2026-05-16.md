---
title: Eval runner stall findings
date: 2026-05-16
category: diagnostics
module: evaluations
problem_type: timeout
component: eval-runner
severity: high
applies_when:
  - Full-corpus eval runs stay running with 0 completed results
  - eval-runner Lambda approaches the 900 second timeout
  - AgentCore evaluator runs include CloudWatch span collection
tags:
  - evaluations
  - agentcore
  - cloudwatch
  - lambda
  - probe-first
related_components:
  - packages/api/src/handlers/eval-runner.ts
  - scripts/eval-stall-probe.ts
  - packages/api/scripts/eval-stall-probe.ts
---

# Eval Runner Stall Findings

## Context

The eval dashboard had three full-corpus runs stuck at `running` with `0/96`
results. The suspected root cause was that the current `eval-runner` Lambda
does all per-case work inside one 900 second invocation with concurrency 5.

U1 added a committed probe at `scripts/eval-stall-probe.ts`. The root entrypoint
delegates to `packages/api/scripts/eval-stall-probe.ts` so pnpm resolves the API
package's Bedrock, CloudWatch, Drizzle, and database dependencies correctly.

## Probe

The probe mirrors the current per-case stages without updating `eval_runs` or
persisting `eval_results`:

1. Resolve the same enabled test case selection as `eval-runner`.
2. Invoke AgentCore with the same runtime/session payload shape.
3. Wait for spans with the same initial wait and polling logic.
4. Call each configured AgentCore evaluator.
5. Optionally measure an `eval_results` insert inside a transaction that rolls
   back immediately.

Commands run against the dev tenant's stuck full-corpus run
`b945fc4d-c811-4c60-bec5-56e5bd2aabad`:

```bash
pnpm exec tsx scripts/eval-stall-probe.ts \
  --run-id b945fc4d-c811-4c60-bec5-56e5bd2aabad \
  --limit 5 \
  --concurrency 5 \
  --invoke-timeout-ms 60000 \
  --evaluator-timeout-ms 60000 \
  --measure-db-write
```

```bash
pnpm exec tsx scripts/eval-stall-probe.ts \
  --run-id b945fc4d-c811-4c60-bec5-56e5bd2aabad \
  --test-case-ids <one enabled case from each existing category> \
  --concurrency 5 \
  --invoke-timeout-ms 90000 \
  --evaluator-timeout-ms 90000 \
  --measure-db-write
```

The dev tenant has 96 enabled yaml-seed cases across the nine maniflow-era
categories. Every enabled case has at least one AgentCore evaluator configured.

## Measurements

Five-case first slice, all from `email-calendar`:

| Stage | Count | p50 | p95 | Max | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| AgentCore invoke | 5 | 7.8s | 8.4s | 8.4s | 36.0s |
| Span wait/fetch | 5 | 30.7s | 30.7s | 30.7s | 152.8s |
| AgentCore evaluate | 5 | 6.5s | 7.2s | 7.2s | 32.8s |
| DB insert rollback | 5 | 114ms | 292ms | 292ms | 823ms |
| Total per case | 5 | 45.6s | 46.6s | 46.6s | 223.1s |

One-case-per-category slice:

| Stage | Count | p50 | p95 | Max | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| AgentCore invoke | 8 | 9.1s | 15.8s | 15.8s | 75.1s |
| Span wait/fetch | 8 | 30.6s | 32.2s | 32.2s | 246.3s |
| AgentCore evaluate | 8 | 7.1s | 8.2s | 8.2s | 54.4s |
| DB insert rollback | 8 | 119ms | 234ms | 234ms | 1.1s |
| Total per case | 9 | 47.4s | 90.2s | 90.2s | 467.9s |

One `sub-agents` case exceeded the probe's 90 second invoke abort, so the table
has eight successful stage measurements plus one timeout row. The successful
cases were enough to locate the steady-state bottleneck: span wait/fetch is the
dominant measured stage, mostly because the runner always sleeps for the 30
second initial span wait even when spans are available.

## Findings

The 0/96 stall is a Lambda wall-clock timeout, not a DB write problem.

At the current runner concurrency of 5, the cross-category median per-case wall
time was about 47 seconds. A 96 case corpus needs roughly `ceil(96 / 5) = 20`
waves. Even using the median wave time, the projected run time is about
`20 * 47s = 940s`, already over the 900 second Lambda limit. Tail cases like the
90 second aborted `sub-agents` invoke push the full run farther past the limit.

Stage-level summary:

- AgentCore invoke is usually single-digit seconds, but has tail risk.
- Span wait/fetch is the largest steady-state stage at about 30 seconds per
  successful case.
- AgentCore Evaluate is meaningful but smaller, about 5 to 8 seconds per case
  in this sample.
- `eval_results` insert latency is not material; rollback-only insert probes
  were under 300ms.

Because the current runner only writes `eval_results` after each case finishes,
a Lambda timeout can kill in-flight cases before their rows are inserted. That
matches the dashboard symptom: the full-corpus run stays `running` with no
completed rows even though the runner did real work before timing out.

## Recommendation

Proceed with the U2/U3 per-case SQS fan-out substrate.

The right fan-out granularity is one message per test case. Per-case workers
keep each invocation below the 900 second ceiling, isolate tail latency and
application errors to one case, and let successful cases persist results even
when a sibling case crashes or times out.

The worker timeout should not be set from the median. Use a conservative value
above the observed tail, for example 180 to 240 seconds initially, then tighten
after U3 records production worker timing. Keep `BatchSize=1` so one slow or
failing case does not hold a batch hostage.

Future optimization can reduce per-case wall time by polling spans earlier or
making the initial wait configurable, but that is not sufficient by itself for
full-corpus correctness. Even a smaller span wait would still leave all cases
coupled to one Lambda invocation and one terminal failure mode.

## Reproduction Notes

To rerun without leaving rows behind:

```bash
pnpm exec tsx scripts/eval-stall-probe.ts \
  --run-id <eval_run_id> \
  --concurrency 5 \
  --invoke-timeout-ms 90000 \
  --evaluator-timeout-ms 90000 \
  --measure-db-write
```

`--measure-db-write` performs the insert inside a transaction and rolls it back
immediately. Omit it if you only need AgentCore and span timing.
