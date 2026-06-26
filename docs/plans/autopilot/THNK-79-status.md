---
linear: THNK-79
title: "Company Brain"
autopilot_started: 2026-06-26
status: active
---

# THNK-79 Autopilot Status

## Objective

Implement the narrowed Cognee memory cutover end to end:

- replace the Hindsight-backed session memory proof with Cognee-backed user
  memory;
- add explicit Cognee-backed space memory;
- prove capture, recall, authorization, and runtime/provider behavior;
- defer company distillation, ontology, and wiki to a follow-up effort.

## Context Discovery

- Read `AGENTS.md`.
- Fetched Linear issue `THNK-79`.
  - Title: `Company Brain`
  - Team: `ThinkWork`
  - Project: `Enterprise Agent OS`
  - Assignee: Eric Odom
  - Status at discovery: `In Progress`
  - Child issues: none returned by Linear.
  - Attachments:
    - `https://www.cognee.ai/`
    - `https://mempalaceofficial.com/`
  - Attached document:
    - `Plan: Cognee user and space memory cutover`
- Read all Linear comments returned by the Linear connector.
- Read the attached Linear plan document.
- Read repo-local primary plan:
  `docs/plans/2026-06-26-003-feat-cognee-first-memory-ladder-plan.md`.
- Read repo-local requirements/amendment:
  `docs/brainstorms/2026-06-26-thnk-79-cognee-first-memory-ladder-requirements.md`.
- Searched the repo for `THNK-79`, `Company Brain`, Cognee, Hindsight, and
  memory planning references.
- Read relevant institutional learnings:
  - `docs/solutions/architecture-patterns/company-brain-active-substrate-reads-through-context-engine-2026-06-15.md`
  - `docs/solutions/architecture-patterns/company-brain-provisioning-contract-tenant-scoped-2026-06-15.md`
  - `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`
  - `docs/solutions/architecture-patterns/generated-knowledge-projections-need-read-only-agent-traversal-gates-2026-06-24.md`
- Read adjacent prior memory plans:
  - `docs/plans/2026-05-18-002-feat-requester-memory-dreaming-plan.md`
  - `docs/plans/2026-05-19-001-feat-hindsight-primary-user-memory-plan.md`

## Source Of Truth

Priority order for conflicts:

1. Linear document: `Plan: Cognee user and space memory cutover`
2. Repo-local plan:
   `docs/plans/2026-06-26-003-feat-cognee-first-memory-ladder-plan.md`
3. Scope amendment in:
   `docs/brainstorms/2026-06-26-thnk-79-cognee-first-memory-ladder-requirements.md`
4. Older brainstorm comments and earlier full-ladder plan notes

The newest plan narrows scope to Cognee user + space memory. Company-level
distillation, ontology processing, and wiki rendering are explicitly deferred.

## Implementation Units

No Linear child issues exist, so the plan units are the implementation units:

1. U1: Define user and space memory scope keys.
2. U2: Implement Cognee user-memory capture and recall.
3. U3: Implement explicit Cognee space-memory capture and recall.
4. U4: Update runtime memory providers and tool semantics.
5. U5: Add operator status and minimal UI affordances.
6. U6: Prove the cutover with deployed smoke coverage.

## Linear State Log

- 2026-06-26: Discovery found `THNK-79` already in `In Progress`; no state
  change made during context discovery.
- 2026-06-26: Commented on `THNK-79` when U1 PR opened.
- 2026-06-26: Commented on `THNK-79` when U1 merged and cleanup completed.

## Work Log

### 2026-06-26

- Autopilot context discovery started.
- Primary plan identified and conflicts resolved in favor of the newest
  Linear-attached cutover plan.
- Status document created.
- U1 implementation started in worktree:
  `/Users/ericodom/.codex/worktrees/thnk-79-u1-memory-scope`.
- U1 defined the Cognee memory scope contract:
  - user memory uses `thinkwork:memory:v1:tenant:<tenant>:user:<user>`
    datasets and `thinkwork_user_memory` node sets;
  - space memory uses `thinkwork:memory:v1:tenant:<tenant>:space:<space>`
    datasets and `thinkwork_space_memory` node sets;
  - both scopes include shared `thinkwork_memory`, version, and tenant node
    sets for cross-scope discovery without merging ownership.
- U1 made `MEMORY_ENGINE=cognee` a valid memory configuration mode requiring
  `COGNEE_ENDPOINT`; adapter wiring remains a later unit.
- U1 PR merged into `main` at
  `5a3dd68e91ce104228633e7e9d53ef0005277d60`; remote branch and local U1
  worktree/branch cleaned up.
- U2 implementation started in worktree:
  `/Users/ericodom/.codex/worktrees/thnk-79-u2-cognee-user-memory`.
- U2 adds the Cognee memory adapter and routes user requester-memory document
  writes through Cognee when `MEMORY_ENGINE=cognee`.

## Branches / PRs

- U1 branch: `codex/thnk-79-u1-memory-scope`
- U1 PR: `https://github.com/thinkwork-ai/thinkwork/pull/2988` merged
- U2 branch: `codex/thnk-79-u2-cognee-user-memory`
- U2 PR: pending

## Verification Log

- `pnpm install` completed in the U1 worktree; optional `canvas` native build
  emitted a Node 25/pkg-config warning but install exited successfully and did
  not affect touched package tests.
- `pnpm --filter @thinkwork/plugin-company-brain test -- test/api/cognee-client.test.ts test/api/cognee-memory-scope.test.ts`
  passed: 2 files, 15 tests.
- `pnpm --filter @thinkwork/api test -- src/lib/memory/config.test.ts`
  passed: 1 file, 3 tests.
- `pnpm --filter @thinkwork/plugin-company-brain typecheck` passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- U1 GitHub CI passed: CLA, lint, typecheck, test, verify, signed catalog
  validation.
- `pnpm --filter @thinkwork/plugin-company-brain test -- test/api/cognee-client.test.ts test/api/cognee-memory-scope.test.ts`
  passed for U2: 2 files, 16 tests.
- `pnpm --filter @thinkwork/api test -- src/lib/memory/adapters/cognee-adapter.test.ts src/lib/memory/config.test.ts src/lib/requester-memory/hindsight-primary.test.ts src/lib/requester-memory/hindsight-sync.test.ts src/lib/memory/recall-service.test.ts`
  passed for U2: 5 files, 15 tests.
- `pnpm --filter @thinkwork/plugin-company-brain typecheck` passed for U2.
- `pnpm --filter @thinkwork/api typecheck` passed for U2.
- `git diff --check` passed for U2.

## Blockers

None currently.
