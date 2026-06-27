# THINK-83 Autopilot Status

## Objective

Implement THINK-83 end to end: pivot user and Space memory back to Hindsight,
keep Cognee as optional ThinkWork Brain ontology/graph infrastructure, keep
Memory under `/settings/memory` for this pass, fix the operator Memory table,
and rebrand customer-facing Company surfaces to ThinkWork names.

## Context Discovery

- Started: 2026-06-27.
- Repository instructions read from `AGENTS.md`.
- Compound Engineering workflow read: `lfg` and `ce-work`.
- Linear issue read: `THINK-83` / "Pivot user and Space memory back to
  Hindsight".
- Linear comments read. Newest correction says:
  - Do not move Memory routing in this pass.
  - Keep the operator Memory UI under `/settings/memory`.
  - Add the blank Memory Table as an explicit operator-only Hindsight issue.
  - The table should show all operator-visible Hindsight records with bank,
    created/updated date, scope/owner where derivable, type/strategy, and
    content.
- Linear attached document read:
  `Plan: Pivot Memory to Hindsight in ThinkWork Brain`.
- Conflict resolution:
  - The Linear document is older and still says to move Memory out of Settings.
  - The latest Linear comment and repo-local plan supersede it.
  - Current implementation keeps `/settings/memory` and fixes the data contract.
- Related issue read: `THINK-79` / "Company Brain".
- Related THINK-79 comments and document read:
  `Plan: Cognee user and space memory cutover`.
- PR #3018 inspected. It is draft/open by design and is diagnostic evidence for
  Cognee scope bleed, not the merge path for THINK-83.
- No child issues found for THINK-83. Implementation units come from the plan.
- Repo search for `THNK-83`, `THINK-83`, the plan filename, and the issue title
  found only the new local brainstorm and plan files.
- Origin/main does not yet contain the THINK-83 brainstorm or plan files; the
  first implementation unit should include those planning artifacts.

## Repo-Local Planning Files

- `docs/brainstorms/2026-06-27-thnk-83-hindsight-thinkwork-brain-boundary-requirements.md`
- `docs/plans/2026-06-27-001-feat-thinkwork-brain-hindsight-memory-plan.md`

## Prior Solution Docs Read

- `docs/solutions/architecture-patterns/company-brain-active-substrate-reads-through-context-engine-2026-06-15.md`
- `docs/solutions/architecture-patterns/company-brain-provisioning-contract-tenant-scoped-2026-06-15.md`
- `docs/solutions/runbooks/company-brain-premium-plugin-operations-2026-06-13.md`
- `docs/solutions/best-practices/context-engine-adapters-operator-verification-2026-04-29.md`
- `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`
- `docs/solutions/logic-errors/admin-graph-dims-measure-ref-2026-04-20.md`

## Implementation Units

1. U0: Deployment boundary.
2. U1: Hindsight owner-aware banks.
3. U2: GraphQL memory pivot.
4. U3: Settings Memory operator table.
5. U6: Isolation verification and smoke coverage.
6. U4: Product rebrand.
7. U5: Docs and tool copy.
8. U7: Rollout, compatibility, and Linear handoff evidence.

U3 and U6 both depend on U2 and can be sequenced after U2. U4 depends on U3,
U5 depends on U4, and U7 depends on U5 and U6.

## Status Log

### 2026-06-27 - Context discovery

- Read repository, Linear, plan, brainstorm, related issue, related PR, and
  prior solution context.
- No Linear state changes made during discovery.
- Created this status document.

### 2026-06-27 - U0 objective

Make deployment behavior match the product boundary: Hindsight is core memory
infrastructure, while Cognee is optional ThinkWork Brain ontology/graph
infrastructure deployed through the Brain plugin/managed-app path.

- Moved Linear THINK-83 to `In Progress`.
- Posted Linear implementation-start comment.
- Created isolated U0 branch/worktree:
  `codex/think-83-u0-deployment-boundary` at
  `/Users/ericodom/.codex/worktrees/think-83-u0`.
- Implemented U0 deployment-boundary slice:
  - `enable_hindsight` now defaults to true in the composite module,
    greenfield example, CLI init scaffold, and enterprise deploy template.
  - Empty `memory_engine` now documents Hindsight as the full-install default;
    `agentcore` is the explicit low-cost/development opt-out.
  - `memory_engine = "cognee"` remains accepted only as legacy diagnostic
    compatibility and is no longer described as the user/Space memory path.
  - Cognee plugin/managed-app copy now frames Cognee as optional Brain
    ontology/knowledge-graph infrastructure.
  - Hindsight README now describes Hindsight as canonical user/Space memory
    for full installs.
- U0 verification passed:
  - `pnpm --filter thinkwork-cli test -- __tests__/terraform-cognee-fixture.test.ts`
  - `pnpm --filter @thinkwork/plugin-company-brain test -- test/manifest.test.ts`
  - `pnpm --filter @thinkwork/deployment-runner test -- test/deployment-runner-managed-apps.test.ts`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm --filter @thinkwork/plugin-company-brain typecheck`
  - `pnpm --filter @thinkwork/deployment-runner typecheck`
  - `pnpm dlx prettier --check ...` for touched TS/MD files
  - `git diff --check`
  - `terraform fmt -check` for touched Terraform files
- Note: `pnpm install` logged an optional `canvas` native build failure under
  Node 25 because `pkg-config` is unavailable, but exited successfully and the
  focused package tests/typechecks ran afterward.
- Pushed U0 branch to GitHub and opened PR:
  https://github.com/thinkwork-ai/thinkwork/pull/3020
- Kept parent Linear issue in `In Progress` because THINK-83 has multiple
  implementation units and no child/unit Linear issues.
- U0 PR merged:
  https://github.com/thinkwork-ai/thinkwork/pull/3020
- U0 merge commit:
  `d46d878b3887905fb83762e03f5dcaa6f589fc13`
- U0 CI passed before merge: CLA, lint, typecheck, test, verify, and signed
  catalog validation.
- U0 remote branch deleted and local U0 worktree/branch cleaned up.

### 2026-06-27 - U1 objective

Make Hindsight owner-aware for user and Space memory: user reads/writes stay in
`user_<userId>` banks, Space reads/writes use `space_<spaceId>` banks, and
legacy user-bank fan-out remains user-only. This unit covers Hindsight adapter
bank routing and adapter-level tests; GraphQL resolver semantics, operator UI,
and deployed smoke evidence stay in later units.

- Created isolated U1 branch/worktree:
  `codex/think-83-u1-hindsight-banks` at
  `/Users/ericodom/.codex/worktrees/think-83-u1`.
- Implemented U1 owner-aware Hindsight bank routing:
  - User and agent owners keep the existing `user_<ownerId>` compatibility
    path.
  - Space owners use `space_<spaceId>`.
  - Legacy paired user/agent bank fan-out is now user-only, including when a
    Space recall asks for legacy banks.
  - Space retain metadata records `tenantId`, `ownerType: "space"`, and
    `spaceId` rather than implying the Space is a user.
  - Inspect, export, and cursor-list paths normalize Space records as
    `ownerType: "space"` / `ownerId: <spaceId>`.
- U1 verification passed:
  - `pnpm --filter @thinkwork/api test -- src/lib/memory/adapters/hindsight-adapter.bank-id.test.ts src/lib/memory/adapters/hindsight-adapter.test.ts src/lib/memory/hindsight-bank-merge.test.ts src/lib/requester-memory/hindsight-primary.test.ts src/lib/requester-memory/hindsight-sync.test.ts src/__tests__/wiki-compiler.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm dlx prettier --check packages/api/src/lib/memory/adapter.ts packages/api/src/lib/memory/adapters/hindsight-adapter.ts packages/api/src/lib/memory/adapters/hindsight-adapter.bank-id.test.ts packages/api/src/lib/memory/adapters/hindsight-adapter.test.ts docs/plans/autopilot/THINK-83-status.md`
  - `git diff --check`
- U1 PR merged:
  https://github.com/thinkwork-ai/thinkwork/pull/3021
- U1 merge commit:
  `4daa634c18199abbaf63212d0ec8e854e84de3ab`
- U1 CI passed before merge: CLA, lint, typecheck, test, and verify.
- U1 remote branch deleted and local U1 worktree/branch cleaned up.

### 2026-06-27 - U2 objective

Pivot GraphQL memory semantics from Cognee-only to Hindsight-canonical: Space
capture/search should be allowed for active Hindsight when the adapter supports
the required operation, `memorySystemConfig` should report Hindsight-backed user
and Space memory as enabled, and Cognee fields/copy should remain compatibility
diagnostics rather than the canonical memory path.

- Created isolated U2 branch/worktree:
  `codex/think-83-u2-graphql-hindsight` at
  `/Users/ericodom/.codex/worktrees/think-83-u2`.
- Implemented U2 GraphQL memory pivot:
  - Added an internal `spaceMemory` adapter capability.
  - Hindsight and Cognee advertise Space memory support; AgentCore does not.
  - `captureSpaceMemory` and `spaceMemorySearch` now gate on provider-neutral
    capabilities instead of `adapter.kind === "cognee"`.
  - `memorySystemConfig` derives user/Space memory flags from active adapter
    capabilities and reports Hindsight-backed user/Space memory as enabled.
  - GraphQL schema descriptions now frame Cognee as compatibility/diagnostic
    and Hindsight as canonical user/Space memory for this pass.
  - Regenerated AppSync schema and GraphQL codegen for CLI, web, and mobile;
    `packages/api` has no codegen script.
- U2 verification passed:
  - `pnpm schema:build`
  - `pnpm --filter thinkwork-cli codegen`
  - `pnpm --filter @thinkwork/web codegen`
  - `pnpm --filter @thinkwork/mobile codegen`
  - `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/memory/spaceMemory.resolver.test.ts src/graphql/resolvers/memory/memorySystemConfig.query.test.ts src/graphql/resolvers/memory/memorySearch.query.test.ts src/lib/memory/adapters/hindsight-adapter.bank-id.test.ts src/lib/memory/adapters/hindsight-adapter.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter @thinkwork/mobile typecheck` returned no matching script,
    consistent with repo notes.
  - `pnpm dlx prettier --check ...` for authored U2 files
  - `git diff --check`
- U2 PR merged:
  https://github.com/thinkwork-ai/thinkwork/pull/3022
- U2 merge commit:
  `2808378a9c1adf70edef444b3478e34f2c122fde`
- U2 CI passed before merge: CLA, lint, typecheck, test, and verify.
- U2 remote branch deleted and local U2 worktree/branch cleaned up.

### 2026-06-27 - U3 objective

Keep `/settings/memory` as the operator Memory route and fix the table so it
uses an operator-wide Hindsight inspection path instead of the requester-scoped
memory query. Rows should include bank/date/scope/type/content evidence, and
cross-bank destructive actions should stay disabled for this unit.

- Created isolated U3 branch/worktree:
  `codex/think-83-u3-memory-table` at
  `/Users/ericodom/.codex/worktrees/think-83-u3`.
- Implemented U3 Settings Memory operator table:
  - Added explicit `MemoryRecordScope` and operator-only `memoryRecords` scope,
    query, and limit GraphQL arguments.
  - Added `bankId`, `ownerType`, and `ownerId` to `MemoryRecord`.
  - Added a tenant-admin-gated resolver branch for operator memory inspection.
  - Added normalized `inspectTenant` service/adapter contract.
  - Implemented Hindsight tenant inspection across tenant-visible user, Space,
    and legacy agent banks, with optional SQL text/bank/context/type search.
  - Updated `/settings/memory` to query `scope: OPERATOR`, show Created,
    Updated, Bank, Scope, Type, and Memory columns, and use a Hindsight
    operator-empty state.
  - Made the detail sheet show bank/scope metadata and disabled `Forget` for
    operator-wide rows because cross-bank deletion is not safely scoped in this
    unit.
  - Regenerated AppSync schema and GraphQL codegen for CLI, web, and mobile;
    `packages/api` has no codegen script.
- U3 verification passed:
  - `pnpm schema:build`
  - `pnpm --filter thinkwork-cli codegen`
  - `pnpm --filter @thinkwork/web codegen`
  - `pnpm --filter @thinkwork/mobile codegen`
  - `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/memory/memoryRecords.query.test.ts src/lib/memory/adapters/hindsight-adapter.test.ts`
  - `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsMemory.render.test.tsx src/components/settings/SettingsMemory.test.tsx src/components/settings/SettingsMemoryHome.test.tsx`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm --filter @thinkwork/mobile typecheck` returned no matching script,
    consistent with repo notes.
  - `pnpm dlx prettier --check ...` for authored U3 files
  - `git diff --check`
- Browser verification:
  - Copied `apps/web/.env` from the main checkout.
  - Started Vite on `http://127.0.0.1:5180/`.
  - Opening `/settings/memory` redirected to
    `/sign-in?next=%2Fsettings%2Fmemory` in the in-app browser; no authenticated
    session was available in that browser, so live row rendering could not be
    inspected manually in this turn.
  - Added `SettingsMemory.render.test.tsx` with mocked operator-visible
    Hindsight rows to verify the rendered Bank/Scope/Updated columns, row
    content, operator query variables, and read-only detail sheet.

### 2026-06-27 - U6 objective

Add deterministic isolation evidence for the Hindsight-backed user and Space
memory path. The canonical smoke should prove user memory, Space A memory, and
Space B memory remain independently searchable, while the older Cognee cutover
smoke stays available only as a compatibility diagnostic.

- Created isolated U6 branch/worktree:
  `codex/think-83-u6-isolation-smoke` at
  `/Users/ericodom/.codex/worktrees/think-83-u6`.
- Implemented U6 isolation and smoke coverage:
  - Added `hindsight-memory-isolation-smoke.mjs`, dry-run by default and live
    only with `SMOKE_ENABLE_HINDSIGHT_MEMORY_ISOLATION=1`.
  - The new smoke uses the deployed GraphQL API only, captures deterministic
    user/Space A/Space B records, checks same-scope recall, rejects sibling
    scope leakage, and verifies operator inspection through
    `memoryRecords(scope: OPERATOR, query: ...)`.
  - Added optional unauthorized Space-search verification with a separate
    caller token.
  - Relabeled the Cognee memory cutover smoke as a diagnostic compatibility
    check and pointed canonical THINK-83 success evidence at the Hindsight
    isolation smoke.
  - Added API resolver coverage for Space A/B search-result isolation.
  - Added web GraphQL query coverage for the `/settings/memory` operator
    inspection/search variables and extended `MemoryRecord` field coverage.
- U6 verification passed:
  - `node --check plugins/company-brain/smoke/hindsight-memory-isolation-smoke.mjs`
  - `node --check plugins/company-brain/smoke/cognee-memory-cutover-smoke.mjs`
  - `node plugins/company-brain/smoke/hindsight-memory-isolation-smoke.mjs`
  - `node plugins/company-brain/smoke/cognee-memory-cutover-smoke.mjs`
  - `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/memory/spaceMemory.resolver.test.ts src/graphql/resolvers/memory/space-memory-scope.test.ts`
  - `pnpm --filter @thinkwork/web test -- src/lib/graphql-queries.test.ts src/components/settings/SettingsMemory.render.test.tsx src/routes/_authed/_shell/-memory.test.tsx test/memory-layout.test.tsx`
  - `pnpm --filter @thinkwork/plugin-company-brain test`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter @thinkwork/plugin-company-brain typecheck`
  - `pnpm dlx prettier --check ...` for authored U6 files
  - `git diff --check`

### 2026-06-27 - U4 objective

Rebrand customer-facing Brain, Data, and ETL product surfaces while preserving
stable internal plugin keys, routes, package names, and compatibility slugs.
This unit updates display names and Settings/catalog copy only; deeper
docs/tool copy remains U5.

- Created isolated U4 branch/worktree:
  `codex/think-83-u4-product-rebrand` at
  `/Users/ericodom/.codex/worktrees/think-83-u4`.
- Implemented U4 product rebrand:
  - Changed first-party plugin display names to `ThinkWork Brain`,
    `ThinkWork Data Warehouse`, and `ThinkWork ETL`.
  - Updated customer-facing plugin descriptions, install-key prompts, component
    labels, and manifest tests without changing `company-brain`,
    `company-data`, or `company-etl` keys.
  - Regenerated and checked the first-party plugin registry.
  - Updated Settings plugin rows/details, managed-application fallback labels,
    tools copy, and Brain operations copy to use ThinkWork product names.
  - Updated `/settings/memory` status copy so active Hindsight appears as core
    ThinkWork memory, and Cognee/Brain evidence appears as diagnostic graph
    infrastructure rather than the memory provider.
  - Cleaned current non-test web source comments that still referred to Company
    Brain as the product name.
- U4 verification passed:
  - `pnpm --filter @thinkwork/plugin-company-brain test -- test/manifest.test.ts`
  - `pnpm --filter @thinkwork/plugin-company-data test -- test/manifest.test.ts`
  - `pnpm --filter @thinkwork/plugin-company-etl test -- test/manifest.test.ts`
  - `pnpm --filter @thinkwork/plugin-catalog test -- src/__tests__/catalog.test.ts src/__tests__/plugin-registry.test.ts`
  - `pnpm --filter @thinkwork/web test -- src/components/settings/plugins/PluginsPage.test.tsx src/components/settings/plugins/PluginDetail.test.tsx src/components/settings/managed-applications/ManagedApplicationsPage.test.tsx src/components/settings/brain/BrainOperationsPage.test.tsx src/components/settings/SettingsMemory.test.tsx`
  - `pnpm --filter @thinkwork/plugin-catalog check:plugins`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter @thinkwork/plugin-company-brain typecheck`
  - `pnpm --filter @thinkwork/plugin-company-data typecheck`
  - `pnpm --filter @thinkwork/plugin-company-etl typecheck`
  - `pnpm --filter @thinkwork/plugin-catalog typecheck`
  - `pnpm dlx prettier --check ...` for authored U4 files
  - `rg -n 'Company Brain|Company Data|Company ETL|Hindsight legacy|legacy Hindsight' apps/web/src --glob '!**/*.test.*' --glob '!**/gql/**'` returned no matches.
  - `git diff --check`
- U4 PR #3026 initial CI found two missed plugin-catalog order assertions after
  the display-name sort changed. Fixed the expectations and reran:
  - `pnpm --filter @thinkwork/plugin-catalog test`
  - `pnpm --filter @thinkwork/plugin-catalog typecheck`
- U4 PR #3026 rerun CI found one API plugin catalog assertion still expecting
  `Company ETL` for a legacy Data Integrations install. Fixed the compatibility
  test to expect the stable `company-etl` key with `ThinkWork ETL` display
  copy, then reran:
  - `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/plugins/plugins-resolvers.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
- U4 PR merged:
  https://github.com/thinkwork-ai/thinkwork/pull/3026
- U4 merge commit:
  `c69981685d17fd8be666f4d1e7d5289ffdb49901`
- U4 CI passed before merge: CLA, lint, typecheck, test, verify, and signed
  catalog validation.
- U4 remote branch deleted and local U4 worktree/branch cleaned up.

### 2026-06-27 - U5 objective

Align docs, runtime tool descriptions, workspace defaults, and Context Engine
provider labels with the THINK-83 product boundary: Hindsight is canonical user
and Space memory, ThinkWork Brain is the visible Brain product, and Cognee is
mentioned only as optional/internal graph infrastructure or legacy diagnostic
compatibility.

- Created isolated U5 branch/worktree:
  `codex/think-83-u5-docs-tools` at
  `/Users/ericodom/.codex/worktrees/think-83-u5`.
- Implemented U5 docs and tool-copy updates:
  - Updated `mcp-context-engine` and Pi extension tool names/descriptions from
    Company Brain phrasing to ThinkWork Brain and ThinkWork Context Engine
    phrasing.
  - Renamed the compiled wiki Context Engine provider display name to
    `ThinkWork Brain Pages`.
  - Updated Context Engine admin validation, source-agent prompts/tools,
    memory-derived page snippets, workspace defaults, onboarding seed copy, and
    MCP fixture expectations to use ThinkWork Brain product language.
  - Preserved internal plugin keys/routes/packages such as `company-brain`.
  - Updated Memory, Context Engine, Space, Goal, deployment, release-manifest,
    and Knowledge Base docs so `/settings/memory` remains the operator Memory
    route and Hindsight remains user/Space memory authority.
  - Reframed Cognee docs as ThinkWork Brain graph/ontology infrastructure and
    not as the user or Space memory provider.
- U5 verification passed:
  - `pnpm --filter @thinkwork/api test -- src/handlers/mcp-context-engine.requester-context.test.ts src/lib/context-engine/__tests__/service.test.ts src/lib/context-engine/providers/source-agent-runtime.test.ts src/lib/context-engine/__tests__/sub-agent-provider-e2e.test.ts src/lib/__tests__/mcp-configs-plugin-auth.test.ts src/lib/plugins/handlers/mcp.test.ts`
  - `pnpm --filter @thinkwork/pi-extensions test -- test/capabilities.test.ts test/okf-wiki-navigator.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/pi-extensions typecheck`
  - `pnpm --filter @thinkwork/docs build`
  - `pnpm dlx prettier --check ...` for authored U5 files
  - `git diff --check`
- Note: `pnpm install` logged the same optional `canvas` native build failure
  under Node 25 because `pkg-config` is unavailable, but exited successfully and
  the focused package tests/typechecks ran afterward.
