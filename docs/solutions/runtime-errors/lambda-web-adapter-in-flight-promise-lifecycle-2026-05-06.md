---
title: "Lambda Web Adapter waits for awaited Promises before HTTP response"
date: 2026-05-06
category: runtime-errors
module: packages/agentcore-flue/agent-container
problem_type: institutional_gap
component: runtime
symptoms:
  - "Plan §2026-05-06-001 (Flue auto-retain) flagged that the institutional record had no entry on whether Lambda Web Adapter (LWA) freezes background Promises at HTTP-response time"
  - "Reliability reviewer flagged P1 concern that awaiting an InvokeCommand on the user-response critical path could either delay the response or get truncated mid-handshake — neither was empirically known"
  - "Decision in plan U2 was conservative: await the InvokeCommand before HTTP response; revisit after observing dev"
root_cause: undocumented_behavior
resolution_type: empirical_observation
severity: low
related_components:
  - "agentcore_runtime"
  - "lambda_web_adapter"
  - "memory_pipeline"
---

# Lambda Web Adapter in-flight Promise lifecycle

## Background

Plan §2026-05-06-001 added end-of-turn auto-retain on the Flue runtime: after each agent turn, the trusted handler invokes the `memory-retain` Lambda with `InvocationType=Event` so Hindsight's reflection layer can persist the conversation transcript.

The implementation question was whether to:

1. **`await` the `InvokeCommand`** before the HTTP response — guarantees the Event invoke is queued by the AWS data plane, but adds InvokeCommand RTT (~tens of ms) to the user-facing response.
2. **`void retainConversation(...).catch(log)`** — keeps the response path snappy but relies on Lambda Web Adapter (LWA) keeping the Node event loop alive long enough for the unawaited Promise to complete after `res.end()`.

The plan chose (1) because the institutional record had no entry on (2). The reliability reviewer flagged this as P1 in the autofix review, but accepted the conservative default pending empirical observation.

## What we observed

After PR #836 (auto-retain) and PR #838 (smoke gate extension) merged and deployed, four production deploy runs exercised the awaited path:

| Deploy | Date | Outcome |
|--------|------|---------|
| 25431722506 | 2026-05-06 | Flue Smoke Test green; no LWA truncation observed |
| 25436770816 | 2026-05-06 | Flue Smoke Test green |
| 25439216873 | 2026-05-06 | First run with the 3-scenario gate (incl. memory-bearing); `flue_retain.retained === true` returned in response |
| 25441410280 | 2026-05-06 | Drift confirm run; all gates green end-to-end |

Plus a manual smoke-equivalent test through admin chat (told Marco "remember I prefer rooibos tea"; fresh thread surfaced "rooibos" via `hindsight_recall`) confirmed the retain Lambda was actually invoked and Hindsight ingested the transcript — empirical proof the Event invoke was queued, not truncated mid-handshake.

**Conclusion: LWA waits for awaited Promises before sending the HTTP response.** The awaited `LambdaClient.send(InvokeCommand)` pattern works as intended in production. Latency cost is ~tens of ms (single 202 from the Lambda data plane); user-perceived chat latency remains dominated by the Bedrock inference (~9-12s typical) and is not materially affected.

## What we did NOT verify

- Whether LWA also waits for **unawaited** Promises (`void p.catch(...)`) before exit. We did not run the unawaited variant in production. The conservative default (await) sidesteps the question entirely. If a future change wants the unawaited variant for latency reasons, it must run an explicit dev-stage test — log a sentinel after `await fetch(...)` AFTER `res.end()` in a controlled probe, then check CloudWatch for the sentinel post-response.
- Behavior under Lambda concurrent-execution throttling. SDK retry budget and connection pool exhaustion under sustained load have not been characterized.
- LWA behavior when the awaited Promise rejects mid-handshake. Today's retain client catches all errors before the await returns, so this code path is unreachable for retain — but other call sites should not assume the same.

## How to apply

When porting fire-and-forget background dispatches into LWA-fronted Lambdas:

- **Default to `await`** the dispatch before HTTP response unless you have a measured latency concern. The institutional answer (this doc) confirms it works; the unawaited variant is undocumented.
- **Wrap the awaited call** in a try/catch (or use the `{retained, error?}` return-shape pattern from `memory-retain-client.ts`) so dispatch failures never propagate to the user-facing response.
- **Surface dispatch status in the response payload** when the smoke gate or downstream consumers need to assert the dispatch happened (see PR #838's `flue_retain` field for the pattern).

## Related

- Plan: `docs/plans/2026-05-06-001-feat-flue-auto-retain-end-of-turn-plan.md` (working document — never merged to main; PRs are the durable record)
- Implementation: PR #836 (`feat(flue): auto-retain end-of-turn transcripts via memory-retain Lambda`)
- Smoke gate hardening: PR #838 (`feat(flue): pin auto-retain dispatch in deploy smoke`)
- Residual review findings: `docs/residual-review-findings/feat-flue-auto-retain.md`
- Source of the conservative await default: `packages/agentcore-flue/agent-container/src/server.ts` retain hook between `runResult` error guard and `postCompletion`
