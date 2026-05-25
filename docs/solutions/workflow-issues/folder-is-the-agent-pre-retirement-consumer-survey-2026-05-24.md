---
title: "Folder-is-the-agent legacy root-file consumer survey"
date: 2026-05-24
category: workflow-issues
module: "workspace-defaults, workspace-renderer, agent runtimes"
problem_type: destructive_work_survey
component: development_workflow
severity: high
applies_when:
  - "Retiring SOUL.md, IDENTITY.md, PLATFORM.md, or CAPABILITIES.md from tenant workspace roots"
  - "Changing the system-prompt file order for Pi or Strands runtimes"
  - "Collapsing workspace-defaults canonical file surfaces into AGENTS.md sections"
tags:
  - folder-is-the-agent
  - destructive-survey
  - workspace-defaults
  - system-prompt
  - migration
---

# Folder-Is-The-Agent Legacy Root-File Consumer Survey

## Scope

Survey command run from `codex/folder-agent-preflight` on 2026-05-24:

```bash
rg -n "SOUL\.md|IDENTITY\.md|PLATFORM\.md|CAPABILITIES\.md" .
```

The referenced implementation plan itself is excluded from the counts below so the survey describes consumers rather than restating the work order. The search found references in 89 files. Buckets with no matches: `apps/admin`, `apps/cli`, `packages/skill-catalog`, and `terraform`.

## Breakage Answer

If `SOUL.md` is deleted from a tenant tree today, the Pi and Strands default prompt builders still try to read it, but they tolerate missing files and continue. The louder breakage is in editor and personalization paths: mobile Personalize tries to get and put `SOUL.md`; API workspace-file tests and migration tests still expect it to be a live file; Strands workspace composer tests still materialize it. Removing it from `workspace-defaults` today also breaks the parity test and `loadDefaults()` callers that expect canonical keys to include `SOUL.md`.

If `IDENTITY.md` is deleted today, several live write paths break or degrade: `identity-md-writer.ts`, `workspace-files.ts` `update-identity-field`, `backfill-identity-md.ts`, Strands `update_agent_name` / `update_identity`, and mobile personalization/profile screens all assume it exists or can be fetched. Deleting it before a migration leaves agent renames and personality-field edits without their current target file.

If `PLATFORM.md` or `CAPABILITIES.md` are deleted today, pinned-version initialization, governance-audit classification, workspace-defaults parity, and computer-runtime prompt composition still reference them. Pi has already stopped loading `CAPABILITIES.md`, but Strands and Pi still load `PLATFORM.md` in the default prompt path.

## By Package

### `packages/workspace-defaults`

Files:

- `packages/workspace-defaults/files/IDENTITY.md`
- `packages/workspace-defaults/files/SOUL.md`
- `packages/workspace-defaults/src/__tests__/parity.test.ts`
- `packages/workspace-defaults/src/index.ts`

Classification:

- Default-template seeds and TS string-constant mirrors for `SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, and `CAPABILITIES.md`.
- `PINNED_FILES` still includes `PLATFORM.md` and `CAPABILITIES.md`.
- Parity tests assert the `.md` files and inline constants match.

Breakage if removed now:

- `loadDefaults()` no longer returns expected canonical keys.
- Parity tests fail if any file is deleted without matching TS constant and test updates.
- Fresh tenant defaults and `_catalog/defaults/workspace/` reseeding still expect the four files until U3/U4/U5 land.

### `packages/api`

Files:

- `packages/api/scripts/migrate-collapse-agents.test.ts`
- `packages/api/src/__smoke__/fat-folder-smoke.ts`
- `packages/api/src/__tests__/agent-snapshot-overlay.test.ts`
- `packages/api/src/__tests__/backfill-router-skills.test.ts`
- `packages/api/src/__tests__/identity-md-writer.test.ts`
- `packages/api/src/__tests__/pinned-versions.test.ts`
- `packages/api/src/__tests__/workspace-bootstrap.test.ts`
- `packages/api/src/__tests__/workspace-event-key-parser.test.ts`
- `packages/api/src/__tests__/workspace-files-handler.test.ts`
- `packages/api/src/graphql/resolvers/observability/turnInvocationLogs.query.ts`
- `packages/api/src/handlers/backfill-identity-md.ts`
- `packages/api/src/handlers/chat-agent-invoke.ts`
- `packages/api/src/lib/compliance/event-schemas.ts`
- `packages/api/src/lib/folder-bundle-importer.ts`
- `packages/api/src/lib/identity-md-writer.ts`
- `packages/api/src/lib/pinned-versions.ts`
- `packages/api/src/lib/workspace-copy.ts`
- `packages/api/src/lib/workspace-renderer/compose-tuple.test.ts`
- `packages/api/workspace-files.ts`

Classification:

- Live write paths: `identity-md-writer.ts`, `workspace-files.ts` identity-field updates, and `backfill-identity-md.ts`.
- Pinning/governance paths: `pinned-versions.ts`, `GOVERNANCE_FILE_BASENAMES`, compliance event schema comments/tests.
- Import/bootstrap/migration tests: folder bundle import rules, workspace bootstrap expectations, collapse-agent S3 move examples.
- Observability comments and smoke/test fixtures.

Breakage if removed now:

- Agent rename and personality-field update flows still target `IDENTITY.md`.
- Pinned-version initialization still treats `PLATFORM.md` and `CAPABILITIES.md` as pinned guardrail-class files.
- Governance audit still emits for `PLATFORM.md` and `CAPABILITIES.md`.
- Bootstrap and workspace-files tests fail until expectations move to the AGENTS.md-section canon.

### `packages/agentcore-pi`

Files:

- `packages/agentcore-pi/agent-container/src/runtime/system-prompt.ts`
- `packages/agentcore-pi/agent-container/tests/bootstrap-workspace.test.ts`
- `packages/agentcore-pi/agent-container/tests/system-prompt.test.ts`

Classification:

- Runtime read: `PROMPT_FILES` loads `SOUL.md`, `IDENTITY.md`, and `PLATFORM.md`.
- Tests assert the current order and the already-retired `CAPABILITIES.md` behavior.

Breakage if removed now:

- Missing files are skipped by the file reader, so prompt construction survives, but the model loses personality/identity/platform content until AGENTS.md contains the absorbed sections.
- Tests fail until the pinned order becomes `AGENTS.md`, `CONTEXT.md`, `GUARDRAILS.md`, `SPACE.md`, `USER.md`.

### `packages/agentcore-strands`

Files:

- `packages/agentcore-strands/agent-container/container-sources/server.py`
- `packages/agentcore-strands/agent-container/container-sources/update_agent_name_tool.py`
- `packages/agentcore-strands/agent-container/container-sources/update_identity_tool.py`
- `packages/agentcore-strands/agent-container/test_bootstrap_workspace.py`
- `packages/agentcore-strands/agent-container/test_knowledge_pack_loader.py`
- `packages/agentcore-strands/agent-container/test_workspace_composer_fetch.py`

Classification:

- Runtime read: `_build_system_prompt` loads `SOUL.md`, `IDENTITY.md`, and container-bundled `PLATFORM.md`.
- Tool surface: update-name and update-identity docs describe `IDENTITY.md` as the persisted target.
- Workspace composer tests expect `SOUL.md` and `IDENTITY.md` materialization/fetch behavior.

Breakage if removed now:

- Default prompt construction tolerates missing workspace files, but identity/personality/platform instructions disappear unless U3/U21 already populated AGENTS.md.
- Name and identity tools still present `IDENTITY.md` as the backing file, so deleting it without a replacement write model leaves user-facing tool copy wrong and API calls failing.

### `packages/agentcore`

Files:

- `packages/agentcore/agent-container/test_context_parser.py`
- `packages/agentcore/agent-container/test_router_parser.py`

Classification:

- Test-only fixtures for profile-aware loading and router parsing. These hard-code `SOUL.md` and `IDENTITY.md` in profile `load` / `skip` examples.

Breakage if removed now:

- Runtime impact is indirect, but U16 must sweep `profile.load` handling because these tests show retired filenames may still appear in profile declarations.

### `packages/computer-runtime`

Files:

- `packages/computer-runtime/src/computer-chat.test.ts`
- `packages/computer-runtime/src/workspace.ts`
- `packages/computer-runtime/test/workspace.test.ts`

Classification:

- Runtime read: `PROMPT_WORKSPACE_FILES` loads all four legacy root files.
- Tests assert `IDENTITY.md` appears in computer prompt composition.

Breakage if removed now:

- Computer-runtime prompt construction skips missing files only if the reader returns null; the configured prompt-file list still names the retired files and tests fail until this runtime is either updated or formally scoped out of the rollout.

### `apps/mobile`

Files:

- `apps/mobile/app/agents/[id]/personalize.tsx`
- `apps/mobile/app/agents/[id]/profile.tsx`

Classification:

- Live client behavior: Personalize fetches and writes `SOUL.md`, `IDENTITY.md`, and `USER.md`.
- Profile labels describe `SOUL.md` and `IDENTITY.md`.

Breakage if removed now:

- Mobile Personalize loads empty content or errors for missing `SOUL.md`/`IDENTITY.md`; saves recreate the retired files unless this screen is retired or rewritten.
- This is the largest live consumer outside the plan's stated "no mobile changes" boundary and must be resolved before final deletion in U24.

### `packages/lambda`

Files:

- `packages/lambda/github-workspace.ts`

Classification:

- Comment/example only: path example includes `SOUL.md`.

Breakage if removed now:

- None.

### `packages/database-pg`

Files:

- `packages/database-pg/drizzle/0018_agent_workspace_overlay.sql`
- `packages/database-pg/src/schema/agents.ts`

Classification:

- Schema comments only. `agents.pinned_versions` documents guardrail-class files as `GUARDRAILS.md`, `PLATFORM.md`, and `CAPABILITIES.md`.

Breakage if removed now:

- None at runtime, but comments become stale when U4 collapses pinning to `GUARDRAILS.md`.

### `packages/agent-tools`

Files:

- `packages/agent-tools/eval/prompts/PROGRAM.md`

Classification:

- Evaluation prompt guidance references strengthening `SOUL.md`.

Breakage if removed now:

- None for application runtime; eval guidance becomes stale after the AGENTS.md consolidation.

### `seeds`

Files:

- `seeds/eval-test-cases/red-team-skill-workspace.json`

Classification:

- Red-team eval cases ask the model to modify `PLATFORM.md` and `CAPABILITIES.md`.

Breakage if removed now:

- Eval cases remain useful as historical safety tests, but the target filenames must be updated once platform behavior/capability content lives inside AGENTS.md sections.

### `docs`

Files:

- `docs/src/content/docs/applications/admin/agent-templates.mdx`
- `docs/src/content/docs/concepts/agents/workspace-overlay.mdx`
- `docs/src/content/docs/agent-design/folder-is-the-agent.mdx`
- `docs/src/content/docs/agent-design/authoring-templates.mdx`
- `docs/src/content/docs/agent-design/import-fog-fita.mdx`
- Prior brainstorms and plans listed by the survey command output.
- `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`
- `docs/solutions/build-errors/dockerfile-explicit-copy-list-drops-new-tool-modules-2026-04-22.md`

Classification:

- Public docs still teach the legacy file canon and pinned-file set.
- Historical plans/brainstorms record prior decisions and should not all be rewritten, but superseded in-flight docs need visible callouts.
- Solution docs are historical learning artifacts and can keep old names when they describe incidents.

Breakage if removed now:

- No code breaks, but operator documentation becomes wrong unless the active docs site pages are updated by the cleanup phase or a docs follow-up.

## Required Follow-Up Before Deletion

- U3 must absorb the four legacy files into `AGENTS.md` while keeping the old defaults for one deploy cycle.
- U4 must collapse `PINNED_FILES` and `GOVERNANCE_FILE_BASENAMES`.
- U5 must stop new bootstraps from seeding the four retired files.
- U15/U16 must cut over Pi and Strands prompt loaders after migration.
- U24 must not delete the legacy defaults until mobile Personalize/Profile and computer-runtime consumers are either updated, retired, or explicitly scoped out with tests proving absence is harmless.
