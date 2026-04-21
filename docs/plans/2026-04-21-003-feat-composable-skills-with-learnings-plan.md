---
title: "feat: Composable skills + compound learnings — structured business workflows as skill-framework evolution"
type: feat
status: active
date: 2026-04-21
origin: docs/brainstorms/2026-04-21-structured-playbooks-for-business-problem-solving-requirements.md
supersedes: docs/plans/2026-04-21-002-feat-playbooks-primitive-v1-plan.md
---

# feat: Composable skills + compound learnings

## Overview

Bring compound-engineering-style structured work into ThinkWork **by growing the skill framework**, not by introducing a peer "playbook" primitive. Four additions to what skills can do:

1. **Composition** — a skill whose execution is a declarative sequence/parallel DAG of other skill invocations, with typed inputs and named intermediate outputs. Runs inside a single AgentCore Runtime session (no async worker, no SQS, no cross-invocation state machine).
2. **Programmatic invocation** — skills (and compositions) can be invoked by id with typed inputs from GraphQL, scheduled jobs, the admin catalog, **or an external webhook**, bypassing the LLM routing layer. The same skill can still be invoked by chat intent via an existing agent turn.
3. **Compound (learnings)** — a first-class post-run primitive that extracts surprising/non-obvious observations from a completed run and stores them scoped to (tenant, user, skill, optionally subject entity like a customer). At the start of each subsequent run, the engine retrieves relevant prior learnings and injects them as context. This is the feature that makes the system **get better with use** — it's the whole point of mirroring compound-engineering's structure.
4. **Reconciler contract** — compositions are safely re-invokable with the same inputs at any time. Every mutating action checks current state (via `gather`) before acting; output idempotency lives in the downstream systems (task system, CRM, ERP), not in a composition-level state machine. Human-in-the-loop gates are modeled as "post question/task, end composition, re-invoke on response" — compositions never hold a session open waiting for a human.

The end-user capabilities match the brainstorm (sales-meeting prep, account-health review, renewal prep, plus reconciler-shaped workflows like customer-onboarding; invoked via chat, schedule, catalog, or webhook; delivered to chat + email + agent owner; hardened security). The substrate is simpler than the superseded plan (no SQS, no worker Lambda, no phase-artifact table, no cross-invocation state machine) because the AgentCore runtime supports long sessions natively — but feature breadth is comparable. This plan's positioning claim is not "dramatically simpler"; it's something stronger.

**Positioning bet.** **One skill framework handles both deliverable-shaped and reconciler-shaped business workflows in one coherent DSL, without a separate execution engine for either.** A framework that can't handle reconciler-shaped workflows (external trigger, multi-tick, human-in-the-loop) isn't a business-workflow platform — it's a fancy chat-response formatter. The reusable primitives (frame/gather/synthesize/package) compose into either shape; the compound primitive makes both shapes get better with use. If we're wrong about reconciler-only being sufficient for workflow-shaped work, the escape hatch is not Step Functions later — it's introducing a peer primitive for explicit wait-state workflows (which is what 002 tried to do prematurely).

## Problem Frame

(See origin document for the full frame.) End users need to invoke repeatable, multi-step business workflows — sales meeting prep, account health review, renewal prep — from chat, schedule, or an admin catalog, and get a packaged deliverable. Today ThinkWork has skills (single-turn tool calls) and scheduled jobs (fire an agent wakeup), but no primitive that composes skills into a durable, observable unit with typed inputs and that accumulates learnings.

### Why skill evolution, not a peer primitive

The superseded plan's central mistake was designing around a Lambda-bound runtime that doesn't exist on this codebase. ThinkWork runs the Strands agent on AWS **Bedrock AgentCore Runtime**, which supports long-running managed sessions — verified at `packages/agentcore/tenant-router/tenant_router.py:293` (`invoke_agent_runtime(...)`) and `packages/agentcore/scripts/create-runtime.sh` (`bedrock-agentcore-control create-agent-runtime`). The only 15-minute cap in the invocation chain is the Lambda at `packages/api/agentcore-invoke.ts`, which is just a dispatcher.

Given that constraint falls away, the case for a separate "playbook" primitive also falls away. What skills actually need is:

- Parallel tool-call support within a single skill execution (`asyncio.gather`)
- Typed inputs with a schema + resolvers (not freeform config JSONB)
- A composition execution mode that orchestrates sub-skill invocations declaratively
- Programmatic invocation (not just agent-prompt-driven)
- A tenant-overridable allowlist
- A durable run record for observability — not for execution state
- A compound/learnings loop that closes the feedback cycle

These are all **skill framework evolution** — growing what `skill.yaml` can describe and what `skill_runner.py` can run. No new peer primitive.

### Why compound (learnings) earns its own unit

The product value of compound-engineering is not "you can run multi-phase work" — you can already do that with agent-mode skills. The value is that `ce:compound` captures a learning from every solved problem, and future runs surface those learnings. Without this loop, "run a skill" is just "run a skill." With it, sales-prep on week 12 is meaningfully better than week 1 because 11 weeks of customer-specific, rep-specific, and tenant-wide learnings have accumulated.

This is the piece that justifies the work beyond "we could have done this with the status quo." It's also the piece that maps cleanly to the per-user memory scope refactor already planned (auto-memory: `project_memory_scope_refactor`).

## Requirements Trace

Carried from origin; renumbered and regrouped for this plan's shape.

### Execution & composition
- **R1.** A composition skill executes a declarative sequence of sub-skill invocations (sequential + one level of parallel fan-out with per-branch `critical` flag) within a single AgentCore Runtime session.
- **R2.** Skill YAML supports typed inputs with resolvers, an `on_missing_input` policy, and a `tenant_overridable:` allowlist. Composition YAML adds steps, parallel groups, and named intermediate outputs.
- **R3.** Four invocation paths converge on one `startSkillRun(skillId, inputs)` mutation: chat intent (via a dispatcher skill), scheduled (via a new `job-trigger` branch), admin catalog, and **external webhook** (via a generic webhook-handler pattern). *(Origin Goal 1, Success 3; extended by reconciler pressure test.)*
- **R3a.** **Reconciler contract:** every composition must be safe to re-invoke with the same inputs at any time. Composition authors use `gather` to check current state before mutating, and output idempotency is enforced in downstream systems (by querying "does task X already exist?" before creating it). Composition sub-skills never block waiting for external events or human responses; HITL gates are modeled as "post task/question, end composition, re-invoke on reply event."

### Learnings (compound)
- **R4.** Every composition run ends with a `compound` step that extracts learnings and persists them scoped to `(tenant_id, user_id, skill_id, subject_entity_id?)`. Scope is user-scoped by default with tenant-wide fallback retrieval.
- **R5.** Every composition run begins with a `recall` step that retrieves relevant prior learnings and injects them as context for the subsequent steps.

### Observability & delivery
- **R6.** A durable `skill_runs` table captures `{run_id, skill_id, invoker, tenant, inputs (jsonb), status, started_at, finished_at, delivered_artifact_ref}` for audit and run-history UX. It is **not** an execution substrate; runs complete in-process within AgentCore.
- **R7.** Output delivery to `chat` and `email` in v1 (wiki deferred — no write path exists; see origin non-goals).

### Admin surface
- **R8.** Admin enables skills + compositions via the existing agent-skills page. Compositions render with extra affordances (tenant-overridable form, schedule builder, "Run now" button) alongside primitive skills. No new top-level admin concept.
- **R8a.** Every agent has an `owner_user_id` (verify present or add minimally). Compositions declare `delivery: agent_owner` to route asynchronous, thread-less notifications (e.g., webhook-triggered composition questions) to the owner's preferred channel. This is the fourth delivery destination alongside `chat`, `email`, and the phase-2 `wiki`.
- **R9.** A `skill-runs/` observability page renders run history + drill-in to an individual run's timeline, delivered artifact, and captured learnings.

### Security & compliance
- **R10.** `actor` server-resolved from Cognito (never caller-supplied); tenant-scoped session-gated URLs; input sanitization through schema-validating resolvers; email recipient domain allowlist.
- **R11.** Hard retention ceiling of 180 days on `skill_runs` and stored learnings; tenant-facing `deleteRun(runId)` for data-subject deletion.

### Performance & adoption
- **R12.** Anchor composition (`sales-prep`) completes end-to-end in under 5 minutes median, p95 under 8 minutes.
- **R13.** Adoption outcome — measured per shape because v1 ships both:
  - **Deliverable shape (sales-prep anchor):** ≥3 distinct users invoke `sales-prep` within 2 weeks of design-partner launch; ≥60% positive feedback signals. `account-health-review` and `renewal-prep` each hit ≥1 distinct user within 4 weeks.
  - **Reconciler shape (customer-onboarding anchor):** ≥1 complete reconciler loop runs end-to-end against a real CRM opportunity-won event within 4 weeks (webhook received → tasks created + clarification task posted → at least one clarification task completed by the agent owner → re-tick observed in run history → no duplicate tasks created). This is the concrete falsification test for the reconciler contract (D7a) and the webhook ingress pattern (D7b).
  - Both verifiable via a `compositionFeedbackSummary` query plus a reconciler-loop query in the admin UI. Either anchor failing its criterion is a launch-blocker for that shape, not the whole framework — deliverable-shape value is independent of reconciler-shape proof, and vice versa.

### Seed library
- **R14.** Four compositions ship in v1: three deliverable-shaped (`sales-prep` as the chat/schedule/catalog anchor, `account-health-review`, `renewal-prep`) and one reconciler-shaped (`customer-onboarding` as the webhook anchor validating the reconciler contract). The fourth is an explicit DSL-validation commitment — having a reconciler-shaped composition in v1 proves the DSL and contract are not special-cased for deliverable shape.

## Scope Boundaries

**Non-goals (v1):**

- No new top-level "playbook" concept in admin or data model. Everything is a skill with a different execution mode.
- No async execution substrate (no SQS, no playbook-worker Lambda, no phase-transition idempotency machine). Runs execute synchronously inside one AgentCore session.
- No visual composition editor or hosted authoring UI. Authoring is YAML via monorepo PR (OSS path) or a premium editor deferred to phase-2.
- No loops, conditionals, nested fan-out, or composition-calling-composition. A composition may call an agent-mode skill whose own prompt can do freeform orchestration, but the declarative DSL is flat.
- No wiki output destination (no page-write path exists; see origin).
- No calendar-event triggers (no calendar integration exists; v1 uses `cron`/`rate`).

### Deferred to Separate Tasks

- **Connector skills** (`crm_account_summary`, `ar_summary`, `support_incidents_summary`) — separate PRDs; this plan assumes they exist by launch and falls back to mocked connectors in integration tests if not.
- **Composition editor UI** — phase-2 premium.
- **Wiki/Slack/PDF output destinations** — phase-2, add the pluggability abstraction only when a second non-chat-non-email destination actually lands.
- **Per-user skill variants** (user's own customized `sales-prep`) — the learnings system handles personalization in v1; explicit per-user variants are phase-2.
- **Routines consolidation** — phase-2 PRD folds routines into skills once this evolution is proven.

## Context & Research

### Runtime: AgentCore Runtime, not Lambda

Verified by inspection:

- `packages/agentcore/tenant-router/tenant_router.py:128–293` — defines `invoke_agent_runtime(...)` using `boto3.client("bedrock-agentcore")` and calls `client.invoke_agent_runtime(...)`. This is the AWS Bedrock AgentCore service, which supports managed long-running sessions.
- `packages/agentcore/scripts/create-runtime.sh:65` — `aws bedrock-agentcore-control create-agent-runtime`.
- `packages/api/agentcore-invoke.ts:1–9` — the caller Lambda; the 15-min timeout is on this Lambda (streaming dispatcher), not on the runtime. A 5-min composition fits comfortably inside the Lambda's wait window and entirely inside the runtime's session envelope.

Implication: the async worker substrate from the superseded plan is unneeded.

### Existing skill framework (what we extend)

- `packages/agentcore-strands/agent-container/skill_runner.py` — skill registration, tool wrapping. The real skill YAML axes are `execution: script | context | mcp` (what the skill *is*) × `mode: tool | agent` (how the parent agent sees it, per PRD-38). We add `execution: composition` as a third value on the execution axis. `mode: tool` stays the default for compositions because they don't spawn sub-agents — they orchestrate sub-skill invocations via the new composition_runner.
- `packages/skill-catalog/<slug>/skill.yaml + SKILL.md + scripts/` — canonical skill directory layout.
- `packages/database-pg/src/schema/` — Drizzle ORM over Aurora Postgres. `agent_skills` table already holds per-agent enablement + `config` JSONB; we validate config against `tenant_overridable`.
- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts` — existing per-agent enablement path; reused.

### Memory / learnings substrate (for compound)

Two candidates:

- **AgentCore Memory** (`packages/agentcore/agent-container/memory.py:53`, auto-memory `project_evals_scoring_stack` + memory-engine-selection). Tenant-aware, already wired into the container.
- **Hindsight** (auto-memory `feedback_hindsight_async_tools`, `feedback_hindsight_recall_reflect_pair`). Recall/reflect tool pair exists; tenant scoping is in flight.

Decision (D4 below): ride on AgentCore Memory for v1 to stay AWS-native (matches `feedback_aws_native_preference`) and to align with the existing memory-engine selection. Keep Hindsight as a fallback / secondary backend via the existing engine-selection switch.

### Institutional learnings

- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` — less directly relevant now since we removed the async enqueue chain, but the core idea ("a success status on step N is not evidence step N+1 was initiated") still applies to the compound step at end of run.

### V1 scope — two workflow shapes, not one

V1 explicitly covers both workflow shapes that real business use exhibits:

- **Deliverable-shaped** — one invocation → gather data → produce a packaged artifact (brief, email, report) → done. Examples: sales-meeting prep, account-health review, renewal prep. Triggered by chat intent, schedule, or admin catalog. Delivered to chat + email.
- **Reconciler-shaped** — external trigger → check current state → create tasks + ask clarifying questions → re-invoke on downstream events → converge the real world toward a goal state. Examples: customer onboarding, compliance workflow, contract-renewal orchestration. Triggered by webhook (usually external system event). Delivered to agent_owner + task system.

Both shapes share the same DSL, execution engine, audit table, learnings substrate, and admin surface. Neither is phase-2. A framework that only handles deliverable-shaped work cannot credibly be called a business-workflow platform — the moment the first tenant asks for "kick off onboarding when a deal closes" or "re-check compliance when a form is signed," deliverable-only is a dead end.

This is the scope decision that justifies the webhook ingress pattern (Unit 8), the reconciler contract (D7a), the agent_owner delivery destination (R8a), and the tenant system-user actor — each of these is framework-level scope, not a customer-onboarding-specific add. Dropping customer-onboarding from v1 would logically imply dropping all of the above, which would ship a framework that can't handle the second real use case anyone asks for.

### HITL pattern (human-in-the-loop via reconciliation)

Real workflows — customer onboarding, compliance reviews, approvals — have steps that wait on a human. The composition framework handles these without introducing a "workflow waiting" primitive, by modeling the composition as a reconciler:

1. **Initial invocation** (e.g., from a webhook): composition runs, gathers current state, decides `ready_to_create` vs `needs_clarification`.
2. **Ready items** → composition creates tasks via external task MCP, posts summary to the agent owner's channel, marks `skill_runs.status = complete`.
3. **Clarification items** → composition creates a "pending clarification" task containing the questions, posts it to the agent owner, marks `skill_runs.status = complete`. No session-wide wait; the composition ends.
4. **Re-invocation on response** — when the clarification task is completed in the task system, the task system fires a webhook → ThinkWork webhook handler calls `startSkillRun` for the same composition with the same subject-entity inputs. The composition runs again, `gather` sees the newly-answered state, and the sub-skill takes the next action (create the next batch of tasks, or ask follow-up questions, or terminate cleanly if nothing remains).

Output idempotency lives in the downstream system: `gather` queries "what tasks already exist for this customer?" and the `act` sub-skill creates only the missing ones. The composition can fire 1 or 100 times with the same customer inputs and the downstream state converges correctly.

This is a Kubernetes-style reconciliation model, not a BPMN-style workflow. It trades "I can see the full process in one diagram" for "any failure mode is a re-run away from recovery, and there's no long-running state to corrupt."

Three acceptable trigger shapes for re-invocation:
- **Task-completion webhook** (preferred) — task system fires on completion; webhook handler re-invokes `startSkillRun`.
- **Chat thread answer** — human replies in the thread where the questions were posted; the agent's ReAct loop matches the answer to a pending composition run and re-invokes. Lower-ceremony, less reliable — use when questions are conversational rather than structured.
- **Periodic re-check** — a scheduled job fires every N hours for entities in "in progress" state. Use as a safety net; not the primary trigger.

Sub-skills that are part of a composition MUST NOT `asyncio.sleep` or otherwise block waiting for an external response — that holds open the AgentCore session and defeats the reconciler model. This is a contributor-facing rule that the CI validator enforces with a lint pattern.

### Auto-memory that shapes this plan

- `project_memory_scope_refactor` — per-user memory/wiki refactor in flight; compound learnings ride on this when it lands. Before it lands, scope defaults to `(tenant, user)` stored inline.
- `feedback_hindsight_recall_reflect_pair` — the docstring-paired recall/reflect contract; the compound primitive will mirror this (recall at start, reflect at end).
- `feedback_avoid_fire_and_forget_lambda_invokes` — `startSkillRun` invokes AgentCore as RequestResponse.
- `feedback_pnpm_in_workspace`, `feedback_pr_target_main`, `feedback_graphql_deploy_via_pr` — standard workspace hygiene.
- `feedback_oauth_tenant_resolver` — `resolveCallerTenantId(ctx)` for Google-federated users.

## Key Technical Decisions

### D1. No async execution substrate

Compositions run synchronously inside a single AgentCore Runtime invocation. No SQS, no worker Lambda, no phase-transition idempotency, no reaper. The agentcore-invoke Lambda (15-min function URL) is enough for the 5-min median target with margin.

**Rationale.** The runtime supports it natively. Every avoided primitive (queue, DLQ, fan-in counter, heartbeat, retry-in-DB) is a primitive we don't have to maintain. The one thing we lose — durable recovery from a runtime crash mid-run — is a GA-hardening concern addressable later (just re-run), not a v1 requirement.

### D2. Composition as a skill execution mode

`skill.yaml` grows `execution: composition` alongside the existing `execution: script | context | mcp`. A composition skill's YAML declares `inputs`, `tenant_overridable`, `delivery`, `triggers`, and `steps` (with sequential + parallel shapes). The skill directory layout is unchanged: `packages/skill-catalog/<id>/skill.yaml` + `phases/*.md` prompts + optional `scripts/`.

**Rationale.** One directory convention. One admin page. One GraphQL enablement path (`setAgentSkills`). Admins see "a skill" — its execution mode is an implementation detail.

### D3. Programmatic invocation via a new `startSkillRun` mutation

A new GraphQL mutation `startSkillRun(skillId, inputs)` resolves `actor` server-side from Cognito, validates inputs against the skill's schema + `tenant_overridable` allowlist, inserts a `skill_runs` row, and invokes the AgentCore runtime with a synthetic "run skill X with inputs Y" envelope. AgentCore's container detects the synthetic envelope and dispatches directly to the composition runner (bypassing LLM routing).

**Rationale.** Scheduled jobs and admin catalog both need typed-input invocation without going through a user chat turn. One shared mutation keeps the three invocation paths unified.

### D4. Compound learnings on AgentCore Memory

The `compound` primitive stores learnings as AgentCore Memory records with scope tags `(tenant_id, user_id, skill_id, subject_entity_id?)`. `recall` at run-start retrieves top-K relevant learnings by semantic similarity of inputs; `reflect` at run-end generates and stores new ones. Per-user scope is default; tenant-wide learnings are searched as a fallback with lower priority.

**Rationale.** AWS-native preference; already integrated; aligns with the in-flight memory scope refactor. Hindsight remains available via the existing memory-engine switch. When the user-scope refactor lands, compound rides it without code changes.

### D5. `skill_runs` as audit log, not execution state

One new table, `skill_runs`, captures: `id, tenant_id, invoker_user_id, skill_id, skill_version, invocation_source (chat|scheduled|catalog|programmatic), inputs (jsonb), resolved_inputs (jsonb), status (enum), started_at, finished_at, delivered_artifact_ref, delete_at (retention), feedback_signal, feedback_note`. No `phase_artifacts` table — phase intermediates live in the composition runner's process memory for the session's duration; only the final delivered artifact is referenced from a run row.

**Rationale.** The superseded plan's per-phase artifact table was required only for cross-invocation state. Without async execution, we don't need it. Phase-level observability comes from structured log lines + the delivered artifact, not a separate DB table.

### D6. Typed inputs + `tenant_overridable` on the skill, not on the composition

Typed inputs (with `resolver`, `on_missing_input`) and `tenant_overridable` allowlists are shared primitives that apply to any skill, not just compositions. Every skill kind benefits. This also means `setAgentSkillConfig` becomes the single surface for tenant overrides across all skill kinds, with server-side allowlist enforcement.

**Rationale.** Keeps the DSL evolution coherent. Primitive skills (like `frame` or `gather`) may not need inputs/overrides, but the framework supports them uniformly.

### D7. Keep core reusable primitives — `frame`, `gather`, `synthesize`, `package`

Ship four reusable skills that compositions invoke. `frame` takes a problem statement and produces a structured restatement. `gather` takes a list of sub-skill invocations and fans out in parallel. `synthesize` reads named prior outputs and produces structured analysis. `package` renders a final deliverable in a named format (`sales_brief`, `health_report`, `renewal_risk_brief`). Every composition in v1 uses this shape.

**Rationale.** This is the compound-engineering pattern ported. Reusability across compositions is what surfaces DSL gaps and drives the primitive's quality. A bespoke `sales-prep` skill per composition misses this entirely.

### D7a. Reconciler contract over workflow semantics

Compositions are modeled as reconcilers: re-entrant, stateless between invocations, safe under duplicate fires. The alternative — stateful long-running workflows with explicit wait states — was considered and rejected. Waiting would force a new execution substrate (either a queue with dehydrate/rehydrate semantics, or a workflow engine like Step Functions), regressing on the whole "no async substrate" decision (D1).

**Rationale.** The reconciler shape trades a visible single-diagram workflow for resilience: any failure is recoverable by re-run, and there's no long-running state that can corrupt. It matches how CRM webhooks, task-completion events, and cron triggers naturally behave — each is an event that re-triggers evaluation. The customer-onboarding pressure test confirmed the model works for multi-step HITL processes without any new primitive.

**Constraint.** Sub-skills inside a composition may not block on external events or human responses. The composition ends when the current reconciliation tick completes its mutations; the next event restarts the tick. Violation is a lint-caught error in the CI validator.

### D7b. Webhook as a first-class invocation path

External webhooks (CRM, ERP, task system, email inbound) are a fourth invocation path. Concretely: a new `packages/api/src/handlers/webhooks/` directory holds one Lambda per external integration. Each Lambda validates the tenant's signing secret, parses the event payload, resolves entity IDs (e.g., `opportunity_id → customer_id`) via named resolver tools, and calls `startSkillRun(skillId, inputs)` with `actor = tenant system user` (a bootstrap identity scoped to webhook-triggered invocations only).

**Rationale.** Webhook ingress is a legitimate repeatable pattern, not a one-off Lambda per use case. Building it as a pattern with a shared validation/resolution/dispatch helper means new integrations (Slack event, GitHub webhook, inbound email) land as small additions, not new architectures. The customer-onboarding scenario is the forcing function; the pattern becomes reusable.

**Security.** The webhook actor identity (`tenant system user`) has no chat-facing permissions — it can invoke compositions and nothing else. Compositions invoked via webhook route notifications to the agent owner, not to an invoker thread.

### D8. Routines coexist in v1; dated deprecation scoped to phase-2

`routines` remain untouched. Once composable skills prove stable, a phase-2 PRD folds routines into this framework (a routine becomes a composition skill with a scheduled trigger). Target deprecation date decided in that PRD, not this one — but commitment: before GA of a second design partner using routines, we land the consolidation.

**Rationale.** Routines is production; migrating it inside this plan is blast-radius expansion with zero v1 benefit. A dated commitment is tracked elsewhere so this plan stays focused.

### D9. One entry point serves all four invocation paths

The `startSkillRun` mutation (D3) is the single entry point for all four paths. Specifically:

- **Chat intent** — one per-agent dispatcher skill (`skill-dispatcher`) loads a manifest of enabled compositions, matches user messages, and calls `startSkillRun` with extracted inputs.
- **Scheduled** — `job-trigger`'s new branch resolves input bindings and calls `startSkillRun` directly.
- **Admin catalog** — admin UI calls `startSkillRun` from the user-initiated "Run now" button.
- **Webhook** — `_shared.ts` helper validates signing secret, resolves entity IDs, calls `startSkillRun` with the tenant system-user actor.

**Rationale.** One entry point for execution keeps authz, dedup, input validation, and audit row creation centralized. Each path is a thin adapter that resolves an actor and a set of inputs, then hands off.

### D10. Parallel fan-out via `asyncio.gather` inside the container

`gather` skill uses `asyncio.gather(*sub_skill_invocations)` to execute parallel branches concurrently inside the AgentCore process. Per-branch `critical: true` triggers run-abort on failure; non-critical failures produce a footer note in the final package. A per-branch `timeout_seconds` (default 120s) caps individual branches.

**Rationale.** No new infrastructure — pure Python async. Guaranteed parallelism semantics without depending on LLM prompt adherence.

## Open Questions

### Resolved During Planning

- **Execution substrate** → D1 (synchronous inside AgentCore; no async worker).
- **Composition as primitive** → D2 (skill mode, not peer concept).
- **Invocation path convergence** → D3 (`startSkillRun` mutation).
- **Learnings substrate** → D4 (AgentCore Memory with scope tags).
- **Audit vs execution state** → D5 (audit-only table).
- **Where typed inputs + allowlist live** → D6 (on the skill, uniformly).
- **Reconciler vs workflow semantics** → D7a (reconciler; re-invoke on events, never wait in-session).
- **Webhook as invocation path** → D7b (shared webhook-handler pattern under `packages/api/src/handlers/webhooks/`).
- **HITL model** → documented in Context & Research (reconciler + task-completion re-invoke).
- **Routines** → D8 (coexist, phase-2 consolidation).

### Deferred to Implementation

- Exact `top-K` for learnings recall and similarity threshold — tune against the first seed composition.
- Exact delivered-artifact schema (`delivered_artifact_ref` shape) — nail down during Unit 4 when we know the thread-message + email plumbing.
- Whether `startSkillRun` synthetic envelope uses an existing `invoke_agent_runtime` field or a new one — decided during Unit 4 against the live AgentCore API.

## Output Structure

Greenfield directories introduced by this plan:

```
packages/
├── skill-catalog/
│   ├── frame/                              # NEW reusable primitive
│   │   ├── skill.yaml
│   │   ├── SKILL.md
│   │   └── prompts/frame.md
│   ├── gather/                             # NEW reusable primitive (parallel fan-out)
│   │   ├── skill.yaml
│   │   └── SKILL.md
│   ├── synthesize/                         # NEW reusable primitive
│   │   ├── skill.yaml
│   │   ├── SKILL.md
│   │   └── prompts/synthesize.md
│   ├── package/                            # NEW reusable primitive (rendering)
│   │   ├── skill.yaml
│   │   ├── SKILL.md
│   │   └── templates/{sales_brief,health_report,renewal_risk}.md.tmpl
│   ├── compound/                           # NEW learnings primitive
│   │   ├── skill.yaml
│   │   ├── SKILL.md
│   │   └── scripts/{recall,reflect}.py
│   ├── skill-dispatcher/                   # NEW chat-intent dispatcher
│   │   ├── skill.yaml
│   │   ├── SKILL.md
│   │   └── scripts/dispatch.py
│   ├── sales-prep/                         # NEW composition (anchor)
│   │   ├── skill.yaml                      # execution: composition
│   │   └── prompts/*.md
│   ├── account-health-review/              # NEW composition
│   │   └── ...
│   ├── renewal-prep/                       # NEW composition
│   │   └── ...
│   └── customer-onboarding/                # NEW reconciler-shaped composition (pressure-test anchor)
│       ├── skill.yaml                      # execution: composition
│       ├── prompts/*.md
│       └── sub-skills/act/                 # mode: agent — HITL branching lives here
├── agentcore-strands/agent-container/
│   ├── composition_runner.py               # NEW
│   ├── skill_inputs.py                     # NEW — Pydantic schema for typed inputs + allowlist
│   └── skill_runner.py                     # MODIFIED — execution: composition dispatch + asyncio.gather
├── database-pg/
│   ├── src/schema/skill-runs.ts            # NEW
│   └── drizzle/0016_skill_runs.sql
├── api/src/graphql/resolvers/skill-runs/   # NEW
│   ├── startSkillRun.mutation.ts
│   ├── cancelSkillRun.mutation.ts
│   ├── deleteRun.mutation.ts
│   ├── submitRunFeedback.mutation.ts
│   ├── compositionFeedbackSummary.query.ts
│   ├── skillRun.query.ts
│   ├── skillRuns.query.ts
│   └── index.ts
└── api/src/handlers/webhooks/              # NEW — external-event ingress
    ├── _shared.ts                          # shared validation, resolution, dispatch helper
    ├── crm-opportunity.ts                  # CRM "opportunity won" → startSkillRun
    ├── task-event.ts                       # task-completion re-invoke path
    └── README.md                           # pattern doc for adding new integrations

apps/admin/src/routes/_authed/_tenant/
├── agents/$agentId_.skills.$skillId.tsx    # NEW — per-skill detail (config, schedule, runs)
└── skill-runs/                             # NEW — observability
    ├── index.tsx
    └── $runId.tsx

scripts/
└── validate-skill-catalog.sh               # NEW — CI check (schema, tenant-specific strings, no-blocking-sleep lint)
```

Note: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx` already exists and is extended, not replaced.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

### Invocation flow — Path A (chat intent)

```mermaid
sequenceDiagram
  actor Rep
  participant Chat as chat-agent-invoke Lambda
  participant AC as AgentCore Runtime (session)
  participant Disp as skill-dispatcher (in-session skill)
  participant API as GraphQL (startSkillRun)
  participant DB as Postgres
  participant Mem as AgentCore Memory
  participant Msg as Thread messages
  participant Eml as Email Lambda

  Rep->>Chat: "prep me for ABC Fuels Thursday"
  Chat->>AC: invoke_agent_runtime(session, msg)
  AC->>Disp: match intent + resolve inputs
  Disp->>API: startSkillRun(skillId="sales-prep", inputs)
  API->>API: resolveCaller(ctx); allowlist check; INSERT ON CONFLICT skill_runs
  API-->>Disp: {runId}
  Disp->>Msg: post ack ("Running sales-prep for ABC Fuels Inc…")
  Note over AC: composition_runner takes over inside the same session

  AC->>Mem: recall(scope=user,skill=sales-prep,subject=ABC Fuels)
  Mem-->>AC: relevant learnings
  AC->>AC: step: frame(problem, learnings)
  AC->>AC: step: gather(parallel: crm, ar, tickets, web, wiki)
  Note right of AC: asyncio.gather — real parallelism
  AC->>AC: step: synthesize(framed, gathered)
  AC->>AC: step: package(synthesis, format="sales_brief")
  AC->>Mem: reflect(learnings from this run)
  AC->>Msg: post deliverable summary + link
  AC->>Eml: send email (detached outbound)
  AC->>DB: UPDATE skill_runs status=complete, delivered_artifact_ref
  AC-->>Chat: response (within 15-min window)
```

### Composition DSL shape

```yaml
# packages/skill-catalog/sales-prep/skill.yaml
id: sales-prep
version: 1
execution: composition
name: "Prep for Meeting"
description: "Gather account context, financials, activity, and external signals for a sales meeting."

inputs:
  customer:     { type: string, required: true, resolver: resolve_customer, on_missing_input: ask }
  meeting_date: { type: date,   required: true, on_missing_input: ask }
  focus:        { type: enum, values: [financial, expansion, risks, general], default: general }

tenant_overridable:
  - delivery.email.recipient
  - inputs.focus.default
  - triggers.schedule.expression

triggers:
  chat_intent:
    examples: ["prep me for {customer} meeting", "brief me on {customer}"]
    disambiguation: ask
  schedule:
    type: cron
    expression: "0 14 ? * MON-FRI *"
    bindings: { customer: from_tenant_config, meeting_date: today_plus_1 }

delivery:
  - chat
  - email

steps:
  - skill: compound.recall
    inputs: { scope: user, skill: sales-prep, subject: "{customer}" }
    output: prior_learnings

  - skill: frame
    inputs:
      problem: "Prep for meeting with {customer} on {meeting_date}. Focus: {focus}."
      context: "{prior_learnings}"
    output: framed

  - skill: gather
    parallel:
      - { skill: crm_account_summary,       inputs: { customer }, critical: true }
      - { skill: ar_summary,                inputs: { customer } }
      - { skill: support_incidents_summary, inputs: { customer } }
      - { skill: web_research,              inputs: { customer, date: "{meeting_date}" } }
      - { skill: wiki_search,               inputs: { customer } }
    on_branch_failure: continue_with_footer
    output: gathered

  - skill: synthesize
    inputs: { framed: "{framed}", gathered: "{gathered}", focus: "{focus}", prior_learnings }
    output: synthesis

  - skill: package
    inputs: { synthesis: "{synthesis}", format: sales_brief }
    output: deliverable

  - skill: compound.reflect
    inputs:
      scope: user
      skill: sales-prep
      subject: "{customer}"
      run_inputs: "{inputs}"
      deliverable: "{deliverable}"
```

### Reconciler-shaped composition (customer-onboarding)

Same DSL, different delivery shape and explicit HITL pattern. This composition is expected to be invoked multiple times per customer — once on opportunity-won webhook, again on each task-completion event — and converges the downstream task system toward a completed onboarding.

```yaml
# packages/skill-catalog/customer-onboarding/skill.yaml
id: customer-onboarding
version: 1
execution: composition
name: "Customer Onboarding"
description: "Reconcile onboarding state for a customer: check completeness, ask for missing info, create tasks for open items."

inputs:
  customerId:    { type: string, required: true }
  opportunityId: { type: string, required: false }   # present on initial CRM webhook, absent on re-invokes

tenant_overridable:
  - delivery.agent_owner.channel
  - budget_cap.tokens

triggers:
  webhook:
    examples:
      - { source: crm, event: opportunity_won }
      - { source: task_system, event: task_completed, when: "task.topic == 'onboarding'" }

delivery:
  - agent_owner                              # thread-less notifications route to the owner's preferred channel

steps:
  - skill: compound.recall
    inputs: { scope: tenant, skill: customer-onboarding, subject: "{customerId}" }
    output: prior_learnings

  - skill: gather
    parallel:
      - { skill: crm_customer_snapshot,    inputs: { customerId }, critical: true }
      - { skill: p21_erp_lookup,           inputs: { customerId } }
      - { skill: tax_exempt_status_check,  inputs: { customerId } }
      - { skill: signed_forms_inventory,   inputs: { customerId } }
      - { skill: task_system_list_open,    inputs: { customerId, topic: onboarding } }
    on_branch_failure: continue_with_footer
    output: current_state

  - skill: synthesize
    inputs: { prior_learnings, current_state }
    output: gap_analysis                     # { ready_to_create: [...], needs_clarification: [...] }

  - skill: customer-onboarding/act           # mode: agent — decides what to mutate this tick
    inputs: { gap_analysis, customerId, owner: "{agent.owner_user_id}" }
    # sub-skill MUST NOT block waiting for human input; ends after posting questions/creating tasks
    output: action_summary

  - skill: compound.reflect
    inputs: { scope: tenant, skill: customer-onboarding, subject: "{customerId}", deliverable: action_summary }
```

Re-invocation sequence:

```mermaid
sequenceDiagram
  participant CRM
  participant Web as crm-opportunity Lambda
  participant API as GraphQL (startSkillRun)
  participant AC as AgentCore (session)
  participant Tasks as Task system (MCP)
  participant Owner
  participant TaskWh as task-event Lambda

  CRM->>Web: POST /webhooks/crm-opportunity {eventType: won, ...}
  Web->>Web: validate signing secret; resolve opportunity_id → customer_id
  Web->>API: startSkillRun("customer-onboarding", {customerId, opportunityId})
  API->>AC: invoke_agent_runtime(...)
  AC->>AC: recall → gather → synthesize (gap_analysis)
  AC->>Tasks: create tasks for ready_to_create items
  AC->>Tasks: create "Pending clarification" task with needs_clarification questions
  AC->>Owner: notify via delivery.agent_owner
  AC-->>API: skill_runs.status = complete
  Note over API: composition done — no waiting

  Owner->>Tasks: completes clarification task with answers
  Tasks->>TaskWh: POST /webhooks/task-event {taskId, completion, ...}
  TaskWh->>API: startSkillRun("customer-onboarding", {customerId}) [same inputs]
  Note over API: dedup hash matches prior run? No — prior run is complete, new reconciler tick
  API->>AC: invoke_agent_runtime(...)
  AC->>AC: recall → gather (now sees answered state) → synthesize → act
  AC->>Tasks: create next batch of tasks (tax exempt form, ERP entry, etc.)
  AC->>Owner: notify progress
  AC-->>API: skill_runs.status = complete
```

## Implementation Units

Nine units; still substantially smaller than the superseded plan. Units 1–7 ship the skill-framework evolution + observability; Unit 8 ships the webhook ingress pattern; Unit 9 ships seed content + integration tests.

- [ ] **Unit 1: Skill framework extensions — typed inputs, `tenant_overridable`, composition mode, parallel tool calls**

**Goal:** Extend `skill.yaml` and `skill_runner.py` with typed inputs (Pydantic validation), a `tenant_overridable` allowlist, a new `execution: composition`, and parallel tool-call support via `asyncio.gather`.

**Requirements:** R1, R2, R6, R10

**Dependencies:** None.

**Files:**
- Modify: `packages/agentcore-strands/agent-container/requirements.txt` (add `PyYAML`, `pydantic>=2`)
- Create: `packages/agentcore-strands/agent-container/skill_inputs.py` (Pydantic schemas for input typing + allowlist validation)
- Create: `packages/agentcore-strands/agent-container/composition_runner.py`
- Modify: `packages/agentcore-strands/agent-container/skill_runner.py` (add `load_composition_skills()` that picks `execution: composition` skills out of the invocation payload and validates via `skill_inputs.load_composition`; existing `register_skill_tools*` paths for `execution: script` untouched)
- Create: `scripts/validate-skill-catalog.sh` (CI: Pydantic validation of every skill.yaml, tenant-specific-string grep, no-blocking-sleep lint on agent-mode sub-skills to enforce the reconciler contract)
- Test: `packages/agentcore-strands/agent-container/tests/test_skill_inputs.py`
- Test: `packages/agentcore-strands/agent-container/tests/test_composition_runner.py`

**Approach:**
- `skill.yaml` accepts: `mode`, `inputs:`, `tenant_overridable:` (list of dotted paths), `delivery:`, `triggers:`, and `steps:` (composition only).
- Pydantic validates every playbook on load; violations surface as skill-load errors with file+field context.
- `composition_runner.run(skill_id, resolved_inputs, context) -> final_output`: walks `steps`, maintains a named-output dict, dispatches each step via `skill_runner`, handles parallel groups via `asyncio.gather`, applies `critical` + `on_branch_failure` semantics, returns the final `deliverable`.
- Parallel branch timeout: `asyncio.wait_for(branch_coroutine, timeout=step.timeout_seconds)` (default 120s).
- Path-component sanitizer helper exists but has no v1 caller (prepares for phase-2 wiki output). Unit-tested.

**Patterns to follow:**
- `packages/agentcore-strands/agent-container/skill_runner.py` existing `mode: script | context | agent` dispatch.
- `packages/agentcore-strands/agent-container/workflow_skill_context.py` for context-injection shape.

**Test scenarios:**
- Happy path: load + validate a composition skill; run a two-step sequential composition; named outputs flow.
- Happy path: parallel `gather` with three sub-skills → asyncio.gather completes all; returns named outputs.
- Edge case: critical branch fails → composition aborts; `on_branch_failure` ignored for critical.
- Edge case: non-critical branch fails with `continue_with_footer` → composition continues; footer recorded.
- Edge case: parallel branch exceeds `timeout_seconds` → branch marked `timed_out`, routes per `critical` rules.
- Edge case: `tenant_overridable` allowlist rejects a dotted-path override that resolves to a non-existent field at load time.
- Edge case: input value fails Pydantic validation → composition never starts; error propagated cleanly.
- Integration scenario: a composition invokes an agent-mode sub-skill → agent sub-agent runs, returns output.

**Verification:** `pnpm --filter agentcore-strands test` passes; `scripts/validate-skill-catalog.sh` exits 0 against the existing skill catalog; `uv run ruff check` clean.

---

- [ ] **Unit 2: Core reusable primitives — `frame`, `gather`, `synthesize`, `package`**

**Goal:** Ship the four skills that every v1 composition uses. Each is a standard skill; `gather` is the only one with special execution semantics (parallel fan-out, delegated to composition_runner via a `type: parallel` hint).

**Requirements:** R1, R7

**Dependencies:** Unit 1.

**Files:**
- Create: `packages/skill-catalog/frame/{skill.yaml, SKILL.md, prompts/frame.md}`
- Create: `packages/skill-catalog/gather/{skill.yaml, SKILL.md}` (uses `type: parallel` hint handled by composition_runner; no scripts; loader rejects standalone invocation with a clear error so admins cannot enable `gather` as a chat tool)
- Create: `packages/skill-catalog/synthesize/{skill.yaml, SKILL.md, prompts/synthesize.md}`
- Create: `packages/skill-catalog/package/{skill.yaml, SKILL.md, templates/sales_brief.md.tmpl, templates/health_report.md.tmpl, templates/renewal_risk.md.tmpl}`
- Modify: `packages/skill-catalog/agent-email-send/{skill.yaml, scripts/send.py}` — add `mode: outbound` variant that relaxes `requires_env` (drops `INBOUND_*` reply-token requirements) so scheduled/webhook-invoked compositions can email without an inbound reply context. Back-compat: `mode: reply` default is unchanged.
- Test: `packages/skill-catalog/<each>/tests/`
- Test: `packages/skill-catalog/agent-email-send/tests/test_send_outbound.py`

**Approach:**
- `frame`: `mode: context` (prompt-only). Takes `problem` + optional `context` (prior_learnings). Returns a structured restatement.
- `gather`: declarative — composition_runner looks at the composition's step of kind `gather` and runs its `parallel:` children via asyncio.gather. The `gather` skill itself is a stub that the runner short-circuits; it exists for admin-surface discoverability.
- `synthesize`: `mode: context`. Takes named inputs by reference (jinja-style `{framed}`, `{gathered}`) and produces a structured analysis (risks, opportunities, questions, talking points).
- `package`: `mode: script`. Takes `synthesis` + `format` (enum picks a template). Renders the template, attaches source citations, returns `deliverable` string. Deliverable rendering is a template-driven function, not an LLM call — cheaper, deterministic, reviewable.

**Patterns to follow:**
- Existing `packages/skill-catalog/` skill layout.

**Test scenarios:**
- Happy path for each skill against a fixture input.
- Edge case: `package` with an unknown `format` → validation error at input boundary.
- Edge case: `synthesize` with a missing named input → meaningful error message (not a template-render exception).
- Integration scenario: `frame → gather (stub) → synthesize → package` chain against fixture inputs produces a plausible sales-brief (snapshot test, not exact match).
- **Security scenario — tenant-scoped resolver contract:** every named resolver tool (e.g., `resolve_customer`) MUST accept a `tenantId` parameter and assert the resolved entity's `tenantId` matches. Test: a resolver invoked with tenant A for an entity owned by tenant B returns zero matches even when the entity exists. This test is load-bearing — violating it is the cleanest cross-tenant leakage vector in the plan.

**Verification:** Each skill passes its own tests; full chain integration in Unit 1's composition_runner test also exercises these.

---

- [ ] **Unit 3: Compound (learnings) primitive — `recall` + `reflect` on AgentCore Memory**

**Goal:** First-class learnings loop. Every composition run starts with `recall` and ends with `reflect`. Learnings scoped to `(tenant, user, skill, optional subject entity)`; retrieval is semantic similarity with per-user prioritization.

**Requirements:** R4, R5

**Dependencies:** Unit 1.

**Files:**
- Create: `packages/skill-catalog/compound/{skill.yaml, SKILL.md, scripts/recall.py, scripts/reflect.py}`
- Modify: `packages/agentcore-strands/agent-container/composition_runner.py` (auto-invoke `compound.recall` as first implicit step if not explicitly declared; auto-invoke `compound.reflect` as last implicit step)
- Modify: `packages/agentcore/agent-container/memory.py` (add scoped write helper `store_learning(scope, content)` and scoped read helper `recall_learnings(scope, query, top_k)` over existing AgentCore Memory client)
- Test: `packages/skill-catalog/compound/tests/test_recall.py`
- Test: `packages/skill-catalog/compound/tests/test_reflect.py`
- Test: `packages/agentcore/agent-container/tests/test_memory_scoping.py`

**Approach:**
- **Recall:** query AgentCore Memory with a scope filter `{tenant_id, user_id?, skill_id, subject_entity_id?}`. Rank: exact-user matches first, tenant-wide matches second, global skill learnings third. Top-K default 5.
- **Reflect:** after the composition's final step, invoke an LLM call with prompt: "Given the run's inputs, deliverable, and prior learnings in scope, identify up to 3 new observations worth remembering. Each observation: 1–2 sentences, concrete, non-obvious." Store each under the appropriate scope.
- **Docstring pair invariant** (per auto-memory `feedback_hindsight_recall_reflect_pair`): recall's docstring includes the chain instruction; reflect's docstring includes the write contract. Edit together.
- **Scope defaults** before user-memory-scope refactor lands: scope defaults to `(tenant_id, user_id)` stored inline in memory. After refactor: rides on the per-user memory substrate without code changes.

**Execution note:** Test-first. The recall/reflect contract is the most important invariant in this plan; write the tests before the implementation.

**Test scenarios:**
- Happy path: recall returns user-scoped learnings first, tenant-scoped second.
- Happy path: reflect writes three learnings with correct scope tags.
- Edge case: no prior learnings → recall returns empty; composition continues without context.
- Edge case: AgentCore Memory write fails → reflect logs + swallows (compositions should not fail because learnings couldn't be stored); structured metric emitted.
- Edge case: reflect LLM returns garbage (non-JSON, empty, too long) → validated + skipped.
- Integration scenario: two sequential runs of the same composition with the same inputs — second run's context includes learnings from the first.

**Verification:** `pnpm --filter agentcore-strands test`; manual end-to-end in dev — two sales-prep runs for the same customer; second brief reflects learnings captured in the first.

---

- [ ] **Unit 4: `startSkillRun` GraphQL mutation + siblings**

**Goal:** Programmatic invocation entry point shared by chat-intent, scheduled, and catalog paths. Server-resolved actor, tenant-authz, typed-input validation, idempotency via `INSERT ON CONFLICT`, AgentCore runtime kickoff.

**Requirements:** R3, R6, R10, R11, R13

**Dependencies:** Unit 1.

**Files:**
- Create: `packages/database-pg/src/schema/skill-runs.ts` (Drizzle schema)
- Create: `packages/database-pg/drizzle/0016_skill_runs.sql` (migration)
- Modify: `packages/database-pg/src/schema/index.ts` (barrel export)
- Create: `packages/api/src/graphql/resolvers/skill-runs/startSkillRun.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/skill-runs/cancelSkillRun.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/skill-runs/deleteRun.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/skill-runs/submitRunFeedback.mutation.ts`
- Create: `packages/api/src/graphql/resolvers/skill-runs/compositionFeedbackSummary.query.ts`
- Create: `packages/api/src/graphql/resolvers/skill-runs/skillRun.query.ts`
- Create: `packages/api/src/graphql/resolvers/skill-runs/skillRuns.query.ts`
- Create: `packages/api/src/graphql/resolvers/skill-runs/index.ts`
- Modify: `packages/api/src/graphql/resolvers/index.ts`
- Modify: `packages/database-pg/graphql/types/*.graphql` (add new types + queries + mutations; `terraform/schema.graphql` is auto-generated subscription-only — do not edit directly; regenerate via `pnpm schema:build`)
- Modify: `packages/api/src/graphql/utils.ts` (add `invokeComposition()` helper — calls `invoke_agent_runtime` with synthetic envelope via the existing `agentcore-invoke` Lambda)
- Test: `packages/api/src/__tests__/graphql/skill-runs/*.test.ts`

**Approach:**
- `skill_runs` table: `id, tenant_id, agent_id?, invoker_user_id, skill_id, skill_version, invocation_source enum, inputs jsonb, resolved_inputs jsonb, resolved_inputs_hash, status enum, delivery_channels jsonb, started_at, finished_at, delivered_artifact_ref jsonb, delete_at (default now() + 30d, capped 180d), feedback_signal enum?, feedback_note text?`.
- Status enum: `running | complete | failed | cancelled | invoker_deprovisioned | skipped_disabled | cost_bounded_error` (no `queued` — runs start immediately in AgentCore session).
- Invocation-source enum: `chat | scheduled | catalog | webhook` (corresponding to the four paths defined in R3; replaces the earlier draft's `programmatic` — webhook supersedes that naming).
- Partial unique index on `(tenant_id, invoker_user_id, skill_id, resolved_inputs_hash) WHERE status = 'running'` for dedup.
- `startSkillRun`:
  1. Resolve caller via `resolveCaller(ctx)` / `resolveCallerTenantId(ctx)`.
  2. Fetch skill metadata (via `/skill/catalog` endpoint on AgentCore container — one source of truth; see Unit 7).
  3. Validate inputs against skill's Pydantic schema and `tenant_overridable` allowlist.
  4. Compute `resolved_inputs_hash` (SHA256 of canonicalized JSON).
  5. `INSERT ... ON CONFLICT (...) WHERE status='running' DO NOTHING RETURNING id`. If no row returned, SELECT the existing run and return its id.
  6. Invoke AgentCore runtime via `invokeComposition()` helper with synthetic envelope `{kind: "run_skill", skillId, inputs, runId}`. RequestResponse invocation — enqueue errors surface.
  7. Return `{runId}`.
- Cancel: write `status=cancelled`; the composition_runner checks this between steps and aborts.
- DeleteRun: tenant admins only; purges row + any S3-referenced deliverables (sanitizing path prefix against tenant_id before DeleteObject).
- SubmitRunFeedback: restricted to invoker; writes `feedback_signal` + `feedback_note`.
- CompositionFeedbackSummary: returns `{positive, negative, total}` per skill per tenant. Powers R13 adoption metric in the admin UI without raw-SQL queries.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts`
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` (caller resolution)
- `packages/api/src/graphql/resolvers/triggers/createScheduledJob.mutation.ts` (post-insert Lambda invoke)

**Test scenarios:**
- Happy path: start → DB row; AgentCore invocation enqueued; runId returned.
- Edge case: dedup — second call within the same running window returns existing runId; no second insert.
- Edge case: tenant not resolvable → `unauthorized`.
- Edge case: skill disabled for tenant → `skill_disabled` error; `skipped_disabled` audit row optional (flag in decision).
- Edge case: inputs violate Pydantic schema → validation error identifies offending field.
- Edge case: override targets field not in `tenant_overridable` → `field_not_overridable` error with offending path.
- Edge case: `delete_at` override > 180 days → rejected by DB check constraint.
- Error path: AgentCore invoke throws → run row left in `running` (reaped by retention sweep if never updated; but error surfaces to caller).
- Authz: non-invoker, non-admin cannot fetch another user's run.
- Authz: cross-tenant run fetch → 404.
- Integration scenario: `submitRunFeedback` by invoker → `compositionFeedbackSummary` reflects the signal.

**Verification:** `pnpm --filter api test`; `pnpm schema:build`; `pnpm lint && pnpm typecheck` monorepo-clean.

---

- [ ] **Unit 5: Skill-dispatcher skill (chat intent path)**

**Goal:** Per-agent dispatcher that reads a manifest of enabled composition skills, matches user messages, extracts inputs, invokes `startSkillRun`, posts the chat ack.

**Requirements:** R3

**Dependencies:** Unit 4.

**Files:**
- Create: `packages/skill-catalog/skill-dispatcher/{skill.yaml, SKILL.md, scripts/dispatch.py}`
- Modify: `packages/agentcore-strands/agent-container/server.py` (expose `/skill/catalog` endpoint returning composition metadata for enabled skills — single source of truth consumed by both dispatcher and GraphQL `startSkillRun`)
- Test: `packages/skill-catalog/skill-dispatcher/tests/test_dispatch.py`

**Approach:**
- Dispatcher prompt loads enabled compositions' `triggers.chat_intent.examples`, scores matches against user message, applies `disambiguation:` mode (ask | highest_confidence | refuse).
- For each typed input, invokes the resolver tool (for string → entity resolution, e.g. `resolve_customer`); handles one/multi/zero match per `on_missing_input`.
- On resolved inputs, calls `startSkillRun` via GraphQL mutation.
- Posts chat ack: one-line restatement of what's running + for whom, expected duration (from skill metadata), link to run-detail view, where the deliverable lands.
- Dedup hit: posts "Already running that — view progress →" instead of starting another.
- Disambiguation pending-state: holds context in-session for up to 2 minutes for a follow-up selection reply; expires with "nvm, let me know when you want to pick up."

**Patterns to follow:**
- Existing skill-catalog structure.
- Auto-memory `feedback_hindsight_recall_reflect_pair` docstring-pair invariant for recall/reflect — not directly applicable but reminds that chained tools have a shared contract.

**Test scenarios:**
- Happy path: one-playbook match, one input resolver one-match → ack posts, run starts.
- Edge case: two compositions match, `disambiguation: ask` → numbered list; reply "1" → start run.
- Edge case: resolver multi-match → inline selectable list; reply selects → run starts.
- Edge case: resolver zero-match with `on_missing_input: ask` → agent asks for clarification.
- Edge case: prompt-injection attempt — input sanitization forces resolver with raw string; resolver returns zero → `on_missing_input: ask` (never silently dispatches).
- Edge case: dedup hit → "already running" message.
- Error path: startSkillRun returns `skill_disabled` → dispatcher posts "that skill isn't enabled for this agent"; does not retry.

**Verification:** Manual end-to-end in dev — chat a real intent, ack posts, run completes, deliverable arrives.

---

- [ ] **Unit 6: Scheduled invocation via `job-trigger`**

**Goal:** `job-trigger` learns to invoke compositions with typed inputs on a schedule, auto-pausing on invoker deprovisioning.

**Requirements:** R3, R10

**Dependencies:** Unit 4.

**Files:**
- Modify: `packages/lambda/job-trigger.ts` (new branch for `trigger_type: "skill_run"`)
- Modify: `packages/database-pg/src/schema/scheduled-jobs.ts` if `trigger_type` is enumerated (else no schema change)
- Test: `packages/lambda/__tests__/job-trigger.skill-run.test.ts`

**Approach:**
- New branch activates when `trigger_type === 'skill_run'`.
- Reads `config.skillId`, `config.inputBindings` from the scheduled_jobs row.
- Resolves bindings (`from_tenant_config`, `today_plus_N`, `literal(v)`).
- Checks skill is enabled for the agent/tenant; if not, writes `skill_runs` row with `skipped_disabled` status (audit visibility).
- Checks invoking admin is still an active Cognito user; if not, sets `scheduled_jobs.status = paused` and exits with a log line.
- Calls `startSkillRun` via service-to-service auth path.

**Patterns to follow:**
- Existing branches in `packages/lambda/job-trigger.ts` (agent_*, eval_scheduled, routineId).

**Test scenarios:**
- Happy path: fires, resolves bindings, starts run.
- Edge case: skill disabled → `skipped_disabled` row, no AgentCore invoke.
- Edge case: admin deprovisioned → schedule paused, log emitted.
- Edge case: `from_tenant_config` missing a required binding → `invalid_binding` status.
- Integration scenario: `rate(1 hour)` semantics match the EventBridge documentation pitfall (creation-time + interval, not wall-clock) — verify behavior is accepted, not fought.

**Verification:** `pnpm --filter lambda test`; dev-stage schedule fires end-to-end.

---

- [ ] **Unit 7: Admin — skill catalog with compositions + run history + per-skill detail**

**Goal:** Extend the existing agent-skills admin page to surface compositions distinctively (tenant-overridable form, schedule builder, Run-now button, feedback summary). Ship a `skill-runs/` observability surface. No new top-level concept.

**Requirements:** R8, R9, R11, R13

**Dependencies:** Unit 4.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx` (render composition-mode skills with extra affordances)
- Create: `apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.$skillId.tsx` (per-skill detail: config, schedule, recent runs, feedback summary)
- Create: `apps/admin/src/routes/_authed/_tenant/skill-runs/index.tsx` (list)
- Create: `apps/admin/src/routes/_authed/_tenant/skill-runs/$runId.tsx` (detail)
- Create: `apps/admin/src/components/skill-runs/*` (StatusBadge, RunTimeline, ArtifactViewer, FeedbackThumbs, EmptyState, FilterBar)
- Create: `apps/admin/src/lib/skill-run-queries.ts`
- Modify: Cognito `CallbackURLs` in `terraform/environments/*/terraform.tfvars` (per auto-memory `project_admin_worktree_cognito_callbacks`, add worktree vite ports as needed)
- Test: `apps/admin/src/routes/_authed/_tenant/agents/__tests__/$agentId_.skills.test.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/skill-runs/__tests__/*.test.tsx`

**Approach:**
- Composition-mode skills in the skills list get: Run-now button, configure link to `$skillId`, feedback summary stat.
- Per-skill detail page: auto-generated form from the skill's `tenant_overridable` allowlist, schedule builder (cron/rate with the `rate()` semantics surfaced as UI helper text), recent-runs mini-list, feedback summary.
- Run-detail view states explicitly rendered: `running | complete | failed | cancelled | invoker_deprovisioned | cost_bounded_error | skipped_disabled`. Labels per the UI-mapping convention from the superseded plan (computed, not stored).
- Live updates: AppSync subscription on `skill_runs` updates (preferred over polling; the repo already uses AppSync subscriptions for `thread_turns` — see `apps/admin/src/routes/_authed/_tenant/agents/$agentId.tsx`). Fall back to 5s polling with exponential backoff only if subscription setup proves costly per stage.
- Runs list: paginated (50/page), filter by agent/skill/status/date/invoker, role-gated (admins see all tenant runs; end users see only their own).
- Accessibility: `role="status" aria-live="polite"` for phase transitions; keyboard focus on all actions; empty states ship on first render.

**Patterns to follow:**
- Existing `$agentId_.skills.tsx` for data fetching with urql.
- `$agentId.tsx` AppSync subscription shape.
- shadcn/ui components already used throughout admin.

**Test scenarios:**
- Happy path: composition-mode skills render distinctly; primitive skills unchanged.
- Happy path: Run-now triggers `startSkillRun`; redirects to run-detail.
- Edge case: form override non-allowlisted field → server rejects; UI highlights the field.
- Edge case: empty run history → first-use empty state with a "Run one from the catalog" CTA.
- Edge case: subscription disconnects → UI indicates "reconnecting" without crashing.
- Edge case: run in terminal state → subscription subscription closes; no infinite polling.
- Edge case: cancel-mid-run → status flips; UI reflects within one update.
- Accessibility: phase transitions announce via aria-live; keyboard tab-order reaches Cancel button.

**Verification:** `pnpm --filter admin lint && pnpm --filter admin test`; manual axe-core scan; walk-through in a worktree stage.

---

- [ ] **Unit 8: Webhook ingress pattern + tenant system-user actor**

**Goal:** Ship the shared webhook-handler pattern (D7b) that lets external integrations trigger composition runs. Two concrete handlers land in v1: CRM opportunity events and task-completion events. The pattern itself (`_shared.ts` helper + conventions + README) is the real deliverable — new integrations beyond v1 add a small Lambda with almost no new code.

**Requirements:** R3, R3a, R8a, R10

**Dependencies:** Unit 4.

**Files:**
- Create: `packages/api/src/handlers/webhooks/_shared.ts` (validate signing secret, parse envelope, resolve entity IDs via named resolvers, dispatch to `startSkillRun` as tenant system-user actor)
- Create: `packages/api/src/handlers/webhooks/crm-opportunity.ts` (CRM "opportunity won" → `customer-onboarding` composition)
- Create: `packages/api/src/handlers/webhooks/task-event.ts` (task-completion event → re-invoke whichever composition created the task, via a `triggered_by_run_id` link stored on the task)
- Create: `packages/api/src/handlers/webhooks/README.md` (pattern doc: how to add a new integration in under 100 lines)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (add both webhook Lambdas to the `for_each` set; add API Gateway routes `POST /webhooks/{integration}`)
- Modify: `packages/database-pg/src/schema/skill-runs.ts` (add optional `triggered_by_run_id` column for follow-up reconciler ticks; add `invocation_source = 'webhook'` enum value)
- Create: Tenant-scoped "system user" bootstrap — a stable Cognito-backed identity per tenant with no chat permissions. Either a new `tenant_system_users` table row per tenant or a deterministic `actor_type = 'tenant_system'` discriminator on `skill_runs.invoker_user_id` (decision in Unit 4's resolver).
- Test: `packages/api/test/handlers/webhooks/*.test.ts`

**Approach:**
- `_shared.ts` exports `handleWebhook(event, { integration, resolveInputs, skillId })`. The caller Lambda provides: the tenant-scoped HMAC validator, a resolver function that maps event payload → `{tenantId, inputs}`, and the target skill id. The shared helper handles auth validation, input resolution, `startSkillRun` invocation, and error shapes.
- **Signing secret per integration per tenant.** Each (tenant, integration) pair has a secret stored in Secrets Manager at `/thinkwork/tenants/{tenantId}/webhooks/{integration}/signing-secret`. Rotation is an admin operation.
- **CRM handler:** accepts a CRM-vendor event envelope; extracts `opportunityId`; calls `resolve_customer(opportunityId, tenantId)` (named tool from Unit 2 contract); invokes `startSkillRun("customer-onboarding", {customerId, opportunityId})`.
- **Task-event handler:** accepts a task-system completion event; reads `triggered_by_run_id` from the task metadata; invokes `startSkillRun(skillId=<same as triggering run>, inputs=<same>)` — this is the reconciler re-invoke path for HITL.
- **Actor identity:** webhook-triggered runs use a tenant system-user actor that has no chat permissions, cannot be impersonated via chat, and is scoped to invoking compositions only. `skill_runs.invocation_source = 'webhook'` is a distinct enum value so runs are easy to filter.
- **Delivery:** webhook-triggered runs have no chat thread. They resolve `delivery: agent_owner` to the owner's preferred channel (R8a). Run-detail UI still shows up under the owning agent.

**Test scenarios:**
- Happy path: valid CRM event → composition starts; `skill_runs.invocation_source = 'webhook'`.
- Edge case: invalid signing secret → 401, no composition started, no tenant enumerated in error.
- Edge case: cross-tenant opportunity ID (vendor sends wrong tenant's event) → resolver tenant assertion fails → 403.
- Edge case: replay attack (same event payload with valid signature received twice) → idempotency via dedup hash on resolved inputs; second invocation returns first's runId.
- Edge case: task-completion event with no `triggered_by_run_id` → fall back to skill-id hint in event; if still ambiguous, log + skip rather than guess.
- Edge case: agent's owner field is null → delivery falls back to a tenant admin notification channel configured per-tenant, or skill run completes with `notification_pending` metric.
- Integration scenario: full customer-onboarding reconciler loop end-to-end — CRM webhook → first tick creates tasks + pending-clarification task → owner completes clarification task → task-event webhook fires → second tick creates next batch of tasks. Verify no duplicate task creation across ticks (output idempotency).
- Security scenario: webhook-triggered composition invocation cannot pass a caller-supplied `actor` that impersonates a real user — `_shared.ts` always sets actor server-side to the tenant system user.

**Patterns to follow:**
- Existing Lambda handlers in `packages/api/src/handlers/` for the Lambda+API Gateway shape.
- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts` for the actor resolution inversion (webhook actor is derived from integration+tenant, not from a Cognito session).

**Verification:** `pnpm --filter api test`; dev-stage webhook fires end-to-end against mocked CRM events.

---

- [ ] **Unit 9: Seed compositions + end-to-end integration suite**

**Goal:** Author four seed compositions with real YAML, prompts, and package templates (three deliverable-shaped + one reconciler-shaped). Ship integration tests covering the four invocation paths, critical-branch failure, cancellation, HITL reconciler loop, and a learnings round-trip.

**Requirements:** R12, R14

**Dependencies:** Units 1–8.

**Files:**
- Create: `packages/skill-catalog/sales-prep/{skill.yaml, prompts/*.md, README.md}`
- Create: `packages/skill-catalog/account-health-review/{skill.yaml, prompts/*.md, README.md}`
- Create: `packages/skill-catalog/renewal-prep/{skill.yaml, prompts/*.md, README.md}`
- Create: `packages/skill-catalog/customer-onboarding/{skill.yaml, prompts/*.md, README.md}`
- Create: `packages/skill-catalog/customer-onboarding/sub-skills/act/{skill.yaml, SKILL.md}` (agent-mode sub-skill for HITL branching)
- Create: `packages/skill-catalog/README.md` (authoring guide; one annotated deliverable example pointing at sales-prep + one annotated reconciler example pointing at customer-onboarding)
- Create: `packages/api/test/integration/skill-runs/chat-intent.test.ts`
- Create: `packages/api/test/integration/skill-runs/scheduled.test.ts`
- Create: `packages/api/test/integration/skill-runs/catalog.test.ts`
- Create: `packages/api/test/integration/skill-runs/webhook.test.ts`
- Create: `packages/api/test/integration/skill-runs/critical-failure.test.ts`
- Create: `packages/api/test/integration/skill-runs/cancel.test.ts`
- Create: `packages/api/test/integration/skill-runs/learnings-roundtrip.test.ts`
- Create: `packages/api/test/integration/skill-runs/reconciler-hitl-loop.test.ts` (customer-onboarding multi-tick test)
- Create: `packages/api/test/integration/skill-runs/fixtures/*`

**Approach:**
- Three deliverable-shaped compositions (sales-prep, account-health-review, renewal-prep) use `frame → gather → synthesize → package` + implicit compound.
- One reconciler-shaped composition (customer-onboarding) uses `gather → synthesize (gap_analysis) → act (agent-mode) → compound`. It delivers via `agent_owner` rather than chat/email.
- Shipping a reconciler alongside deliverables validates that the DSL supports both shapes without special-casing and that the contributor guide can explain both.
- `sales-prep` — chat/schedule/catalog anchor.
- `customer-onboarding` — webhook anchor.
- Integration suite runs against mocked connectors (CRM/AR/tickets/P21/task-system) and a stub AgentCore Memory.
- The `reconciler-hitl-loop.test.ts` explicitly verifies: tick 1 creates N tasks including a pending-clarification task; task-completion webhook triggers tick 2; tick 2 sees updated state and creates only missing tasks (no duplicates); after all tasks complete, subsequent ticks are no-ops with a clean status.
- `validate-skill-catalog.sh` (from Unit 1) runs in CI on every PR touching `packages/skill-catalog/` and enforces the no-blocking-sleep lint on agent-mode sub-skills.

**Patterns to follow:**
- Existing skill-catalog directory conventions.

**Test scenarios:**
- Integration: chat-intent invocation of sales-prep end-to-end → deliverable in thread + email.
- Integration: scheduled invocation of sales-prep via `job-trigger` end-to-end.
- Integration: catalog invocation via admin Run-now end-to-end.
- Integration: critical branch fails → run moves to `failed`, email not sent, chat shows failure notice.
- Integration: cancel during a parallel phase → pending branches not started, already-started branches complete, deliverable omitted.
- Integration: learnings round-trip — Run 1 reflects a learning; Run 2 context includes the learning; Run 3 with a different `user_id` does not include user-scoped learnings from User 1 but does include tenant-wide learnings.
- Integration: three seed compositions each exercise at least one DSL primitive the others do not (verified by a feature-coverage script).

**Verification:** `pnpm --filter api test:integration` green; CI pipeline runs on PRs touching any skill-run-related file.

## System-Wide Impact

- **Interaction graph:**
  - `chat-agent-invoke` → AgentCore Runtime session → `skill-dispatcher` → GraphQL `startSkillRun` → AgentCore composition (same session) → thread post + email.
  - `job-trigger` (new branch) → GraphQL `startSkillRun` → AgentCore invocation → same composition engine.
  - Admin app → `startSkillRun` / `cancelSkillRun` / `deleteRun` / `submitRunFeedback` / `setAgentSkills` → DB + AgentCore.
- **Error propagation:** All three paths surface errors synchronously from `startSkillRun`. AgentCore invocation errors surface to the caller (Lambda or GraphQL). Composition-time errors write sanitized messages to `skill_runs.status` + log lines.
- **State lifecycle risks:** Runs crash mid-session → row left in `running`; nightly retention sweep eventually deletes past `delete_at`; explicit reaper not needed in v1 given no async boundary (add later if crash rate surfaces). Duplicate delivery guarded by one-shot final step: package writes `delivered_artifact_ref` before firing destinations.
- **Retention sweep:** nightly scheduled job deletes `skill_runs` rows where `delete_at <= now()` and cascades S3-referenced deliverables. Part of Unit 4 or a sibling scheduled job in terraform.
- **API surface parity:** All new resolvers follow the standard `snakeToCamel` + `resolveCaller` pattern; no new authentication paths. Mobile app unchanged (can post chat intents; no playbooks UI needed).
- **Unchanged invariants:**
  - `routines` primitive untouched (D8).
  - `thread_turns` / `thread_turn_events` untouched; dispatcher posts are regular assistant messages.
  - `chat-agent-invoke` unchanged except the agent may load a new dispatcher skill.
  - `agent-email-send` skill needs an `mode: outbound` variant (no inbound reply token) — minimal change to existing skill; documented in Unit 8 seed-library work if needed, else folded into an early-phase skill-framework update.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AgentCore session times out on a pathological long-running composition | Low | Med | Default per-step `timeout_seconds: 120`; budget cap at the skill level (opt-in); p95 target 8 min well inside runtime envelope |
| Connector skills not ready at launch | High | High | Integration tests use mocked connectors; adoption success criterion (R13) gated on real CRM connector shipping; failure of a non-critical branch footers gracefully |
| Learnings (compound) returns nothing useful in early weeks | Med | Low | Tenant-wide fallback retrieval; composition runs fine without learnings; the feature compounds value, it doesn't gate launch |
| Tenant `setAgentSkills.config` overrides a non-allowlisted field via direct GraphQL | Low | High | Server-side allowlist enforcement in `setAgentSkills` reads the skill's declared `tenant_overridable` list and rejects with specific field name |
| Dispatcher scoring matches the wrong composition (silent mis-dispatch) | Med | Med | Default `disambiguation: ask` when multiple above threshold; input sanitization at resolver boundary; re-ask if resolver returns zero |
| PII retention obligation drift | Med | High | Hard 180-day ceiling enforced by DB check constraint; `deleteRun` for data-subject requests; nightly retention sweep |
| Dispatcher prompt token cost as library grows | Low | Med | Trajectory note: revisit single-skill dispatcher when enabled-composition count per agent exceeds ~10; intent-embedding pre-filter is the natural next step |
| Cross-tenant leakage via resolver | Low | High | Resolver tools MUST accept tenantId parameter and assert matched entity's tenantId; test in Unit 2 |
| AgentCore Memory scope before per-user refactor lands | Low | Low | Interim scope stored inline; refactor is non-breaking; doc cross-links tracked in auto-memory |
| Routines coexistence confuses admins | Low | Low | UI labels distinguish "classic routine" vs "skill"; phase-2 PRD folds them |
| Webhook retry storms from external integrations | Med | Med | Dedup on resolved-inputs-hash catches same-payload replays; per-(tenant, integration) rate limit in `_shared.ts`; DLQ with alarm |
| Reconciler loop accidentally infinite (tick N creates a task that fires tick N+1 unconditionally) | Low | High | Sub-skills must declare termination conditions; gather always queries existing tasks before creating; integration test `reconciler-hitl-loop.test.ts` asserts clean no-op ticks once all tasks complete |
| Agent owner field null at webhook invocation time | Med | Low | Fallback to tenant-admin notification channel; run does not fail, emits `notification_pending` metric; admin can reconfigure mid-flight |
| Tenant system-user actor's blast radius | Low | High | Compiled-in scope: invocation-only; no chat, no direct DB mutation outside `skill_runs`; Cognito group grants only `startSkillRun` and nothing else |

## Alternative Approaches Considered

- **Peer "playbook" primitive with async worker + SQS** (superseded plan 002) — rejected after verifying AgentCore Runtime supports long sessions natively. Adds an async execution substrate that nothing requires; overlaps cognitively with skills.
- **AWS Step Functions for composition orchestration** — rejected. Even if we kept a separate execution substrate, Step Functions would be the right answer over SQS+Lambda; but since we don't need a separate substrate at all, this is moot.
- **Agent-mode skill with orchestration in the prompt (no DSL)** — rejected as the sole shape. LLM-driven orchestration doesn't guarantee parallelism, and parallel fan-out is a load-bearing performance primitive. Agent-mode remains available alongside composition mode for flexible workflows.
- **Per-user skill variants as a separate concept** (e.g., `my-sales-prep`) — rejected for v1. Learnings system handles personalization. Per-user variants can land later if needed.

## Documentation Plan

- `packages/skill-catalog/README.md` — how to author a composition (one annotated deliverable example + one annotated reconciler example). Part of Unit 9.
- `packages/api/src/handlers/webhooks/README.md` — how to add a new webhook integration in <100 lines. Part of Unit 8.
- Operator runbook for CI + catalog validation — part of Unit 1.
- Post-GA `docs/solutions/` entries: composition runner patterns, learnings scope semantics, skill-allowlist enforcement, reconciler-pattern pitfalls (HITL loops, output idempotency) — planned via `ce:compound-refresh` after first 3 months of production.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-21-structured-playbooks-for-business-problem-solving-requirements.md`
- **Superseded plan:** `docs/plans/2026-04-21-002-feat-playbooks-primitive-v1-plan.md`
- **Critical runtime claim verification:** `packages/agentcore/tenant-router/tenant_router.py:293`, `packages/agentcore/scripts/create-runtime.sh:65`, `packages/api/agentcore-invoke.ts:1–9`
- **Key existing patterns:**
  - `packages/agentcore-strands/agent-container/skill_runner.py` (skill modes)
  - `packages/skill-catalog/` (directory convention)
  - `packages/api/src/graphql/resolvers/agents/createAgent.mutation.ts`
  - `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts`
  - `packages/lambda/job-trigger.ts`
  - `packages/agentcore/agent-container/memory.py` (AgentCore Memory client)
- **Compound-engineering analog:** the `ce:brainstorm` → `ce:plan` → `ce:work` → `ce:review` → `ce:compound` pattern — our reusable-primitive + learnings model is the direct port.
