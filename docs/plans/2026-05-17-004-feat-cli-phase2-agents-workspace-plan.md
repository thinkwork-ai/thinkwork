---
status: active
date: 2026-05-17
type: feat
title: "feat(cli): Phase 2 — agents & workspace (agent / template / tenant / member / team / kb)"
origin: docs/brainstorms/2026-05-17-thinkwork-cli-roadmap-completion-requirements.md
depth: lightweight
---

# feat(cli): Phase 2 — agents & workspace commands

## Summary

Six stub commands from origin R2's Phase 2 list — `agent`, `template`, `tenant`, `member`, `team`, `kb` — become real GraphQL-backed commands. Pure CLI client work; all 50+ subcommands map to existing operations under `packages/database-pg/graphql/types/`. Pattern is identical to Phase 1 (PR #1334 / #1336 / #1338 / #1339).

## Scope

- 6 commands, one PR each, in this order:
  - U1 `member` (smallest — `list`, `invite`, `remove`)
  - U2 `team` (`list`, `create`, `add-agent`, `remove-agent`)
  - U3 `kb` (`list`, `create`, `update`, `delete`, `sync`)
  - U4 `template` (`list`, `get`, `create`, `update`, `delete`, `diff`, `sync-agent`, `sync-all`)
  - U5 `tenant` (`list`, `get`, `create`, `update`, `policy`-style mutations)
  - U6 `agent` (largest — ~26 subcommands across `agent`, `agent capabilities`, `agent skills`, `agent budget`, `agent api-key`, `agent email`, `agent version`)
- Each PR: source + tests + README roadmap row update + commands.mdx full section + smoke build + squash-merge as CI passes.

## Decisions

- **One PR per command, including agent as a single PR.** `agent` is large (~26 subcommands across 5 subgroups) but it's one coherent command. Per the established pattern from Phase 1 (`thread` had 10 subcommands and shipped as one PR), agent ships whole.
- **`agent` gets the `eval/`-style directory** (per-subcommand action files + `gql.ts` + `helpers.ts`). All others stay single-file or split per their subcommand count following the Phase 1 heuristic (≥5 subcommands → directory; otherwise single-file).
- **Per-command `resolveXContext` helpers** mirror Phase 1. The shared-helper consolidation (deferred from Phase 1 U7) waits until end-of-Phase-2.
- **`tenant create` and `tenant delete`** are tenant-scope-mutating verbs. They honor the same `-y/--yes` destructive-verb pattern. Authorization is enforced server-side (Cognito principal must have the appropriate role); CLI doesn't gate.
- **`agent api-key create`** prints the secret once to stdout (matches the existing pattern from `thinkwork user api-key create` if present, or behaves the same way the admin UI does — single one-time reveal).
- **`agent skills set`** and **`agent capabilities set`** accept `--enabled` / `--disabled` (already declared in the scaffold). Config arg via `--config <json>` parsed as raw JSON string at the CLI boundary.
- **`agent version rollback`** is destructive (overwrites current agent config with an older version). Honors `-y/--yes`.

## Per-unit shape (skeleton — fields per unit follow the established Phase 1 plan template)

Every unit follows the same internal shape:
- **Files:** `apps/cli/src/commands/<cmd>.ts` (modified) + (if ≥5 subcommands) new `apps/cli/src/commands/<cmd>/{gql.ts, helpers.ts, <subcommand>.ts...}` + `apps/cli/__tests__/<cmd>-registration.test.ts`.
- **Approach:** mirror `apps/cli/src/commands/thread/` (directory) or `apps/cli/src/commands/label.ts` (single-file).
- **Test scenarios:** registration smoke (all subcommands listed) + per-flag verification + at least one helper unit test where present.
- **Verification:** typecheck + tests green; build smoke shows `--help` lists every subcommand.

Per-command notes:

### U1. `member` (3 subcommands)
Inline single-file. GraphQL: `tenantMembers`, `inviteMember`, `removeTenantMember`. `invite` takes `--role <owner|admin|member>` and `--email <addr>`.

### U2. `team` (4 subcommands)
Inline single-file. GraphQL: `teams`, `createTeam`, `addTeamAgent`, `removeTeamAgent`. Teams group agents for routing/permissions.

### U3. `kb` (5 subcommands)
Directory pattern. GraphQL: `knowledgeBases`, `createKnowledgeBase`, `updateKnowledgeBase`, `deleteKnowledgeBase`, `syncKnowledgeBase`. `sync` re-ingests source documents.

### U4. `template` (6+ subcommands)
Directory pattern. GraphQL: `agentTemplates`, `agentTemplate`, `createAgentTemplate`, `updateAgentTemplate`, `deleteAgentTemplate`, plus `diff` (likely client-side compare against an agent) and `sync-agent`/`sync-all` (push template changes to bound agents). The exact GraphQL operation names for sync/diff resolved at implementation time.

### U5. `tenant` (6 subcommands)
Directory pattern. GraphQL: `tenants`, `tenant`, `tenantBySlug`, `createTenant`, `updateTenant`, plus tenant-policy mutations. Same shape as the helpers we built for thread/inbox.

### U6. `agent` (~26 subcommands across 5 subgroups)
Directory pattern, largest of the phase. GraphQL: `agents`, `agent`, `createAgent`, `updateAgent`, `deleteAgent`, `setAgentStatus`, plus subgroup mutations for capabilities, skills, budget, api-key, email, version. The scaffolded subcommand-group shape (`agent capabilities`, `agent skills`, etc.) is preserved.

Sub-files under `apps/cli/src/commands/agent/`:
- Root verbs: `list.ts`, `get.ts`, `create.ts`, `update.ts`, `delete.ts`, `status.ts`, `unpause.ts`
- Subgroups: `capabilities-set.ts`, `skills-set.ts`, `budget-set.ts`, `budget-clear.ts`, `api-key-create.ts`, `api-key-list.ts`, `api-key-revoke.ts`, `email-enable.ts`, `email-disable.ts`, `email-allowlist.ts`, `version-list.ts`, `version-rollback.ts`
- Plus `gql.ts`, `helpers.ts`

Agent is the longest single PR of the phase. Expect ~2-3x the implementation effort of the others combined.

## Scope Boundaries

**In scope:** the 6 commands above + per-PR docs sync.

**Out of scope:** Phase 3-5 stubs (`routine` through `dashboard`). The plan-deferred items from Phase 1 (Authentication section, helper consolidation, version bump) still defer.

**Deferred to follow-up:** `agent api-key` reveal pattern for secrets in --json mode (probably should write to file rather than stdout when piping — implementation decision at U6 time).

## Verification (Plan-Level)

- 6 PRs merged to main via squash, in U1→U6 order.
- Post-merge Deploy on main green after each merge.
- README roadmap Phase 2 row updated incrementally; final state marks Phase 2 complete.
- `commands.mdx` has top-level sections for all 6 commands.
- 21 stubs → 15 stubs remaining after Phase 2 (Phases 3-5 unchanged).
- Memory updated with the 6 PR numbers as they land.
