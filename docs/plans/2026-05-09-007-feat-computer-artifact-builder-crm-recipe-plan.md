---
title: "feat: Computer Artifact Builder CRM dashboard recipe"
type: feat
status: complete
date: 2026-05-09
origin: docs/brainstorms/2026-05-09-computer-applets-reframe-requirements.md
related:
  - docs/plans/2026-05-09-001-feat-computer-applets-reframe-plan.md
  - docs/specs/computer-applet-contract-v1.md
---

# feat: Computer Artifact Builder CRM dashboard recipe

## Summary

Make the existing `artifact-builder` workspace skill reliable for the first
data-backed applet recipe: a simple CRM dashboard generated from available CRM
opportunity data. The skill remains the workflow owner. Connectors, Company
Brain, Hindsight, web, and future CRM MCP tools remain data sources; they do
not own the product workflow.

The implementation adds a CRM dashboard recipe/reference to the
`artifact-builder` skill, defines the canonical CRM dashboard data shape the
agent should normalize into, propagates the recipe to existing Computer
workspaces without overwriting user edits, and adds deterministic plus live
smoke coverage that proves a CRM dashboard prompt produces a saved
`applet` artifact with `refresh()` and a `/artifacts/{appId}` route.

## Problem Frame

PR #1072 moved applet generation into a default workspace Agent Skill at
`skills/artifact-builder/SKILL.md`. PR #1074 fixed a runtime gap where
Computer-only runtimes could miss the direct `save_app` tool and hardened the
Computer contract so the model must not claim an applet was saved unless a
direct `save_app` call returns `ok=true` and `persisted=true`.

That gives Computer the right substrate, but not yet a repeatable dashboard
workflow. Today the skill says "build an applet" and names the LastMile CRM
prompt, but it does not give the model a canonical CRM data shape, a source
normalization recipe, or a concrete dashboard assembly path. The exact
LastMile E2E failure also showed a second practical issue: a defaults-only
change does not guarantee existing Computers receive the new skill content,
because workspace defaults update tenant catalog defaults, not existing
workspace overrides.

This plan turns Artifact Builder from a generic instruction into a usable CRM
dashboard recipe while keeping the broader plugins/skills marketplace out of
scope.

## Requirements Trace

- R1. Artifact Builder owns the app-generation workflow for CRM dashboard
  prompts; connector/plugin tools only supply source data.
- R2. A simple CRM dashboard prompt normalizes available data into one
  canonical `CrmDashboardData` shape before rendering.
- R3. The generated applet includes at least header/source status, KPI strip,
  stage exposure, stale activity, top risks, evidence/source coverage, and
  empty/partial-source states.
- R4. The applet source uses `@thinkwork/computer-stdlib` and `@thinkwork/ui`,
  exports a default React component, and exports deterministic `refresh()`.
- R5. The agent calls the direct `save_app` tool itself. Delegated agents may
  help with analysis or source normalization, but they must not be used as the
  saving step.
- R6. The persisted artifact is an `applet` linked to the originating Computer
  thread and is reachable at `/artifacts/{appId}`.
- R7. Existing Computers receive the missing Artifact Builder recipe files
  without overwriting user-edited `SKILL.md` content.
- R8. Tests and smokes cover both deterministic applet pipeline behavior and a
  live CRM-dashboard prompt path.

## Scope

Included:

- `artifact-builder` skill content and references.
- Canonical CRM dashboard data-shape documentation.
- Workspace defaults versioning and parity coverage.
- Existing-Computer recipe propagation for missing Artifact Builder files.
- Runtime/API guardrails that detect build-style prompts without direct
  successful `save_app` evidence.
- Focused deployed smoke tooling for a simple CRM dashboard prompt.

Excluded:

- A broad plugin marketplace.
- User-facing skill editor UI.
- New connector OAuth flows.
- A CRM-specific committed renderer in `apps/computer`.
- Reintroducing the deleted CRM dashboard manifest/orchestrator path.
- Manual production data mutations or manual deploys outside the normal merge
  pipeline.

## Context & Existing Patterns

- `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md` is the
  current skill source.
- `packages/workspace-defaults/src/index.ts` mirrors default files inline and
  requires `DEFAULTS_VERSION` bumps for content changes.
- `packages/workspace-defaults/src/__tests__/parity.test.ts` enforces
  byte-for-byte parity between file sources and inline constants.
- `packages/computer-stdlib/src/index.ts` already exports dashboard primitives
  such as `AppHeader`, `KpiStrip`, `BarChart`, `StackedBarChart`,
  `DataTable`, `SourceStatusList`, `EvidenceList`, and `RefreshBar`.
- `apps/computer/src/test/fixtures/crm-pipeline-risk-applet/source.tsx` is the
  canonical migrated CRM applet fixture and demonstrates the shape this recipe
  should make generatable.
- `scripts/smoke/computer-applet-pipeline-smoke.mjs` already verifies applet
  save/load/open/refresh/state behavior and seeds the canonical CRM fixture.
- `packages/agentcore-strands/agent-container/container-sources/applet_tool.py`
  owns the direct `save_app`, `load_app`, and `list_apps` tools.
- `packages/agentcore-strands/agent-container/container-sources/server.py`
  injects the Computer thread contract that activates Artifact Builder for
  build/create/generate dashboard prompts.
- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md`
  says editable skills must load from copied workspace files.
- `packages/workspace-defaults/src/index.ts` explicitly notes that defaults
  version bumps do not update existing agent overrides. The implementation
  must handle existing Computers separately.
- `docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md`
  keeps platform-owned tools separate from editable workspace skills. This
  plan follows that boundary: `save_app` is a direct tool; Artifact Builder is
  editable skill instructions.

## Key Decisions

- **Skill recipe, not platform plugin.** CRM dashboard generation belongs in
  `artifact-builder` as editable workspace instructions. CRM connectors and
  Company Brain remain data sources.
- **Reference file under the skill.** The main `SKILL.md` stays compact and
  points to `references/crm-dashboard.md` for the longer recipe. This matches
  Agent Skill progressive disclosure: metadata and short instructions load
  first, detailed references load only when the CRM dashboard recipe is needed.
- **Canonical data shape first.** The recipe tells the model to normalize
  source results into `CrmDashboardData` before writing TSX. This prevents the
  model from inventing a new schema every prompt.
- **Existing Computers get missing files only.** A defaults version bump helps
  future defaults/catalog copies, but existing workspaces must receive missing
  `skills/artifact-builder/references/crm-dashboard.md`. Do not overwrite an
  edited `SKILL.md`; only create absent files or absent reference directories.
- **Guard the save invariant after the turn.** Prompt wording helps, but the
  runtime/API should also detect build-style prompts that end without direct
  successful `save_app` evidence. The safe behavior is to surface an honest
  save failure rather than persist a final answer claiming an applet exists.
- **Live prompt smoke is post-deploy, not a flaky unit test.** Unit tests pin
  deterministic logic; the live E2E remains a smoke script run after deploy
  because it depends on AgentCore runtime, workspace propagation, and model
  behavior.

## Implementation Units

### U1. Add CRM dashboard recipe to Artifact Builder

**Goal:** Give Artifact Builder a concrete CRM dashboard workflow and canonical
data shape.

**Files:**

- `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md`
- `packages/workspace-defaults/files/skills/artifact-builder/references/crm-dashboard.md`
- `packages/workspace-defaults/src/index.ts`
- `packages/workspace-defaults/src/__tests__/parity.test.ts`
- `packages/workspace-defaults/src/__tests__/artifact-builder.test.ts` (new,
  if a focused text contract test is clearer than adding assertions to parity)

**Approach:**

- Add `references/crm-dashboard.md` with:
  - when to use the CRM recipe,
  - source discovery order (`query_context`, CRM/MCP/search-safe tools,
    Hindsight/workspace context, then fixture/demo fallback),
  - `CrmDashboardData` TypeScript shape,
  - required views: KPIs, stage exposure, stale activity, top risks, source
    coverage, evidence,
  - empty/partial/failure-state rules,
  - `refresh()` return shape,
  - explicit `save_app` success requirement.
- Update `SKILL.md` to say CRM/dashboard prompts must load and follow
  `references/crm-dashboard.md`.
- Add the new reference file to `CANONICAL_FILE_NAMES`, `CONTENT`, and
  `AUTHORITATIVE_SOURCES`.
- Bump `DEFAULTS_VERSION`.
- Keep `SKILL.md` under 500 lines; put details in the reference file.

**Test Scenarios:**

- `pnpm --filter @thinkwork/workspace-defaults test` confirms default-file
  parity.
- Text contract test confirms:
  - `SKILL.md` references `references/crm-dashboard.md`,
  - `crm-dashboard.md` defines `CrmDashboardData`,
  - the recipe names `save_app`, `refresh()`, `stageExposure`,
    `staleActivity`, `topRisks`, and `sourceStatuses`.

### U2. Propagate Artifact Builder recipe files to existing Computers

**Goal:** Ensure the recipe reaches existing Computer workspaces without
overwriting user-edited skills.

**Files:**

- `packages/api/src/lib/computers/workspace-seed.ts`
- `packages/api/src/lib/computers/artifact-builder-defaults.ts` (new)
- `packages/api/src/lib/computers/__tests__/artifact-builder-defaults.test.ts`
  (new)
- `packages/api/src/lib/computers/runtime-control.ts` or the narrowest existing
  Computer bootstrap/cutover seam that already runs before a Computer task.

**Approach:**

- Add an idempotent helper that checks the current Computer workspace for:
  - `skills/artifact-builder/SKILL.md`,
  - `skills/artifact-builder/references/crm-dashboard.md`.
- If `SKILL.md` is missing, write the default `SKILL.md`.
- If `SKILL.md` exists, do not overwrite it.
- If the CRM reference is missing, write only
  `references/crm-dashboard.md`.
- Reuse `loadDefaults()` content rather than duplicating strings.
- Invoke the helper in the normal Computer workspace preparation path so it
  runs through the merge/deploy pipeline and affects dev after deployment.
- Record in logs whether files were written, already present, or skipped due
  to missing workspace config.

**Test Scenarios:**

- Existing workspace with no Artifact Builder skill gets both files.
- Existing workspace with edited `SKILL.md` but missing reference gets only the
  reference file.
- Existing workspace with both files is a no-op.
- Built-in tool workspace paths remain filtered; this helper never materializes
  platform tools as workspace skills.
- Errors from S3/workspace writes surface as task-preparation errors, not
  silent best-effort warnings.

### U3. Enforce the direct `save_app` invariant for build-style prompts

**Goal:** Prevent the exact failure mode where the assistant says a dashboard
was saved but no applet artifact exists.

**Files:**

- `packages/agentcore-strands/agent-container/container-sources/server.py`
- `packages/agentcore-strands/agent-container/test_server_chunk_streaming.py`
- `packages/api/src/lib/computers/runtime-api.ts`
- `packages/api/src/lib/computers/runtime-api.test.ts`

**Approach:**

- Add a small build-intent classifier for Computer turns. It should match
  prompts containing action words such as build/create/generate/make plus
  artifact nouns such as applet/dashboard/report/briefing/interactive surface.
- In the Strands runtime usage summary, preserve enough direct tool evidence
  for `save_app` calls to identify:
  - tool name `save_app`,
  - status success,
  - returned payload with `ok=true` and `persisted=true`,
  - returned `appId`.
- In `recordThreadTurnResponse` handling, after linking orphan applets to the
  assistant message, return the count and IDs of linked applets.
- If the prompt is build-style and no direct successful `save_app` evidence or
  linked applet exists, do not persist an assistant answer that claims success.
  Persist a concise failure message such as: "I generated a dashboard draft but
  could not save it as an Artifact. Please retry; no applet was created." Mark
  the task output with a structured `artifactSaveMissing` diagnostic.
- Do not add open-ended automatic retries in this unit. A retry loop can come
  later if diagnostics show the model still misses the save call after the
  recipe lands.

**Test Scenarios:**

- Build-style prompt + `save_app` success + linked applet persists normal
  assistant answer and returns artifact IDs.
- Build-style prompt + prose answer + no applet persists the honest failure
  message and marks output diagnostics.
- Non-build prompt with no applet is unaffected.
- Delegated text that mentions `save_app` does not count as direct tool
  evidence.
- Linker still attaches applets created during the current turn by tenant,
  thread, and time window.

### U4. Add a CRM dashboard prompt smoke

**Goal:** Provide the acceptance proof that a simple CRM dashboard prompt
creates a new saved applet.

**Files:**

- `scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs` (new)
- `scripts/smoke-computer.sh`
- `apps/computer/README.md`
- `docs/plans/2026-05-09-001-feat-computer-applets-reframe-autopilot-status.md`
  (progress note when executing the implementation)

**Approach:**

- Add a deployed-stage smoke that:
  - resolves the same Computer identity pattern used by existing smoke scripts,
  - creates a fresh Computer thread,
  - sends: `Build a simple CRM pipeline dashboard from the available CRM data.`,
  - waits for the Computer task to complete,
  - asserts at least one new `artifacts.type = 'applet'` row exists for that
    thread,
  - loads `applet(appId)` through GraphQL,
  - asserts source includes `export default`, `refresh`, CRM dashboard terms,
    and `@thinkwork/computer-stdlib`,
  - opens `/artifacts/{appId}` and verifies the Computer SPA shell returns
    HTTP 200.
- Gate this smoke behind an explicit env flag at first, for example
  `SMOKE_ENABLE_AGENT_APPLET_PROMPT=1`, so ordinary CI remains deterministic
  until the runtime/model path proves stable.
- Keep the existing deterministic applet pipeline smoke as the required CI
  gate.

**Test Scenarios:**

- `node --check scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`.
- Local dry-run/mock mode verifies SQL/GraphQL parsing branches without
  invoking AgentCore.
- With `SMOKE_ENABLE_AGENT_APPLET_PROMPT=1`, deployed smoke creates a fresh
  thread and saved applet.
- Failure path prints thread ID, task ID, task status/error, last assistant
  preview, and recent applet rows for debugging.

### U5. Run and record the post-deploy LastMile acceptance E2E

**Goal:** Prove the original product prompt now creates a usable artifact after
the recipe and runtime guardrails deploy.

**Files:**

- No code required if U4 smoke is general enough.
- `docs/plans/2026-05-09-001-feat-computer-applets-reframe-autopilot-status.md`
  (record run ID, thread ID, applet ID, route, and any failures).

**Approach:**

- After the PR containing U1-U4 merges and the main deploy is green, rerun:
  `Build a CRM pipeline risk dashboard for LastMile opportunities, including
stale activity, stage exposure, and the top risks to review.`
- Use the U4 smoke script where possible, with the exact prompt as an override.
- Confirm:
  - a brand-new applet row is linked to the new thread,
  - source has `refresh()`,
  - route opens at `/artifacts/{appId}`,
  - the applet shows source coverage honestly when CRM/email/calendar/web data
    is missing or partial.

**Test Scenarios:**

- Acceptance pass: exact prompt creates a linked applet and opens in Computer.
- Source-gap pass: if live CRM data is unavailable, applet still exists and
  shows partial/missing source status.
- Failure pass: if save fails, assistant does not claim success and status doc
  records the blocker.

## Sequencing

1. U1 first, because it defines the recipe and default-file shape.
2. U2 next, because the recipe must reach existing Computers before live prompt
   E2E can prove anything.
3. U3 then closes the runtime correctness gap so failure states are honest.
4. U4 adds focused verification and can use the U1-U3 behavior.
5. U5 is the post-deploy acceptance run, not a separate code PR unless it
   exposes a new bug.

U1 and U2 can be one PR if the diff remains small. U3 should be separate if the
runtime/API guard becomes more than a small diagnostic addition. U4 can travel
with U3 if the smoke script depends on the returned diagnostics.

## Verification Plan

Focused local checks:

- `pnpm --filter @thinkwork/workspace-defaults test`
- `pnpm --filter @thinkwork/workspace-defaults typecheck`
- `pnpm --filter @thinkwork/api test -- src/lib/computers/runtime-api.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `uv run pytest packages/agentcore-strands/agent-container/test_server_chunk_streaming.py packages/agentcore-strands/agent-container/test_applet_tool.py`
- `node --check scripts/smoke/computer-crm-dashboard-prompt-smoke.mjs`
- `bash -n scripts/smoke-computer.sh`
- `git diff --check`

Broader/pre-PR checks:

- `pnpm lint`
- `pnpm -r --if-present typecheck`
- `pnpm -r --if-present test`

Post-merge/deploy checks:

- main deploy workflow green.
- `scripts/smoke-computer.sh --stage dev --region us-east-1` green.
- `SMOKE_ENABLE_AGENT_APPLET_PROMPT=1` CRM prompt smoke green.
- Exact LastMile E2E prompt creates a new linked applet.

## Risks & Mitigations

- **Existing Computers do not receive the recipe.** Mitigated by U2
  missing-file propagation. Defaults version alone is insufficient.
- **Model still delegates saving.** Mitigated by U3 direct `save_app` evidence
  guard and honest failure output.
- **Live CRM data is unavailable.** The recipe requires source coverage and
  partial states; missing live data should not block applet creation.
- **Smoke flakiness from live LLM/AgentCore.** The live prompt smoke starts
  behind an env flag; deterministic applet pipeline smoke remains the required
  CI gate until stability is proven.
- **Skill reference grows too large.** Keep the main `SKILL.md` small and move
  CRM-specific detail to `references/crm-dashboard.md`.
- **User-edited skill content is overwritten.** U2 only writes missing files.
  It does not overwrite existing `SKILL.md`.

## Open Questions

- Should U3 fail the task status when a build-style prompt misses `save_app`,
  or should it mark the task completed with an honest assistant failure
  message? Default recommendation: completed with diagnostic output, because
  the user got a response and can retry.
- Should the live CRM prompt smoke become a required deploy gate after several
  green runs? Default recommendation: keep optional initially, then promote it
  once it has passed repeatedly without runtime flake.
