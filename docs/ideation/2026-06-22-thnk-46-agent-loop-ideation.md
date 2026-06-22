---
date: 2026-06-22
topic: thnk-46-agent-loop
focus: "Upgrade Automations into agent loops with triggers, goals, judges, and loop workflows."
mode: repo-grounded
linear: THNK-46
---

# Ideation: THNK-46 Agent Loop

## Grounding Context

### Codebase Context

ThinkWork already has several partial loop substrates:

- `scheduled_jobs`, `thread_turns`, and `thread_turn_events` model scheduled work, runs, and run events. `packages/lambda/job-schedule-manager.ts` provisions EventBridge Scheduler rules, and `packages/lambda/job-trigger.ts` dispatches the actual work when a schedule fires.
- The newer workflow control plane already has `workflows`, `workflow_versions`, `workflow_triggers`, `workflow_runs`, `workflow_run_events`, `workflow_evidence`, and engine bindings. Trigger families already include `manual`, `schedule`, `webhook`, `crm`, `n8n`, `api`, `agent`, and `child_workflow`.
- Pi goal mode already provides an objective-oriented runtime loop: `/goal`, `goal_complete`, active/paused/budget-limited/complete states, tenant token budgets, and ThinkWork-managed continuation evidence.
- Agent Profiles already have bounded closed-loop policy: max iterations, review gate, external reviewer policy, fail behavior, max runtime/tokens/cost, and loop evidence for phases, verdicts, budget-limited state, and handoffs.
- Evaluations already exist as a first-class product area backed by Bedrock AgentCore Evaluations, so loop judges should not become a separate one-off judgment system if the same verdict/score/evidence abstraction can serve both runtime loops and offline/continuous evals.
- n8n is already being positioned as a managed ThinkWork application, with native MCP for workflow inspection/drafting and a staged bridge/import path into the workflow control plane.

The key product gap is not the absence of scheduling or workflow records. It is the absence of one loop contract that ties together trigger, goal, judgment, continuation policy, budget, iteration evidence, and activation/monitoring.

### Past Learnings

- `docs/brainstorms/2026-06-20-first-class-workflow-control-plane-requirements.md` decides that `Workflow` is the product/control-plane concept and that `WorkflowRun` plus events/evidence are the trust backbone.
- `docs/ideation/2026-06-18-thnk-21-pi-agent-goal-mode-ideation.md` argues for using Pi goal mode with ThinkWork-owned integration around state, budgets, UI, and continuation.
- `docs/brainstorms/2026-06-08-agent-profile-closed-loops-requirements.md` defines specialist closed loops with discovery, planning, execution, self-review, iteration, handoff, parent final review, and bounded budgets.
- `docs/brainstorms/2026-06-19-n8n-application-plugin-requirements.md` positions n8n as a first-party managed application where agents may inspect, draft, update, test, and run workflows while production activation remains human-controlled.
- `docs/solutions/architecture-patterns/external-workflow-agent-step-bridges-need-resumable-ledgers-2026-06-21.md` is directly relevant by title and architecture neighborhood: external workflow/agent bridges need resumable ledgers rather than fire-and-forget calls.

### External Context

LangChain's "The Art of Loop Engineering" frames the basic agent loop as model + tools + repeated action until completion, then layers verification loops, ambient/trigger loops, and learning loops around it. The useful lesson for ThinkWork is that loops 3 and 4 need ecosystem embedding and criteria/instrumentation, not just a better prompt. Source: https://www.langchain.com/blog/the-art-of-loop-engineering.

n8n is a strong visual trigger/action environment. Its Webhook node can start a workflow from external services, its Wait node can pause an execution and resume on a generated webhook URL, and its public API/n8n node can manage workflows and executions. Sources: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/, https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/, https://docs.n8n.io/api/.

AWS EventBridge Scheduler remains a strong native trigger substrate for time-based work. It supports rate, cron, and one-time schedules, time zones, and predictable 60-second precision. Source: https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html.

AWS Step Functions callback task tokens are a useful precedent for long-running loops that pause until external approval or callback arrives, but they are an engine-level integration pattern, not the whole user-facing loop contract. Source: https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html.

Forward Future's Loop Library is useful prompt-level prior art because its strongest loop examples repeatedly specify the same contract ingredients ThinkWork should make durable: explicit stop conditions, budget/iteration caps, pass/fail/retry criteria, evidence outputs, approval boundaries, and resumable state. Examples include the five-minute repository maintainer loop with a recurring wake and escalation boundaries, the Loop Harness verification loop with an independent verifier and retry limit, the self-improving champion loop with holdout cases and promotion criteria, and the completion-contract loop with requirement-to-evidence tracking. Source: https://signals.forwardfuture.ai/loop-library/.

## Ranked Ideas

### 1. Workflow-Backed AgentLoop Definition

**Description:** Make an AgentLoop a specialized workflow version/profile, not a separate top-level product. Store loop-specific contract data in `WorkflowVersion.definitionSnapshot.loop`: trigger refs, goal contract, judge contract, continuation policy, budget caps, completion behavior, and escalation behavior. Existing `Workflow`, `WorkflowTrigger`, `WorkflowRun`, `WorkflowRunEvent`, and `WorkflowEvidence` records remain the product/run/evidence spine.

**Warrant:** `direct:` `packages/database-pg/src/schema/workflows.ts` already has workflows, versions, trigger families, capability flags, and readiness states; `packages/database-pg/src/schema/workflow-runs.ts` already provides run/event/evidence tables.

**Rationale:** This avoids a fourth workflow noun while giving loops the semantics they need. It lets THNK-46 build on THNK-59 rather than forking the architecture.

**Downsides:** Requires careful UI language so users understand when a workflow is "looping" rather than just "running."

**Confidence:** 92%

**Complexity:** Medium-High

**Status:** Unexplored

### 2. Loop Contract = Trigger + Goal + Judge + Budget

**Description:** Define the loop designer around four primitives: trigger, goal, judge, and budget/continuation policy. The trigger starts or wakes the loop; the goal states what outcome is being pursued; the judge decides pass/fail/continue/escalate; the budget determines how long the loop may keep trying.

**Warrant:** `direct:` THNK-46's prompt names trigger, goal, and loop workflow/judge; existing Pi goal mode already provides objective and budget state, while agent-profile loop policy provides bounded iteration/review behavior.

**Rationale:** This is the cleanest product vocabulary for agent loops. It maps to implementation and keeps the loop designer from becoming a generic DAG editor too early.

**Downsides:** Some business users will expect a visual graph; the first version needs enough UI affordance to feel concrete.

**Confidence:** 90%

**Complexity:** Medium

**Status:** Unexplored

### 3. EventBridge Wake Source, ThinkWork Loop Brain

**Description:** Keep AWS EventBridge Scheduler as the native schedule/wake implementation for time-based loops, but move loop state and continuation decisions into ThinkWork. EventBridge fires; ThinkWork loads the loop goal, prior evidence, budget, and latest judge result to decide whether to act, continue, pause, complete, or escalate.

**Warrant:** `direct:` `packages/lambda/job-schedule-manager.ts` already creates EventBridge Scheduler rules that invoke `job-trigger`; AWS Scheduler supports rate, cron, and one-time schedules; the current `scheduled_jobs` table already carries config, budgets, and EventBridge schedule names.

**Rationale:** This upgrades Automations without throwing away the deployed AWS-native scheduling path. It also respects the project guardrail that ThinkWork is AWS-native.

**Downsides:** EventBridge is not a loop designer; it only solves trigger timing. The UI and judge model still need native ThinkWork work.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 4. n8n As Visual Composer And Integration Bridge, Not Source Of Truth

**Description:** Use n8n where it is naturally strong: trigger variety, visual graph composition, HTTP/Webhook/Wait patterns, and agent-assisted workflow drafting. Let n8n call ThinkWork loop APIs through stock nodes or native MCP, but keep loop identity, goal, judge, budget, run ledger, and completion state in ThinkWork.

**Warrant:** `external:` n8n Webhook nodes can start workflows from external events, Wait nodes can pause and resume via generated webhook URLs, and n8n API/MCP-style access supports workflow and execution management. `direct:` ThinkWork already has `n8n_bridge` bindings and signed bridge-run recording in `packages/api/src/lib/workflows/n8n-bridge-contract.ts`.

**Rationale:** This avoids the false binary between "EventBridge only" and "n8n owns everything." n8n can be the low-code loop authoring/integration layer while ThinkWork remains the enterprise agent OS and audit/control plane.

**Downsides:** Requires a clear staged story, or users will see n8n workflows, ThinkWork workflows, and loops as competing concepts.

**Confidence:** 86%

**Complexity:** Medium-High

**Status:** Unexplored

### 5. Shared JudgmentSpec For Loops And Evals

**Description:** Create a shared `JudgmentSpec` / `JudgmentResult` abstraction that can be used by loop judges, evaluation runs, reviewer profiles, human approvals, and future hill-climbing loops. A loop-specific judge wraps the shared judgment with runtime actions such as retry, pause, complete, or escalate; an eval-specific judgment wraps it with scoring, aggregation, and dataset/reporting behavior.

**Warrant:** `direct:` THNK-46 needs a judge for runtime loops; ThinkWork already has an Evaluations product area and agent-profile reviewer verdicts; workflow run evidence can persist judgment outputs with provenance and evidence refs.

**Rationale:** This gives ThinkWork one vocabulary for "agent judgment" instead of parallel systems for loop completion, eval scoring, reviewer verdicts, and human approvals. It also lets loop runs become eval data, eval criteria graduate into production judges, and hill-climbing loops compare judgment outcomes over time.

**Downsides:** The abstraction can become too generic if it tries to model every evaluator up front. V1 should start with a small result shape and a few judgment kinds.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 6. Judge Registry With Multiple Judge Types

**Description:** Add a typed judge registry rather than making every loop use an unconstrained LLM judge. Initial judge types should be implementations of the shared judgment abstraction: explicit `goal_complete`, reviewer profile verdict, eval score threshold, data predicate, human approval, external callback, no-change/staleness detector, and composite AND/OR gates.

**Warrant:** `direct:` Pi goal mode exposes `goal_complete`; agent profiles have reviewer policy and loop verdicts; workflow run events/evidence can store judge decisions. `external:` LangChain's primer calls out verification loops around agent output before broader ambient/learning loops.

**Rationale:** The judge is where loop safety lives. A registry makes judge behavior visible, testable, and configurable instead of hiding completion in prompt text.

**Downsides:** Composite judges can get complicated. V1 should start with a small set and avoid building a full rules engine.

**Confidence:** 84%

**Complexity:** Medium

**Status:** Unexplored

### 7. LoopRun Evidence And Iteration Ledger

**Description:** Each loop wake creates or updates a `WorkflowRun`/event sequence with iteration number, trigger evidence, action summary, judge verdict, budget usage, next wake decision, and escalation/completion state. Agent run evidence and n8n/Step Functions execution IDs attach as evidence rather than replacing the ledger.

**Warrant:** `direct:` the workflow run ledger already stores trigger family/source, actor, idempotency key, correlation id, backend execution refs, event provenance, evidence refs, cost, and output summary.

**Rationale:** Loops only become trustworthy when users can inspect why they kept going or stopped. This also unlocks evaluation, replay, support, and cost attribution.

**Downsides:** More event ingestion and payload-redaction discipline. Need retention and summarization rules from the start.

**Confidence:** 88%

**Complexity:** Medium-High

**Status:** Unexplored

### 8. Loop Promotion Ladder

**Description:** Let users and agents promote behavior through stages: scheduled prompt -> goal-mode run -> reusable AgentLoop -> workflow recipe -> optional n8n/Step Functions/native artifact. The loop designer can start simple and become more formal only when a pattern proves useful.

**Warrant:** `reasoned:` ThinkWork already has scheduled jobs, goal mode, workflow recipes/control-plane, and n8n/Step Functions bindings. Promotion converts observed useful behavior into durable contracts without requiring a full visual designer before the team knows which loops matter.

**Rationale:** This is the most pragmatic adoption path. It lets THNK-46 improve Automations immediately while preserving the path to richer loop design.

**Downsides:** Promotion UX must be deliberate; otherwise users may not understand when they are editing a prompt, a loop, or a workflow recipe.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 9. Loop Template Contract Library

**Description:** Add a loop-template layer for reusable loop shapes such as maintainer sweep, verification harness, completion contract, champion/challenger improvement, promise-to-proof, clean-room recovery, and customer follow-up. Templates should not be raw prompts only; each should compile into the shared AgentLoop contract with structured trigger, goal, judgment, budget, approval, state, and evidence fields.

**Warrant:** `external:` Forward Future's Loop Library shows that practical loops are already being shared as copyable prompts with clear checks and stopping conditions. `direct:` ThinkWork already has workflow recipes/templates, skill catalogs, and workflow versions where reusable contracts can live.

**Rationale:** Prompt libraries are a market signal, but ThinkWork can make them safer and more operable by turning the recurring shape into typed templates. This gives users a fast start while preserving audit, budgets, approval gates, and versioned judgment specs.

**Downsides:** Template import must avoid becoming an unreviewed prompt marketplace. V1 should curate a small first-party library rather than accept arbitrary external loops as executable automation.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

## Rejection Summary

| #   | Idea                                            | Reason Rejected                                                                                                                                                           |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All loops are n8n workflows                     | Too much product truth moves into n8n; conflicts with ThinkWork's workflow/run ledger and AWS-native identity.                                                            |
| 2   | All loops are EventBridge scheduled jobs        | EventBridge solves wake timing, not goals, judges, iteration state, visual composition, or evidence.                                                                      |
| 3   | Separate `agent_loops` top-level product island | Duplicates the new workflow control plane and risks another workflow-like noun.                                                                                           |
| 4   | Free-form LLM judge only                        | Too unsafe and hard to inspect; useful as one judgment kind, not the whole contract.                                                                                      |
| 5   | Full visual loop builder first                  | Too expensive before the loop contract is stable; n8n and simple native forms can carry v1.                                                                               |
| 6   | Tiny scheduled-job `judge` JSON only            | Fast but too small; likely creates hidden semantics in `scheduled_jobs.config` that later need migration.                                                                 |
| 7   | Agent-authored executable loop specs by default | Strong future direction, but should go through typed recipes/validation rather than raw executable definitions.                                                           |
| 8   | Separate loop judge and eval evaluator models   | Duplicates verdict/score/evidence semantics and makes hill-climbing harder because runtime loop outcomes and eval outcomes would need translation.                        |
| 9   | Copyable prompt library as the product          | Useful for inspiration, but too weak for enterprise activation because prompts alone do not provide durable state, permissions, budgets, evidence, or versioned judgment. |

## Recommended Next Handoff

Brainstorm the first survivor: **Workflow-Backed AgentLoop Definition**.

Concrete question:

> What is the smallest AgentLoop contract that can upgrade current Automations by combining an existing workflow trigger, Pi goal-mode objective, typed judge, budget, and workflow run ledger without making n8n or EventBridge the sole loop engine?

That brainstorm should decide:

- whether `loop` lives inside `WorkflowVersion.definitionSnapshot`, `workflowEngineBindings.capabilityFlags`, a new `workflow_loop_definitions` table, or a combination;
- the minimal loop fields for trigger, goal, judgment, budget, continuation, escalation, and completion evidence;
- whether `JudgmentSpec` / `JudgmentResult` should be the shared primitive for loop judges, evals, reviewer verdicts, and human approvals;
- how existing `scheduled_jobs` rows migrate or bridge into `WorkflowTrigger` records;
- which judgment kinds ship first;
- how n8n participates in v1: stock-node bridge, native MCP workflow drafting, visual composer, or all three behind staged labels;
- what the Automations UI becomes: loop list, workflow trigger list, or alias over Workflows filtered to active scheduled/ambient work.

## Things To Review Before Brainstorming

1. **Judgment boundary:** Decide what belongs in shared `JudgmentSpec` versus loop-only `LoopJudgeSpec` versus eval-only configuration. The center should probably be input contract, criteria, evidence policy, pass condition, budget policy, and result shape; runtime actions such as retry/pause/complete belong to loop wrappers.
2. **Result shape:** Review whether a common `JudgmentResult` should always include `verdict`, optional `score`, optional `confidence`, summary, rationale, evidence refs, evaluator version, and redaction policy.
3. **First judgment kinds:** Pick the smallest useful set. Recommended v1 candidates: `reviewer_profile`, `llm_rubric`, `data_predicate`, `human_approval`, and `composite`. `eval_evaluator` may be a bridge kind once the eval storage/API shape is inspected.
4. **Eval reuse:** Inspect current evaluation schema/resolvers before committing to a shared abstraction. The goal is reuse, not forcing Bedrock AgentCore Evaluations into an awkward internal shape.
5. **Loop run storage:** Decide whether judgment results live directly in `workflow_run_events.payload_summary`, a new evidence type, a dedicated judgment table, or some combination.
6. **Versioning:** Decide how judgment specs are versioned with loop definitions and eval definitions. Changing a judge changes the meaning of pass/fail, so runs must preserve the exact spec/version used.
7. **Human approval semantics:** Review whether human approval is a judgment kind, a workflow event, or both. It probably produces a `JudgmentResult` while also writing an operator decision event.
8. **n8n participation:** Review whether n8n can author or invoke a judgment, or whether n8n only triggers a ThinkWork loop and receives the result. Default should keep judgment execution in ThinkWork.
9. **UI language:** Decide whether users see "Judge," "Check," "Quality gate," "Completion criteria," or "Review." The internal abstraction can be `JudgmentSpec` even if the product word is friendlier.
10. **Loop 4 path:** Review how judgment results feed hill-climbing: failed judgments should become improvement signals for prompts, skills, profiles, loop specs, and eval datasets, but production loop mutation should be human-gated in v1.
11. **Template shape:** Review the Loop Library examples as archetypes and extract common fields into typed templates: trigger, subject/scope, done criteria, judge/check, budget, protected actions, state file/ledger, evidence output, and stop reason.
12. **Curation boundary:** Decide whether ThinkWork ships a curated first-party loop template library, imports external prompt loops into drafts, or simply uses external libraries as design inspiration. Default recommendation: curated first-party templates first.
