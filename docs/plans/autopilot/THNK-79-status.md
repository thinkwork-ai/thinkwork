---
linear: THNK-79
title: "Company Brain"
autopilot_started: 2026-06-26
status: completed
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
- 2026-06-26: Commented on `THNK-79` at U2, U3, U4, U5, and U6 material
  gates: PR opened, CI state, merge, and cleanup.
- 2026-06-26: Final completion comment added after U6 merged and all THNK-79
  worktrees/branches were cleaned up.

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
- U2 PR merged into `main` at
  `1255351973dcc9c89c5e08e4ad6cd10bf3e5d6a6`; remote branch and local U2
  worktree/branch cleaned up.
- U3 implementation started in worktree:
  `/Users/ericodom/.codex/worktrees/thnk-79-u3-cognee-space-memory`.
- U3 added explicit Cognee-backed space memory capture/search, GraphQL
  authorization, generated client types, and Context Engine team-scope reads
  through the memory provider.
- U3 PR merged into `main` at
  `dab7b9592772af54b247eabbb4dd58e863a7f246`; remote branch and local U3
  worktree/branch cleaned up.
- U4 implementation started in worktree:
  `/Users/ericodom/.codex/worktrees/thnk-79-u4-runtime-memory`.
- U4 made the Pi runtime recognize Cognee memory mode, routed agent memory
  through Context Engine `query_memory_context`, and kept raw memory backend
  tools out of Cognee mode.
- U4 PR merged into `main` at
  `7ed07b8b54ee58f5bdd79d0bbef022b0e82f7381`; remote branch and local U4
  worktree/branch cleaned up.
- U5 implementation started in worktree:
  `/Users/ericodom/.codex/worktrees/thnk-79-u5-memory-status`.
- U5 surfaced Cognee user + space memory status in operator settings and docs,
  marked Hindsight as legacy when Cognee is active, and kept company/wiki
  projection visibly deferred.
- U5 PR merged into `main` at
  `f781a795c560c46e0ea07969bde4ec5a654d139f`; remote branch and local U5
  worktree/branch cleaned up.
- U6 implementation started in worktree:
  `/Users/ericodom/.codex/worktrees/thnk-79-u6-memory-smoke`.
- U6 added a Cognee memory cutover smoke that proves the path through
  ThinkWork GraphQL and Context Engine rather than raw Cognee endpoints.
- U6 PR merged into `main` at
  `6c1525acb2b91ebb2acc5ab7fdfbd558959544b4`; remote branch and local U6
  worktree/branch cleaned up.
- THNK-79 completed with no remaining `codex/thnk-79*` branches or worktrees.

## Branches / PRs

- U1 branch: `codex/thnk-79-u1-memory-scope`
- U1 PR: `https://github.com/thinkwork-ai/thinkwork/pull/2988` merged
- U2 branch: `codex/thnk-79-u2-cognee-user-memory`
- U2 PR: `https://github.com/thinkwork-ai/thinkwork/pull/2989`
- U3 branch: `codex/thnk-79-u3-cognee-space-memory`
- U3 PR: `https://github.com/thinkwork-ai/thinkwork/pull/2991`
- U4 branch: `codex/thnk-79-u4-runtime-memory`
- U4 PR: `https://github.com/thinkwork-ai/thinkwork/pull/2993`
- U5 branch: `codex/thnk-79-u5-memory-status`
- U5 PR: `https://github.com/thinkwork-ai/thinkwork/pull/2994`
- U6 branch: `codex/thnk-79-u6-memory-smoke`
- U6 PR: `https://github.com/thinkwork-ai/thinkwork/pull/2995`

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
- U2 CI lint initially failed on the plugin-source boundary guard for the
  shared Cognee memory adapter; added documented shared-platform allowlist
  entries and verified `pnpm lint` passes locally.
- U2 GitHub CI passed: CLA, lint, typecheck, test, verify, signed catalog
  validation.
- U3 local verification included focused API/plugin tests, GraphQL codegen,
  typechecks, lint, and `git diff --check`.
- U3 GitHub CI passed: CLA, lint, typecheck, test, verify, signed catalog
  validation.
- U4 local verification included focused runtime/API tests, typechecks, lint,
  and `git diff --check`.
- U4 GitHub CI passed: CLA, lint, typecheck, test, verify, signed catalog
  validation.
- U5 local verification included schema build, web/mobile/CLI codegen, focused
  API/web tests, API/web/CLI typechecks, lint, format checks, and
  `git diff --check`.
- U5 GitHub CI passed: CLA, lint, typecheck, test, verify, signed catalog
  validation.
- U6 local verification passed:
  - `node --check plugins/company-brain/smoke/cognee-memory-cutover-smoke.mjs`;
  - `node plugins/company-brain/smoke/cognee-memory-cutover-smoke.mjs`;
  - `node plugins/company-brain/smoke/company-brain-context-engine-smoke.mjs`;
  - `node plugins/company-brain/smoke/company-brain-operations-smoke.mjs`;
  - `pnpm --filter @thinkwork/api typecheck`;
  - `pnpm lint`;
  - `git diff --check`.
- U6 GitHub CI passed: CLA, lint, typecheck, test, verify, signed catalog
  validation.

## Blockers

None currently.
