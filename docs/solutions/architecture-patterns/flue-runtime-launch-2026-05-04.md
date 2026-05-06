---
title: Flue runtime launch — Plan §005 U14 closure
date: 2026-05-04
updated: 2026-05-05
category: docs/solutions/architecture-patterns/
module: agentcore-flue
problem_type: agent_launch
component: agent_runtime
severity: medium
applies_when:
  - Validating Flue's end-to-end runtime path (LWA routing, Bedrock IAM, model id, workspace prompt loader, pi-agent-core loop)
  - Reading Plan §005 U14's actual closure state vs the originally-drafted spec
  - Adding a new runtime to ThinkWork (the smoke-gate pattern below is reusable)
related:
  - docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md
  - docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md
  - docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md
  - docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md
tags:
  - flue
  - launch
  - smoke-gate
  - r14
  - plan-005-completion
---

# Flue runtime launch — Plan §005 U14 closure

Plan §005 U14 was originally framed as "deploy the first ThinkWork agent (Deep Researcher) on Flue and capture cold-start latency." On 2026-05-05 the validation half landed via Marco — the dev-tenant default-template agent — answering through Flue end-to-end with USER.md context. The "deploy the deep researcher" half was unwound: the deep researcher was an example agent the originating brainstorm used to motivate validation, not a real product priority. The cold-start instrumentation, eval-score comparison, and deep-researcher template seeding all went out of scope. See the plan body's U14 re-scope note for the full reasoning.

This document is the durable record of what U14 *actually* validated.

---

## What's true after U14

**Flue runtime is in production on dev.** The dispatcher Lambda `thinkwork-dev-agentcore-flue` accepts a populated invocation payload, bootstraps the workspace from S3, composes the system prompt from local files (USER.md included), invokes Bedrock through the inference-profile-prefixed model ID, and returns a real assistant message via `pi-agent-core`'s Agent loop.

**A deploy-time smoke gate prevents silent regressions.** The `flue-smoke-test` job in `.github/workflows/deploy.yml` runs after `update-agentcore-runtimes` on every dev deploy. It invokes the deployed Flue Lambda with Marco's known IDs across three scenarios — `fresh-thread`, `multi-turn-history`, and `memory-bearing` — and fails the deploy workflow on any of these regressions:

| Regression | Smoke detector | Scenario |
|---|---|---|
| LWA routing breaks (POST `/` not handled) | response is not JSON | all |
| Bedrock IAM missing inference-profile coverage | `totalTokens === 0` (silent ValidationException) | all |
| Sonnet 4.5 model ID missing the `us.` inference-profile prefix | `totalTokens === 0` | all |
| `pi-agent-core` Agent loop swallowing an exception silently | `content` is empty even when tokens are non-zero | all |
| Workspace prompt loader regressing (USER.md not inlined) | `content` does not contain `"Eric"` | `fresh-thread` |
| `normalizeHistory` produces structurally invalid `AssistantMessage` | follow-up turn returns 0 tokens / empty content | `multi-turn-history` |
| Auto-retain dispatch broken (missing `MEMORY_RETAIN_FN_NAME`, IAM revocation, LambdaClient throw, await semantics regressed) | `flue_retain.retained === false` despite `use_memory: true` | `memory-bearing` |

The smoke is the structural reason this class of bugs no longer ships silently. Each of the regressions above shipped to dev on 2026-05-05 / 2026-05-06 and was caught only when an operator manually clicked through admin and saw a wrong answer; each cost roughly an hour of diagnostic. The smoke turns each into a deploy-blocker.

**Operator memory-loop verification (post-deploy, manual):** the smoke pins dispatch but does NOT verify Hindsight reflection actually ingested the transcript and that recall surfaces the fact (Hindsight reflection is asynchronous, would balloon smoke runtime, and would introduce flakiness on reflection latency). The full memory loop is operator-driven:

1. In admin chat, tell Marco a memorable fact: *"remember that I prefer rooibos tea"*
2. Confirm a `memory_retain_dispatched` log line appears in CloudWatch within 30s of the chat turn:
   ```
   aws logs filter-log-events \
     --region us-east-1 \
     --log-group-name "/thinkwork/dev/agentcore-flue" \
     --filter-pattern '"memory_retain_dispatched"' \
     --start-time $(($(date +%s)*1000 - 60000))
   ```
3. Open a fresh thread with Marco, ask: *"what kind of tea do I like?"*
4. Marco's `hindsight_recall` should surface "rooibos" within a turn or two — Hindsight's reflection layer is asynchronous, allow up to a minute for fact extraction on the first call.

If step 2 fires but step 4 returns "I don't have that information": the dispatch path is healthy but Hindsight ingestion or recall is broken — escalate to the Hindsight side, not the Flue side.

**Real production-style data captured during validation:**

| Metric | Value | Source |
|---|---|---|
| Model | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Marco's smoke run, 2026-05-05 |
| Total tokens (single chat turn, "What is my name?") | 4,230 | Marco's smoke run |
| Cost (single chat turn) | $0.0159 | Marco's smoke run |
| End-to-end Lambda duration | 7,850 ms | Marco's smoke run, warm container |
| Bare-Lambda probe duration (no Bedrock call) | ~2,000 ms | Pre-fix probe, 2026-05-05 morning |

These numbers are the closest we have to "cold-start latency" without dedicated instrumentation; they capture Lambda dispatch + AgentCore runtime + Bedrock round-trip for a real chat turn. They are not the per-`session.task()` cold-start numbers the original U14 spec asked for — those required code instrumentation that was deferred.

---

## What was deferred (and why)

**Deep researcher agent template.** The 2026-04-26 brainstorm proposed a deep-researcher example agent (search MCP + sub-agent fan-out + Python format skill). The agent was never product-prioritized; the project owner did not recognize the name when asked on 2026-05-05. Seeding `packages/system-workspace/templates/deep-researcher/` and writing the seed script were both unwound from U14's scope.

**`session.task()` cold-start instrumentation.** The runbook's original Step 6 specified `Date.now()` deltas around `StartCodeInterpreterSession` calls to capture p50/p95/p99 across 20+ samples. The instrumentation was never written; it would have required identifying call sites in `packages/agentcore-flue/agent-container/src/server.ts` near the runLoop and the SandboxFactory paths, then defining a stable event-name vocabulary the CloudWatch Logs Insights query could parse. This is roughly a half-day of work and is not load-bearing for the runtime's production-readiness.

If the project ever needs to make the per-task vs shared-session decision the original Open Questions section flagged, instrument first, then sample. Until then, the metric is unmotivated.

**AgentCore Evaluations runs against Flue.** Required a deep-researcher-equivalent agent to compare against a Strands reference. Neither side exists today.

**Mobile-side validation.** The smoke exercises the Lambda directly. Mobile's chat path goes through GraphQL → wakeup-processor → Flue. The wakeup-processor is shared with Strands and works against Marco. Direct mobile validation is an operator-time check; the same smoke gate covers the runtime layer.

---

## Rollback playbook

Per Plan §005 Risks: emergency rollback of any agent from Flue to Strands is a one-line column update on `agent_templates`:

```sql
UPDATE agent_templates
SET runtime = 'strands'
WHERE id = '<agent-template-id>';
```

After rollback:

1. Subsequent invocations for agents on this template route to Strands.
2. In-flight Flue invocations complete (they read the agent's runtime at dispatch time, not turn time).
3. Investigate the Flue-side issue without time pressure; flip back to `'flue'` after the fix is merged + redeployed.

This rollback path requires no code change, no redeploy, no downtime — `chat-agent-invoke`'s runtime selector dispatcher (Plan §005 U3) handles the column flip dynamically.

---

## Strategic Commitments tripwires

Plan §005's Phase 4 follow-up calls for a 2-week production observation deliverable that would land as `docs/solutions/architecture-patterns/flue-vs-strands-dx-comparison-{date}.md`. This deliverable is **separate from plan completion** — Plan §005's `status` flips to `completed` on the smoke landing, not on the DX comparison.

The DX comparison is gated on real production traffic (≥500 turns OR a window beyond 2 weeks if traffic is sparse). Today's traffic is sparse — Marco answers when the operator runs the smoke or when the operator opens admin chat. The comparison fires when an actual product use case routes meaningful traffic through Flue. Until then, this section is a tripwire reminder, not a scheduled artifact.

---

## Re-scope provenance

This document was originally drafted on 2026-05-04 as `flue-deep-researcher-launch-2026-05-04.md` with extensive deep-researcher-specific operator runbook content (seed mutations, AGENTS.md routing, search-MCP wiring, instrumentation methodology, etc.). That content was rewritten on 2026-05-05 when the deep researcher was determined to be zombie scope — see the plan body's U14 re-scope note for the decision rationale. The original runbook content remains in git history at the file's pre-rename path.

---

## Sources & References

- **Plan:** [docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md](../../plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md) — see U14 spec for the re-scope note.
- **Smoke implementation:** PR #827 — `packages/api/src/__smoke__/flue-marco-smoke.ts`, `scripts/post-deploy-smoke-flue.sh`, `.github/workflows/deploy.yml` `flue-smoke-test` job.
- **2026-05-05 Flue runtime fixes:** PRs #815 (LWA routing), #816 (mobile resolver), #817 (Bedrock IAM), #818 (Sonnet 4.5 inference profile), #820 (workspace prompt loader). Each one fixed a regression the smoke now catches at deploy time.
- **Origin brainstorm:** [docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md](../../brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md)
- **FR-9a spike verdict:** [docs/solutions/architecture-patterns/flue-fr9a-integration-spike-verdict-2026-05-03.md](./flue-fr9a-integration-spike-verdict-2026-05-03.md)
- **Runtime selector dispatcher:** `packages/api/src/lib/resolve-runtime-function-name.ts`
