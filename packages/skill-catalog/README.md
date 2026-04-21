# skill-catalog

Canonical source of truth for ThinkWork's skill catalog. Every directory
here is one skill — a `skill.yaml` + `SKILL.md` + optional `scripts/`,
`prompts/`, or `templates/`. The deploy's `bootstrap-workspaces` step
syncs all of them into the `skill_catalog` database table and uploads
the file contents to S3.

This guide is for **authoring a new composition skill**. For the
single-tool skills (scripts that wrap one external API), copy an
existing pattern like `web-search/` or `agent-email-send/`.

---

## Two skill shapes

Composition skills ship in two anchor shapes today:

- **Deliverable-shaped** — one invocation → gather data → produce a
  packaged artifact (a brief, a report). The rep reads it and moves on.
  Anchor: **`sales-prep/`**. See also `account-health-review/`,
  `renewal-prep/`.
- **Reconciler-shaped** — external trigger → check state → create tasks
  / ask clarifying questions → re-invoke on downstream events until the
  world converges to the goal state. Anchor: **customer-onboarding**
  (lands with Unit 8 of the composable-skills plan — webhook ingress).

Both shapes share the same DSL, execution engine, audit table, and
learnings loop. What differs is the gather set, the delivery
destination, and whether there's an `act` sub-skill that mutates
downstream systems.

---

## Annotated deliverable example — `sales-prep/skill.yaml`

```yaml
# Every composition needs an id, version, and execution: composition.
# `mode: tool` is the default — it means the skill can be called from
# any agent. `mode: agent` is for sub-skills that need their own
# reasoning loop (the customer-onboarding/act sub-skill uses it).
id: sales-prep
version: 1
execution: composition
mode: tool
name: "Prep for Meeting"
description: >
  Gather account context, financials, activity, and external signals
  for a sales meeting. …

# Typed inputs. The dispatcher (chat path), job-trigger (scheduled path),
# and startSkillRun resolver (catalog path) all resolve these shapes
# before the runner ever sees them. `on_missing_input: ask` means the
# dispatcher asks the user; `on_missing_input: fail` fails the run.
inputs:
  customer:
    type: string
    required: true
    resolver: resolve_customer       # Named tool that maps slug → entity
    on_missing_input: ask
  meeting_date:
    type: date
    required: true
  focus:
    type: enum
    values: [financial, expansion, risks, general]
    default: general

# Everything a tenant can override via agent_skills.config. Anything
# not listed here is not overridable — setAgentSkills rejects it with
# the offending path. Keep this list short; every entry is trust
# you're extending.
tenant_overridable:
  - inputs.focus.default
  - triggers.schedule.expression

# Every composition needs at least one invocation path. Chat + schedule
# are standard for deliverable shapes; webhook triggers are reserved for
# reconciler-shaped compositions.
triggers:
  chat_intent:
    examples:
      - "prep me for {customer}"
      - "brief me on {customer}"
    disambiguation: ask     # ask | highest_confidence | refuse
  schedule:
    type: cron              # or `rate`
    expression: "0 14 ? * MON-FRI *"
    bindings:
      customer:
        from_tenant_config: default_customer
      meeting_date:
        today_plus_N: 1

# Where the deliverable goes. `agent_owner` (Unit 8) is for reconciler
# shapes that don't have a chat thread.
delivery:
  - chat
  - email

# Per-run ceiling. If the composition burns past this, the runner aborts
# with `cost_bounded_error`. Tune based on the gather set size.
budget_cap:
  tokens: 120000

# The composition body. Ordering matters. The runner walks steps top-to-
# bottom; `{placeholders}` refer to either top-level inputs or named
# outputs from prior steps.
steps:
  # Sequential step — runs one skill, captures its output under `output:`.
  - id: frame
    mode: sequential
    skill: frame            # must be a skill the container can dispatch to
    inputs:
      problem: "Prep for meeting with {customer} on {meeting_date}."
    output: framed

  # Parallel step — runs every branch via asyncio.gather. `critical: true`
  # on any branch means its failure aborts the whole run. Non-critical
  # branches degrade gracefully per on_branch_failure.
  - id: gather
    mode: parallel
    on_branch_failure: continue_with_footer   # or `fail`
    branches:
      - id: crm
        skill: crm_account_summary
        inputs: { customer: "{customer}" }
        critical: true
      - id: ar
        skill: ar_summary
        inputs: { customer: "{customer}" }
    output: gathered

  - id: synthesize
    mode: sequential
    skill: synthesize
    inputs:
      framed: "{framed}"
      gathered: "{gathered}"
      focus: "{focus}"
    output: synthesis

  - id: package
    mode: sequential
    skill: package
    inputs:
      synthesis: "{synthesis}"
      format: sales_brief   # one of: sales_brief | health_report | renewal_risk
    output: deliverable
```

### The four reusable primitives

Every deliverable-shaped composition uses the same four primitives:

1. **`frame`** — restates the problem as goal / constraints / known
   unknowns / decision criteria. Downstream steps reference this as
   `{framed}`.
2. **`gather`** — parallel fan-out. Declarative stub; the runner
   executes the step's `branches:` via `asyncio.gather`.
3. **`synthesize`** — reads the framed problem + gathered data +
   optional focus hint, produces Risks / Opportunities / Open
   questions / Talking points.
4. **`package`** — deterministic template renderer. Takes the
   synthesis + a format name (`sales_brief` / `health_report` /
   `renewal_risk`) and returns Markdown.

If your new composition needs a shape these four don't cover, first
try steering via the focus hint or template choice. If that's not
enough, add the new primitive alongside these four rather than inlining
specialized logic in a new composition.

### The compound loop

Every composition gets `compound.recall` at the top and `compound.reflect`
at the bottom automatically — the composition_runner injects them when
called with a scope. You don't write them into `steps:`. If you *want*
custom recall/reflect behavior, declare them explicitly and the runner
will skip the auto-injection.

The scope is `(tenant_id, user_id?, skill_id, subject_entity_id?)`.
Pick a subject_entity_id when the composition is about one specific
entity (a customer, an account, an opportunity) — it makes the recall
results much more precise.

---

## Annotated reconciler example — `customer-onboarding-reconciler/skill.yaml`

The reconciler shape — webhook trigger → gather → synthesize → act
(agent-mode sub-skill) → compound — is the anchor for Unit 8 of the
composable-skills plan (webhook ingress + tenant system-user actor).
The anchor composition is **`customer-onboarding-reconciler/`**; see
`SKILL.md` there for the runbook and the "why this is a reconciler,
not a workflow" rationale.

```yaml
# Reconcilers are event-driven, so the `mode: tool` + `execution:
# composition` combo stays — same DSL, different shape. The slug
# deliberately does NOT reuse `customer-onboarding` because an
# execution: context legacy of that slug is still referenced by
# production agent_skills rows (see the slug-collision solution doc
# for the three migration paths — Unit 8 picked the "different slug"
# option).
id: customer-onboarding-reconciler
version: 1
execution: composition
mode: tool

# Reconcilers don't need `on_missing_input: ask` — they're webhook-
# triggered, not chat-triggered. If a required input is missing, the
# resolver in `_shared.ts` rejects the webhook with 400.
inputs:
  customerId:
    type: string
    required: true
  opportunityId:
    type: string
    required: true

# Empty in v1 — the reconciler body is not tenant-tunable yet.
tenant_overridable: []

# The webhook trigger shape is advisory documentation; actual routing
# lives in `packages/api/src/handlers/webhooks/crm-opportunity.ts`
# and `task-event.ts`.
triggers:
  webhook:
    examples:
      - source: crm
        event: opportunity.won
      - source: task-system
        event: task.completed

# agent_owner (not chat / email) — webhook-triggered runs have no
# chat thread. Delivery lands at the owning agent's configured
# channel; see `packages/api/src/handlers/webhooks/README.md` for
# how the tenant-admin fallback works when agent_owner is null.
delivery:
  - agent_owner

# Tight budget cap — a reconciler tick is short by design; a drift
# means the act sub-skill is looping.
budget_cap:
  tokens: 60000

# Reconciler body. No `frame` and no `package` — the composition
# produces state changes, not a document. The `gather` step's
# `on_branch_failure: fail` differs from the deliverable shape's
# `continue_with_footer`: a reconciler that can't read existing_tasks
# risks creating duplicates on the next tick, which is worse than a
# failed run.
steps:
  - id: gather
    mode: parallel
    on_branch_failure: fail
    branches:
      - id: customer             # Context anchor.
        skill: crm_account_summary
        inputs: { customer: "{customerId}" }
        critical: true
      - id: existing_tasks       # Prevents duplicate creates. CRITICAL.
        skill: lastmile_tasks_list
        inputs:
          subject_kind: customer
          subject_id: "{customerId}"
          trigger: "customer-onboarding-reconciler"
        critical: true
      - id: contract
        skill: crm_opportunity_summary
        inputs: { opportunity: "{opportunityId}" }
    output: gathered

  - id: synthesize               # focus=gap_analysis steers the primitive
    mode: sequential             # toward what's-missing reasoning instead
    skill: synthesize            # of risks/opportunities reasoning.
    inputs:
      framed: "Onboarding reconciliation for customer {customerId}."
      gathered: "{gathered}"
      focus: gap_analysis
    output: gap_analysis

  - id: act                      # Agent-mode sub-skill. Reads gap + tasks,
    mode: sequential             # creates ONLY missing tasks via the
    skill: customer-onboarding-reconciler/act
    inputs:                      # lastmile_tasks_create tool. MUST NOT
      customerId: "{customerId}" # `asyncio.sleep` — CI lint enforces.
      opportunityId: "{opportunityId}"
      gap_analysis: "{gap_analysis}"
      existing_tasks: "{gathered.existing_tasks}"
    output: action_summary
```

### Why reconcilers never block

Real onboarding waits on humans: clarification answers, contract
signatures, payment setup, team assignments. The tempting
implementation is an inline `await_task_completion(...)` — which the
plan's D7a decision explicitly rejected. Waiting inside one
invocation holds an AgentCore session open indefinitely, breaks the
dedup-on-running index semantics, and forces a new execution
substrate.

Reconcilers invert this: each tick is short. Reading state → creating
missing tasks → exit. When a human completes a task, the task-system
webhook fires, the composition re-invokes with the same inputs, reads
state again (now including the completed task), and decides what's
still missing.

### Output idempotency

The invariant the reconciler depends on is: **gather always reads
before act writes, and act only writes tasks that don't already
exist.** The composition's `gather` step MUST include a branch that
lists existing tasks for the subject entity. The `act` sub-skill MUST
diff against that list before creating anything. Two ticks running
back-to-back with the same inputs must produce at most one task per
gap — not two.

The `reconciler-hitl-loop.test.ts` integration test (Unit 8) asserts
this by running a full tick → task-complete → re-tick sequence and
verifying the `lastmile_tasks_create` call count matches exactly the
number of gaps identified on the first tick.

---

## Validation + CI

`scripts/validate-skill-catalog.sh` runs in CI on every PR that touches
this directory. It:

1. Loads every `skill.yaml` with `execution: composition` via Unit 1's
   Pydantic schema — catches DSL violations at PR time, not deploy time.
2. Greps all `.md` / `.tmpl` / `.yaml` files for tenant-specific
   strings. If you're tempted to hard-code a tenant's domain or
   slug, put it in `tenant_settings.features` instead — the
   validator keeps an allowlist of known tenant domains and fails
   loud when one shows up in an OSS YAML.
3. Scans every composition's Python sub-skills for blocking sleeps
   (`time.sleep`, `asyncio.sleep`). Composition sub-skills never block
   — the reconciler contract depends on that invariant.

Run it locally with `bash scripts/validate-skill-catalog.sh` before
pushing. It exits 0 on pass, prints offending files on fail.

---

## Further reading

- Plan: `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md`
- Pydantic schema: `packages/agentcore-strands/agent-container/skill_inputs.py`
- Runner: `packages/agentcore-strands/agent-container/composition_runner.py`
- Auto-compound contract: `packages/skill-catalog/compound/SKILL.md`
