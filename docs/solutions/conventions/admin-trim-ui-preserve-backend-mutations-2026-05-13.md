---
title: "When trimming admin UI surfaces, preserve backend mutations used by other surfaces"
date: 2026-05-13
category: conventions
module: apps/admin/agent-builder
problem_type: convention
component: development_workflow
severity: medium
applies_when:
  - Removing entry points or widgets from apps/admin workspace editor
  - Pruning toolbar actions, dropdowns, or context-menu items
  - Deleting orphaned components that may share GraphQL mutations with other surfaces
tags:
  - admin
  - ui-trim
  - mutations
  - agents-folder
  - workspace-editor
  - cleanup-arc-2026-05-13
---

# When trimming admin UI surfaces, preserve backend mutations used by other surfaces

## Context

When trimming over-engineered admin surfaces, there is a strong temptation to rip out the supporting backend mutations and lib functions "while you're at it." The WorkspaceEditor refactor (PRs #1193, #1199, #1203, #1207) removed eight specialized toolbar affordances, but the underlying GraphQL mutations and helper functions had to stay because other admin surfaces still depend on them. Treating UI removal and backend removal as a single atomic change would have broken parallel entry points like the `/capabilities/skills` install page.

The cleanup-arc that prompted this convention spanned five PRs in one afternoon, each a small surgical strike at a single over-engineered surface, each merging within 30–60 minutes of opening per [[feedback_merge_prs_as_ci_passes]] (auto memory [claude]).

## Guidance

Treat UI removal and backend removal as **independent decisions**, sequenced in two PRs:

1. **UI removal PR first** — drop entry points decisively, leave backend untouched. Ship and verify nothing else regresses.
2. **Backend audit PR second** — `grep -rn` for callers of the now-orphaned exports. Drop only the genuinely-dead ones; keep anything reached from another route, CRUD page, CLI tool, or scheduled job.

For data-driven UI (synthetic groupings derived from stored content), keep the parser/derivation code even if the authoring widget is gone. The data path is independent of the authoring path.

## Why This Matters

The same backend often powers multiple frontends or admin surfaces. Ripping UI + backend together in one PR creates silent regressions in surfaces the author didn't think to check — and those regressions are usually caught in production rather than CI because cross-surface tests rarely exist. The two-PR pattern makes the cross-surface check explicit instead of implicit.

It also keeps PRs reviewable: a UI-only PR is a visual diff; a backend audit PR is a `grep` + delete diff. Mixing them produces a PR where reviewers can't cheaply verify either claim.

This same discipline showed up in a prior session arc (PRs #963–#976, branch `feat/thinkwork-ui-shadcn-primitives`, 2026-05-08) where the Computer-owned thread chip lost its interactive Popover trigger and became a static chip — UI interaction removed, backend `assigneeType` model untouched. Three reviewers (maintainability, adversarial, correctness) had flagged P1 inconsistency when the chip was rendered inside the active Popover trigger; the fix was UI-only. (session history)

## When to Apply

- Any "trim admin surface X" request
- Especially when the same backend powers multiple frontends or admin surfaces
- When a planning doc says "simplify the editor" — assume the backend will keep at least one other caller and verify before dropping it
- When you find yourself reaching for "and while we're at it, delete the mutation" — split the PR

## Examples

**This session — WorkspaceEditor toolbar trim:**

Eight UI affordances removed across PRs #1193, #1199, #1203, #1207:
- New Skill, Add from catalog, Import bundle, Bootstrap defaults
- Add sub-agent
- Four hardcoded folder buttons (Add docs/, Add procedures/, Add templates/, Add memory/)
- Snippets dropdown, `.md` auto-title scaffold

Backend that **stayed wired** because other surfaces use it:

```ts
// apps/admin/src/components/agents/AgentConfigSection.tsx:305
import { installSkillToAgent } from "@/lib/skills-api";
// The /capabilities/skills page is still the canonical install entry point.
```

```ts
// apps/admin/src/components/agent-builder/routing-table.ts — parser kept
// Even though RoutingTableEditor was removed in PR #1203 and
// AddSubAgentDialog in PR #1207, sub-agents are still reachable: users
// hand-edit AGENTS.md routing rows, and the WorkspaceEditor parse →
// FolderTree synthetic agents/ grouping (data-driven) makes them
// visible in the tree.
```

Backend audit **parked as a future PR**: `createSubAgent`, `importBundle`, `bootstrapDefaults` in `agentBuilderApi` are likely orphaned — drop only after `grep -rn` confirms no remaining callers.

## Related

- (auto memory [claude]) [[project_agents_folder_ui_only_decision]] — agents/ folder is UI fabrication, not storage
- (auto memory [claude]) [[feedback_ui_fabrication_test]] — when impl says "UI fabricates X," the storage change isn't doing operator-facing work
- (mirror pattern) [docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md](../design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md) — the don't-build-parallel-UI counterpart to this delete-parallel-UI rule
- (retirement playbook) [docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md](../patterns/retire-thinkwork-admin-skill-2026-04-24.md) — preserve capability, drop the visible thing
- (deduplicate write path) [docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md](../architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md)
- PRs #1193, #1199, #1203, #1207 — WorkspaceEditor toolbar refactor (this session's arc)
- PRs #963, #965, #976 — predecessor "gut interaction, keep backend" arc (session history)
