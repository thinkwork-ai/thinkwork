---
module: packages/skill-catalog/customer-onboarding + composable-skills Unit 8
date: 2026-04-21
category: workflow-issues
problem_type: workflow_issue
component: tooling
severity: medium
related_components:
  - database
  - development_workflow
applies_when:
  - "An existing skill's slug is needed for a new skill with a different execution mode"
  - "The legacy skill is already synced to skill_catalog in production"
  - "Renaming the legacy skill would invalidate agent_skills rows pointing to it"
  - "Changing the new skill's slug would diverge from the plan's canonical naming"
tags:
  - skill-catalog
  - slug-collision
  - composable-skills
  - migration
  - execution-mode
  - customer-onboarding
  - unit-8
---

# Skill-catalog slug collisions between execution modes need explicit migration plans

## Context

Unit 9 of the composable-skills plan calls for a reconciler-shaped
composition skill at `packages/skill-catalog/customer-onboarding/`
with `execution: composition`. That directory **already exists** —
a legacy `execution: context` skill with the same slug was synced
to the `skill_catalog` table during earlier work and is referenced
by `agent_skills` rows in production.

Unit 9 was scoped to three deliverable-shaped seeds (sales-prep,
account-health-review, renewal-prep) and the authoring guide. The
reconciler composition was deferred to Unit 8 (webhook ingress)
because:

1. The reconciler needs Unit 8's webhook handlers to actually
   converge — landing the composition YAML without the webhook
   path leaves it unreachable.
2. Replacing the slug in-place risks breaking existing
   `agent_skills` rows that expect `execution: context` behavior
   (different tool-registration semantics, different invocation
   path through the agent container).
3. Unit 8 is the right owner of the migration question because
   it's building the actual reconciler surface.

This doc captures the collision, the three possible migration
paths Unit 8 can pick from, and the trade-offs.

## Guidance

When a new skill needs a slug that's already in use by a different
execution mode:

**Don't silently replace the legacy skill's `skill.yaml`.** The
`agent_skills` join rows point to the slug. Flipping `execution:
context` to `execution: composition` underneath them will change
how the agent container loads the skill — legacy context skills
are prompt-only (SKILL.md is injected verbatim), composition
skills are orchestrated via `composition_runner.py`. Agents
currently invoking the legacy skill would start getting unexpected
behavior without a deploy-time signal.

**Pick one of three explicit paths:**

1. **Rename the legacy skill to a historical slug** (e.g.,
   `customer-onboarding-legacy`), migrate existing `agent_skills`
   rows via a small data migration, and land the new composition
   at the canonical slug. Clean but requires a DB migration step
   coordinated with the deploy.
2. **Pick a different canonical slug for the new composition**
   (e.g., `customer-onboarding-reconciler`). Simpler but leaves
   the plan's naming inconsistent — the rest of `docs/plans/...`
   references `customer-onboarding` as the reconciler anchor.
3. **Version-bump the legacy and co-locate.** Introduce
   `customer-onboarding/legacy/skill.yaml` and
   `customer-onboarding/v2/skill.yaml` under the same directory,
   with the `skill_catalog` table distinguishing rows by a new
   `execution_mode` + `version` pair. Most structural change;
   only worth it if collisions are expected to recur.

The right answer depends on how many agents currently use the
legacy skill and how quickly Unit 8 can coordinate with the
design-partner rollout. A 5-minute read of `SELECT count(*) FROM
agent_skills WHERE skill_id = 'customer-onboarding' AND enabled =
true` tells you whether path (1)'s migration is trivial or
non-trivial.

## Why This Matters

Skills are first-class catalog entries, not just config. Agents
have `agent_skills` rows that reference them by slug, and the
composable-skills plan's design intentionally makes the slug the
stable identifier across execution-mode evolutions (today's
`context` skill can be tomorrow's `composition` skill). That
stability is a feature — it lets compositions drop in as
upgrades without churn for admins — but it requires a deliberate
transition plan each time the underlying execution mode changes.

Silently replacing the `execution:` field of an in-use skill
catches admins by surprise: agents start going through a
different runtime path, tool registration changes, and the
legacy skill's prompt-only behavior (which the agent may have
been implicitly relying on) stops firing. The collision is a
symptom of a healthy first-class-catalog design; the fix is an
explicit migration plan, not silent replacement.

## When to Apply

This applies when:

- A new skill's planned slug conflicts with a legacy skill's
  directory name in `packages/skill-catalog/`
- The legacy skill has non-zero rows in `agent_skills` (run the
  `SELECT count(*)` before deciding)
- The new skill changes `execution:` relative to the legacy

Does not apply when:

- The legacy skill is a scaffold no production agent uses
  (counts-zero query) — in that case, replace in place and
  document the removal
- The new skill is a pure version-bump with identical
  `execution:` (use the existing `version:` field)

## Examples

**The state Unit 9 left for Unit 8:**

```yaml
# packages/skill-catalog/customer-onboarding/skill.yaml — LEGACY
slug: customer-onboarding
execution: context
mode: tool
# … prompt-only SKILL.md injection …
```

The plan's target shape (from `docs/plans/2026-04-21-003-feat-
composable-skills-with-learnings-plan.md`, sample YAML under Unit 4's
reconciler example):

```yaml
# Unit 8's target
id: customer-onboarding
execution: composition
mode: tool
# …webhook trigger + gather → synthesize → act sub-skill…
steps:
  - id: gather
    mode: parallel
    branches: [...]
  - id: synthesize
    # …
  - id: act
    mode: sequential
    skill: customer-onboarding/act    # agent-mode sub-skill
```

**Pre-flight query Unit 8 should run before deciding:**

```sql
SELECT
  count(*) AS active_rows,
  count(DISTINCT tenant_id) AS distinct_tenants
FROM agent_skills
WHERE skill_id = 'customer-onboarding'
  AND enabled = true;
```

If `active_rows == 0`: path (1), no data migration needed — delete
the legacy rows, replace the directory, done.

If `active_rows > 0`: either pair the `skill.yaml` replacement
with a migration that moves rows to the renamed legacy slug, or
pick path (2) to avoid touching production rows at all.

**Recommended default if Unit 8 has no other signal:** pick path
(2) — `customer-onboarding-reconciler` (or a shorter
`customer-reconciler`) — and document the transition. Cheaper
than coordinating a data migration mid-feature, and the plan
doc's canonical name is more of a convention than a constraint.

## Related

- `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md`
  — the composable-skills plan where the slug conflict originates.
  The reconciler example YAML there assumes the canonical slug.
- `packages/skill-catalog/customer-onboarding/skill.yaml` — the
  legacy skill file Unit 8 will have to decide about.
- `packages/database-pg/src/schema/agents.ts` — `agent_skills`
  schema, the target of the SQL check + any migration.
- auto memory `project_thinkwork_supersedes_maniflow` — the broader
  pattern: we're mid-migration from an old system, renames need
  deliberate plans, not silent replacements.
