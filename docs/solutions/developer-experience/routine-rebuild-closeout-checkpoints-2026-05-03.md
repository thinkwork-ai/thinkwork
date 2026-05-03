---
title: "Routine rebuild closeout checkpoints"
date: 2026-05-03
category: developer-experience
module: routines
problem_type: developer_experience
component: development_workflow
severity: medium
applies_when:
  - "A multi-PR feature plan has shipped the product MVP but the original master plan still has active follow-up work"
  - "A generated workflow feature stores executable runtime state separately from the product-owned authoring model"
  - "A UI can test deployed workflow executions before all authoring, mobile, agent, and observability surfaces are complete"
tags:
  - routines
  - step-functions
  - closeout
  - authoring
  - workflow-editor
  - execution-detail
---

# Routine rebuild closeout checkpoints

## Context

The Routines rebuild moved from a Python-script shim to AWS Step Functions, then quickly expanded through several follow-up PRs: manual execution, recipe-backed authoring, per-step config, graph editing, builder polish, execution-aware editing, and output-backed step status reconciliation. The deployed admin MVP became real before the original master plan's metadata caught up.

That creates a predictable closeout risk: "Test Routine works" can sound like "the whole Routines plan is done." In this rebuild, that was not quite true. The admin MVP was shipped and deployed, while Phase E's `python()` usage dashboard, mobile conversational live-validator feedback, and agent runtime activation still needed separate ownership.

## Guidance

Treat closeout as its own documentation step for large feature plans. Before declaring the work done, reconcile three different status layers:

- **Product MVP status:** Can a user complete the core workflow end to end?
- **Original plan status:** Which planned units are completed, superseded, or still active?
- **Operational readiness status:** Which deployment, runtime-activation, observability, and follow-up paths remain?

For Routines, the useful closeout split is:

- Admin Routine MVP: complete. Users can create recipe-backed routines, edit step-owned config, test the routine, and inspect execution detail.
- Master plan: active. Phase E U16 still needs the `python()` usage dashboard and recipe-promotion loop.
- Phase C original mobile/agent authoring plan: superseded for the admin MVP. The prompt and MCP tool shells exist, but mobile live-validator chat and agent runtime activation should be tracked as focused follow-up work.

Use this checkpoint sequence for future workflow features:

1. Grep the plan docs for stale `status: active` frontmatter.
2. Verify the code surface, not only plan intent:
   - GraphQL types/resolvers for deprecated paths
   - generated clients
   - mobile/admin consumers
   - residual-review finding files
   - deployed UI behavior after a hard refresh
3. Update the master plan with `Completed` and `Remaining` sections.
4. Mark phase plans as `completed`, `superseded`, or still `active`.
5. Add a compound doc for the lessons that future agents need before touching the area again.

## Why This Matters

Workflow products have multiple "sources of truth": authoring metadata, generated ASL, Step Functions versions and aliases, execution rows, step events, and UI-derived graph state. A successful manual or UI execution proves the runtime path, but it does not automatically prove the authoring model, mobile parity, agent tools, or observability loop.

The Routines rebuild had several lessons worth preserving:

- Recipe catalog metadata must be the source of truth for configurable fields. Hardcoded UI fields such as `recipientEmail` do not scale; `email_send.args.to` does.
- Test buttons must run the last saved/published version. Dirty editor state should block or warn before execution so the user does not test stale ASL.
- Execution detail should render from the ASL version that backed the run, not from the latest routine definition.
- Step status may need reconciliation from execution output when callback events are absent. A succeeded execution with output-backed step data should not render a step as pending.
- Deployed admin verification may require a hard refresh after a new bundle ships; a stale cached UI can make a fixed execution detail page look broken.
- Deprecated schema removal should be staged after every generated client and mobile/admin consumer has moved to the replacement surface.

## When to Apply

- A feature lands through several PRs and follow-up plans instead of one linear implementation.
- A plan contains a mix of substrate, runtime, authoring, UI, mobile parity, agent tooling, and observability.
- The user asks whether "we are done" after the core demo succeeds.
- Residual review findings exist for deferred work.

## Examples

Use plan status to encode the difference between shipped, superseded, and remaining:

```yaml
status: completed
```

Use `completed` when the planned scope landed and later work built on it.

```yaml
status: superseded
```

Use `superseded` when a plan's original route was replaced by a better shipped path, and record what still needs a focused follow-up.

```markdown
## Closeout Status

The deployed admin Routine MVP is complete. The full master plan remains active
because Phase E U16's `python()` usage dashboard is still open.
```

Use the master plan to tell future agents exactly why the effort is or is not done.

## Related

- `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- `docs/plans/2026-05-01-008-feat-routines-phase-e-cleanup-plan.md`
- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md`
- `docs/residual-review-findings/feat-routines-phase-d-mobile-parity.md`
- `docs/residual-review-findings/feat-routines-phase-e-u15.md`
