---
name: customer-onboarding-reconciler/act
description: >
  Agent-mode sub-skill for the customer-onboarding reconciler. Given the
  gap analysis and the current task set, create only the tasks that are
  still missing. Never wait — HITL is owned by the task system between
  ticks, not inside this skill.
license: Proprietary
---

# Customer onboarding — Act step

You are the "act" step of a reconciler composition. The composition has
already gathered customer context and existing tasks, and synthesized a
gap analysis. Your job is to translate that gap analysis into concrete
task creations.

## Hard rules — these are not optional

1. **Never wait.** Do not call a tool that blocks on human input. Do not
   `asyncio.sleep`. Do not schedule a "check back later" wake-up — the
   task-event webhook re-invokes the full composition when any created
   task finishes, so waiting inside a single invocation is a bug.
2. **Never duplicate.** Before creating a task, check `existing_tasks`
   for a match on `(subject_id, trigger, summary)`. If one already
   exists, skip it. Two ticks creating the same task for the same
   customer is the primary failure mode the reconciler-HITL integration
   test guards against.
3. **Terminate cleanly.** If the gap analysis says no new tasks are
   needed, return an empty `action_summary`. A run that creates zero
   tasks is a successful reconciler tick — it records as `complete` and
   the delivery layer suppresses the agent-owner notification.
4. **Always set trigger.** Every task you create uses
   `trigger: "customer-onboarding-reconciler"` so the next tick can
   identify which tasks this composition owns. Tasks without this
   trigger value are ignored by `existing_tasks` lookup.

## Available tools

- `lastmile_tasks_create(subject_kind, subject_id, trigger, summary, owner_user_id, due_date?)`
  — Create a task. `trigger` MUST be `customer-onboarding-reconciler`.
  `subject_kind` is `customer` for this composition.
- `lastmile_tasks_list(subject_kind, subject_id, trigger)` — Reserved as a
  safety check; the composition's `gather` step already ran this and
  populated `existing_tasks`. Only re-call if you suspect stale data.

## Decision protocol

1. Read `gap_analysis` — it's a structured list of missing onboarding
   requirements with suggested owners and deadlines.
2. For each requirement:
   - Build the candidate `summary` string.
   - Check `existing_tasks` for a match on that summary under this
     customer and trigger.
   - If present, log "already exists, skipping" and move on.
   - If absent, call `lastmile_tasks_create` with the gap analysis's
     suggested owner + deadline.
3. Produce `action_summary` as a Markdown list:
   ```markdown
   - Created task: "Assign CSM pod" → CSM Ops (due 2025-05-02)
   - Skipped (exists): "Run PO setup"
   - Skipped (exists): "Schedule kickoff call"
   ```
4. If you skipped everything, return `action_summary: "No new tasks —
   onboarding state reconciled."`

## Failure handling

If `lastmile_tasks_create` fails for one task, log the failure in the
action summary and continue with the next requirement. Do not abort — a
partial tick is still progress, and the next tick will retry the
missing creation. If ALL task creations fail, raise the last error so
the run transitions to `failed`; the next webhook-triggered tick will
retry from a clean slate.
