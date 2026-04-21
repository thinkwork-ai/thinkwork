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

## Reconciler example

The reconciler shape — webhook trigger → gather → synthesize → act
(agent-mode sub-skill) → compound — ships with **Unit 8** of the
composable-skills plan (webhook ingress pattern + tenant system-user
actor). The anchor composition is `customer-onboarding`; its
`sub-skills/act/` is an `execution: composition, mode: agent` sub-skill
that decides what to mutate in the downstream task system this tick.

When Unit 8 lands, this README gets a companion reconciler walkthrough.
The key architectural difference from the deliverable shape:
reconcilers are **stateless across invocations** (their output
idempotency lives in the downstream task system via `gather` querying
"what already exists?"), and they **never block waiting for a human**
— they end the tick after creating tasks / asking questions and re-run
when the downstream event fires.

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
