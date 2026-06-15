---
title: "refactor: Co-locate application plugin source"
type: refactor
status: active
date: 2026-06-15
origin: docs/brainstorms/2026-06-15-plugin-source-colocation-requirements.md
linear: THNK-31
---

# refactor: Co-locate application plugin source

## Overview

Move ThinkWork Application Plugin source into root-level
`plugins/<plugin-key>/` packages so each plugin is understandable, reviewable,
testable, and eventually submission-shaped from one directory. Shared packages
should keep only generic plugin infrastructure.

This plan is intentionally migration-oriented. Compatibility wrappers and
allowlists may exist while plugins move one at a time, but each wrapper must
have a clear removal path.

---

## Requirements Trace

- R1-R3: Root `plugins/` boundary, one folder per plugin, and all
  plugin-specific source co-located.
- R4-R5: Shared packages stay generic and avoid hidden vendor/plugin-specific
  behavior.
- R6-R9: Each plugin has README/package contract; submissions are reviewable as
  one folder; shared-engine changes are explicit.
- R10-R13: Migrate Plane, Twenty, LastMile, and Company Brain/Cognee without
  changing current product behavior.
- R14-R16: Add tooling/enforcement to list, validate, build, test, document, and
  protect plugins from their folder source of truth.

---

## Scope Boundaries

- Do not change product install, activation, deployment, or dispatch behavior as
  part of source relocation.
- Do not remove legacy compatibility paths until every first-party plugin has
  migrated and the release path has completed a pass.
- Do not move generic platform infrastructure into plugin folders.
- Do not manually deploy or run production mutation commands.

---

## Implementation Units

### U1. Define Plugin Package Contract and Workspace Boundary

**Goal:** Add `plugins/*` to the workspace and define the package descriptor
contract that first-party plugin packages implement.

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `packages/plugin-catalog/package.json`
- Create: `packages/plugin-catalog/src/plugin-package.ts`
- Create: `plugins/plane/package.json`
- Create: `plugins/plane/tsconfig.json`
- Create: `plugins/plane/README.md`

**Approach:** Keep the descriptor small: `packageKey`, `sourceRoot`, and a
catalog manifest. Validate package key/source-root/manifest consistency at the
catalog boundary so plugin packages can remain submission-shaped and largely
standalone.

**Tests:** `packages/plugin-catalog/src/__tests__/plugin-package.test.ts`
covers successful package registration and key/source-root mismatch failures.

### U2. Teach Catalog Loaders to Consume Plugin Packages

**Goal:** Move catalog registration away from plugin-catalog-owned Plane source
and toward root plugin packages, with a temporary legacy migration list for
unmigrated plugins.

**Files:**

- Modify: `packages/plugin-catalog/src/plugins/index.ts`
- Modify: `packages/plugin-catalog/src/index.ts`
- Create: `packages/plugin-catalog/src/plugins/plane/manifest.ts`
- Modify/Create: `plugins/plane/src/index.ts`
- Move: `packages/plugin-catalog/src/plugins/plane/manifest.ts` ->
  `plugins/plane/src/manifest.ts`

**Approach:** Register `planePluginPackage` through
`defineFirstPartyPluginPackage`, expose `planeManifest` as a validated
compatibility export, and sort the aggregate manifest list by plugin key so the
signed catalog remains deterministic while package-vs-legacy ordering changes.

**Tests:** Existing catalog, build-catalog, contracts, and Plane manifest tests
must continue passing.

### U3. Migrate Plane as the Full-Shape Proof Plugin

**Goal:** Move the rest of Plane-specific source behind `plugins/plane/` while
preserving install, deployment, MCP activation, smoke, and API parity behavior.

**Files:**

- Move/link from: `packages/deployment-runner/src/apps/plane.ts`
- Move/link from: `scripts/smoke/*plane*`
- Move/link from: Plane-specific API parity tests under
  `packages/api/src/lib/plugins/`
- Move/link from: Plane operations docs and release notes as applicable
- Modify: package README to link all retained legacy surfaces until moved

**Tests:** Deployment-runner Plane adapter tests, API Plane manifest parity
tests, plugin-catalog Plane tests, and smoke contract tests.

### U4. Migrate Twenty and Company Brain/Cognee Infrastructure Plugins

**Goal:** Create `plugins/twenty/` and `plugins/company-brain/` packages and
move their plugin-specific manifests, infrastructure contracts, docs, and parity
tests without changing behavior.

**Files:**

- Move/link from: `packages/plugin-catalog/src/plugins/twenty/manifest.ts`
- Move/link from: `packages/plugin-catalog/src/plugins/company-brain/manifest.ts`
- Move/link from: `packages/deployment-runner/src/apps/twenty.ts`
- Move/link from: `packages/deployment-runner/src/apps/cognee.ts`
- Modify: README/package contracts for both plugins

**Tests:** Existing Twenty and Company Brain catalog/API/deployment parity tests.

### U5. Migrate LastMile and Skill/MCP-Only Plugin Content

**Goal:** Create `plugins/lastmile/` and move LastMile manifest, discovery
fixture, bundled skills, OAuth endpoint notes, and tests.

**Files:**

- Move/link from: `packages/plugin-catalog/src/plugins/lastmile/manifest.ts`
- Move/link from: `packages/plugin-catalog/src/plugins/lastmile/discovery.fixture.ts`
- Modify: LastMile README/package contract

**Tests:** LastMile discovery and catalog contract tests.

### U6. Refactor API, Web, and Smoke Extension Points to Stay Generic

**Goal:** Make shared API, web, deployment, and smoke loaders consume generic
plugin extension contracts rather than plugin-specific imports.

**Files:**

- Modify: `packages/api/src/lib/plugins/**`
- Modify: `packages/deployment-runner/src/apps/registry.ts`
- Modify: `apps/web/src/components/settings/plugins/**`
- Modify: `scripts/smoke/**`

**Tests:** Relevant API plugin handler tests, deployment-runner tests, web plugin
settings tests, and smoke contract tests.

### U7. Update Authoring Docs and Plugin Builder Workflow

**Goal:** Make docs and `.agents/skills/thinkwork-plugin-builder` produce and
validate complete `plugins/<plugin-key>/` packages.

**Files:**

- Modify: `.agents/skills/thinkwork-plugin-builder/SKILL.md`
- Modify: `.agents/skills/thinkwork-plugin-builder/assets/**`
- Modify: `.agents/skills/thinkwork-plugin-builder/references/**`
- Modify: `docs/**` plugin authoring docs

**Tests:** Existing plugin-builder skill tests plus a fixture scan that asserts
the generated output lands under `plugins/<plugin-key>/`.

### U8. Add Repository Enforcement and Migration Allowlist Entries

**Goal:** Fail repository checks when plugin-specific source is added outside
the owning plugin folder, except for explicit shared-platform or migration
allowlist paths.

**Files:**

- Create/modify: repository lint script under `scripts/`
- Create/modify: CI/pre-commit wiring as appropriate
- Create: migration allowlist file documenting temporary legacy paths

**Tests:** Script tests covering allowed shared paths, allowed migration paths,
and rejected misplaced plugin-specific files.

### U9. Remove Legacy Compatibility Paths

**Goal:** After all first-party plugin packages have migrated and the release
path has passed, remove compatibility wrappers and migration allowlists.

**Files:**

- Remove: legacy `packages/plugin-catalog/src/plugins/*` wrappers
- Remove: migration allowlist entries
- Update: imports that still reference compatibility paths

**Tests:** Full plugin-catalog, API plugin, deployment-runner, web plugin, and
repository enforcement suites.

---

## Verification

Targeted checks for each PR should include the smallest package suites touched,
then broader checks before the final migration pass:

- `pnpm --filter @thinkwork/plugin-catalog test`
- `pnpm --filter @thinkwork/plugin-catalog typecheck`
- `pnpm --filter @thinkwork/plugin-plane typecheck` for the first Plane package
- Deployment-runner and API plugin suites as their source moves
- Plugin-builder tests when authoring workflow changes
- Repository enforcement tests before enabling the guard in CI

---

## Rollout Notes

- Use one PR per coherent implementation unit unless a unit naturally splits
  into smaller low-risk PRs.
- Keep THNK-31 status evidence in `docs/plans/autopilot/THNK-31-status.md`.
- Refer to the intended project context as `TEI ThinkWork` in status evidence
  while preserving Linear routing by status plus `Codex` label.
