---
date: 2026-07-04
topic: think-137-automations-simplification
linear_issue: THINK-137
---

# THINK-137 Automations Simplification — Trigger → Target

## Problem Frame

Automations are a CORE ThinkWork concept, and the current implementation has
accreted two parallel substrates, a speculative spec model, and a creation UX
that exposes runtime machinery nobody uses. THINK-111 (shipped 2026-06-30,
#3137) restyled the form Devin-style but could not fix the underlying model —
three days later the form is still "a complex mess" because the model it
serializes is the mess.

What the code audit (2026-07-04) found:

**Two parallel substrates.** AgentLoops (`agent_loops` / `agent_loop_versions`
/ `agent_loop_runs` / `agent_loop_iterations` / `agent_loop_judgments` /
`agent_loop_evidence`) is the product surface; `scheduled_jobs` + `webhooks`
is the older trigger plumbing. AgentLoops piggybacks on `scheduled_jobs` only
for the EventBridge timer; webhooks can't reach an Automation at all
(`webhooks.target_type` allows only `agent | routine`; the handler never
references `agent_loop`).

**A cathedral spec, mostly empty.** A version is five JSONB blobs
(trigger/goal/worker/judge/loop-policy) + evidence policy. Six trigger
families are declared, two are executable (manual, schedule) — the rest throw
in `normalizeTriggerSpec`. Six judge modes are declared, two pass Phase-1
gates, and the dispatch path writes **zero** judgment or evidence rows. ROI
counters (`accepted_run_count`, `cost_per_accepted_run_usd_cents`, …) are
never incremented. The form dutifully exposes judge criteria, evidence
redaction states, retention days, suitability checkboxes, retry backoff — all
serialized, none load-bearing.

**Duplication.** The `AgentLoopDispatchLedger` is implemented twice, verbatim
(`job-trigger.ts:520-655` and `triggerAgentLoopRun.mutation.ts:222-357`).
Enums are declared in contracts *and* re-declared as CHECK constraints, and
they disagree (schema allows 7 iteration statuses, run-ledger 9). Three create
paths (easy form, preset sheet, builder-thread questions) mutate one draft.
The settings detail route still renders the legacy `ScheduledJobDetail` while
its list renders agent loops; route params are named `$scheduledJobId` for
agent-loop IDs; `ScheduledJobForm.tsx` has no importers.

**Spaces are mandatory, threads are unconditional.** `validateDraft` blocks
save without a Space; every dispatched run gets a thread titled
`Automation: <name>` — which is how we got orphaned "Working…" threads (fixed
for routine-only runs in #3302, but that was a patch on the symptom).

**No user identity.** Runs record `actor_type/actor_id` but nothing injects
that user's memory or context. The one path that genuinely runs *as* a user is
`skill_run` (`job-trigger.ts:1275-1477`: `config.invokerUserId` →
`scope.user_id` in the AgentCore envelope) — a pattern AgentLoops never
adopted.

## Design Thesis

> **An Automation is a Trigger bound to a Target, optionally running as a
> User.** Nothing else is core.

Everything the current model treats as first-class (judge specs, loop policy,
evidence policy, suitability, iterations) is either deleted, demoted to a
target-specific option, or deferred until a runtime actually consumes it. The
name "Automation" stays; "agent loop" vocabulary retires from the product
surface.

```
Automation
├── name, description, enabled
├── Trigger      = schedule (EventBridge)  |  webhook (inbound URL)
├── Target       = agent thread  |  routine  |  workflow
├── Run as       = attached user (memory bank / context injection)
└── Where        = Space (optional — absent ⇒ headless, no thread spam)
```

- **Manual "Run now" is a button, not a trigger family.** Every automation can
  be run manually; it is not something you configure.
- **Webhooks fold in.** A webhook is a *trigger configuration* of an
  Automation (token, rate limit, delivery log), not a separate settings
  entity. Settings → Webhooks page retires; delivery history renders on the
  Automation detail.
- **Targets are pluggable and explicit:**
  - **Agent thread** — instructions prompt; either *new thread per run* (in
    the chosen Space) or *append to a fixed thread*. This is today's default
    behavior, now opt-in rather than unconditional.
  - **Routine** — the THINK-135 `routineActionsSpec` path, already live:
    token-free, threadless, ledger-only. Becomes a first-class target instead
    of a spec bolt-on.
  - **Workflow** — the step_functions engine (existing `routine_executions`
    dispatch).
- **Attached user** adopts the proven `skill_run` identity pattern:
  `invokerUserId` flows into the dispatch envelope so the turn runs with that
  user's memory bank and context. Default = the automation's creator.
- **Headless is normal.** No Space ⇒ no thread. Results live in the run
  ledger; failures raise an inbox item (same pattern as routine infra
  failures). A run that produced output the user should read can still link
  its artifacts from the run detail.

## Actors

- A1. Operator: creates and maintains automations; wants name + trigger +
  target + go.
- A2. End user: receives results (thread message, inbox item) without being
  spammed by machinery threads.
- A3. Agent (THINK-142): authors routines conversationally; a clean
  trigger→target model gives its output an obvious home.

## Key Flows

- F1. **Schedule → routine (headless).** Operator: New Automation → name →
  trigger: schedule (hourly) → target: routine "LastMile check" → run as:
  (self) → no Space. Result: EventBridge fires, executor runs token-free, run
  ledger records, zero threads. (This is the LastMile shape that today
  requires a goal-prompt automation with `agentTurn:false` bolted on.)
- F2. **Webhook → agent thread.** Operator: New Automation → trigger: webhook
  (token minted inline, URL shown) → target: agent thread in Space "Dispatch"
  with instructions "Triage this delivery event…" → run as: dispatcher user.
  Inbound POST creates a run + thread turn with the webhook payload as input;
  delivery log visible on the automation detail.
- F3. **Run now.** Any automation detail → Run now → same dispatch path as its
  trigger, `source='manual_run'`.
- F4. **Headless failure surfaces.** F1's routine breaks → tier-0/tier-1
  repair ladder does its thing → if paused/budget-exhausted, inbox item links
  to the run detail. No thread ever created.

## Requirements

- R1. One Automation entity: name, description, enabled, trigger, target,
  attached user, optional Space. Creation requires exactly: name (derivable),
  trigger, target.
- R2. Trigger families: `schedule` and `webhook` only. Manual invocation is an
  action on every automation, not a family. Declared-but-dead families
  (api/app_event/n8n) are removed from enums and CHECK constraints, not
  Phase-gated.
- R3. Webhook triggers reuse the existing `webhooks` substrate (token auth,
  idempotency, `webhook_deliveries` audit) but bind to an Automation.
  Existing agent-/routine-target webhooks migrate to automations; the
  standalone Settings → Webhooks page folds into Automations.
- R4. Targets: `agent_thread` (new-thread-per-run | fixed-thread),
  `routine`, `workflow`. Target config is target-shaped — instructions only
  exist for agent-thread targets; routine selection only for routine targets.
- R5. Space is optional. Absent Space ⇒ headless run: no thread creation
  anywhere in the dispatch path (generalizing #3302 beyond routine-only).
- R6. Attached user: every automation has a `run_as_user_id` (default
  creator). Dispatch injects it the way `skill_run` does (`scope.user_id` in
  the envelope) so memory/context resolve to that user. Removing the user
  falls back to system actor with no memory injection.
- R7. Failures of headless runs raise a deduplicated inbox item; thread-target
  failures surface in their thread. No silent failures.
- R8. Simple guards only: an optional monthly cost cap and max concurrent
  runs. Judge specs, evidence policy, suitability checklists, loop policy
  (iterations/tokens/backoff/failBehavior) are removed from the product
  surface. Tables/columns that nothing populates (`agent_loop_judgments`,
  `agent_loop_evidence`, ROI counters) are dropped or explicitly parked with
  a dated removal note — not silently retained.
- R9. One dispatch ledger implementation shared by schedule, webhook, and
  manual paths (kills the verbatim duplicate).
- R10. UI: the New Automation form shows exactly the R1 fields plus
  target-specific config; no Advanced accordion of runtime machinery. List
  columns: Name, Trigger, Target, Status, Last run. Legacy surfaces retire:
  `ScheduledJobForm`, `ScheduledJobDetail` under the automations namespace,
  `$scheduledJobId` param naming, `settings.agent-loops.*` redirect stubs.
- R11. Vocabulary: product surface says Automation / Trigger / Target / Run.
  GraphQL may keep `agentLoop*` names during migration but new fields follow
  the new vocabulary.

## What gets deleted vs kept

| Current | Fate |
|---|---|
| `goal_spec.objective` | Kept — becomes agent-thread target `instructions` |
| `trigger_spec` (manual/schedule) | Kept — reshaped; webhook added |
| `worker_spec` | Kept, simplified — profile/agent selector on agent-thread target |
| `judge_spec`, 6 judge modes | Removed from surface; judgments table parked/dropped |
| `loop_policy` (iterations, backoff, failBehavior…) | Removed; replaced by R8 guards |
| `evidence_policy`, evidence table | Removed from surface; parked/dropped |
| Suitability checkboxes | Deleted |
| ROI counters on `agent_loops` | Dropped (never written) |
| `routineActionsSpec` bolt-on | Promoted to `routine` target |
| Standalone `webhooks` settings entity | Becomes webhook-trigger config of an Automation |
| Mandatory `spaceId` + unconditional threads | Optional Space; headless default for routine/workflow targets |
| Builder-thread "Loop Designer questions" card | Superseded by THINK-142 conversational authoring (separate issue) |
| Preset sheet | Keep only if presets reduce to trigger+target templates; else delete |
| Duplicate dispatch ledgers | Single shared implementation (R9) |
| `triggers` alias for `scheduledJobs`, `computer_id` | Dead-name cleanup rides along |

## Decisions

- D1. **Storage — DECIDED (Eric, 2026-07-04): reshape `agent_loops` in
  place.** New `target_spec` JSONB on versions; deprecate the four dead spec
  blobs. Runs/iterations FKs and the dispatch seam survive; GraphQL presents
  "Automation" vocabulary over the existing tables.
- D2. **Judge/evidence model — DECIDED (Eric, 2026-07-04): drop entirely.**
  `agent_loop_judgments` + `agent_loop_evidence` tables, judge modes, and
  evidence policy are removed (code-removal PR first, table DROP after that
  deploys, per migration-ordering rule). Git history preserves the design.
- D3. **Webhook payload → target input mapping.** Simplest v1: raw JSON body
  becomes `{input}` for routines/workflows and is appended to instructions for
  agent-thread targets. Templating/extraction is a later concern.
- D4. **Does `workflow` target mean the step_functions engine only, or also
  the projected `workflows` graph?** Recommendation: step_functions engine
  only; the lazy `workflows/*` projection (~320 lines in job-trigger) is a
  separate cleanup decision.
- D5. **Multiple triggers per automation?** Devin allows trigger lists; our
  current model is one family per version. Recommendation: one trigger per
  automation in v1 — two automations pointing at the same target is cheap and
  keeps the model flat.

## Out of scope

- Conversational routine authoring (THINK-142 owns it; this model gives its
  output a home).
- Routine execution semantics, repair ladder, fixture gating (THINK-135 —
  shipped, untouched).
- The `workflows/*` projection tables and step_functions engine internals
  (beyond being addressable as a target).
- Slack/email inbound events as triggers (future trigger families can be
  added to a model that no longer pre-declares them).
