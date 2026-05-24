---
title: "refactor(strands): move system contracts to workspace-resident files"
type: refactor
status: active
date: 2026-05-22
---

> **Partial supersession (2026-05-24):** The root system-contract file shape in this plan is superseded by `docs/brainstorms/2026-05-24-folder-is-the-agent-thinkwork-alignment-requirements.md`; `AGENTS.md` absorbs SOUL/IDENTITY/PLATFORM/CAPABILITIES as named sections, and `GUARDRAILS.md` remains the only standalone governance file per R4/R5 there. See that doc's Requirements section for the canonical replacement.

# refactor(strands): move system contracts to workspace-resident files

## Overview

Plan `2026-05-21-004` shipped the three system contracts (Computer Thread Contract, Eval Runtime Constraints, Runbook Execution Contract) as container-bundled files at `/app/skill-catalog/<slug>/SKILL.md`, read by `system_contract_loader.py` at request time. That bundled-into-the-image delivery path is wrong for a platform that treats the **filesystem as the agent** — agent-shaping content (canonical workspace files, behavioral contracts) should live alongside `PLATFORM.md`, `CAPABILITIES.md`, `GUARDRAILS.md` in the agent's workspace tree (synced from S3 to `/tmp/workspace/`), not in a parallel container-bundle path.

This plan moves the three system contracts into `packages/workspace-defaults/files/system-contracts/<slug>/SKILL.md`, where they ride the existing workspace-defaults composition path. The composer (per `2026-04-27-003`) writes them to each agent's S3 workspace prefix at materialize-time. The container syncs S3 → `/tmp/workspace/` at boot, same as today for `PLATFORM.md`. The loader walks `/tmp/workspace/system-contracts/*/SKILL.md` instead of `/app/skill-catalog/`. The Dockerfile COPY of `packages/skill-catalog/` into `/app/skill-catalog/` goes away. The `_boot_assert.EXPECTED_SYSTEM_CONTRACTS` check goes away — file presence is now governed by workspace-sync, not container build.

The frontmatter vocabulary (`contract: system`, `activates_on`, `template_variables`) shipped in `2026-05-21-004` is preserved verbatim. The loader's per-turn matching logic is preserved. Only the source path changes.

---

## Problem Frame

The 2026-05-12 agentskills-contract-and-portability brainstorm classified content using a single test: "would I want this to travel with the agent when exported?" Files that pass live in the agent's workspace (agent layer, portable). Files that fail live in code (fleet layer, not portable). System contracts pass the test — the `save_app only after the user asks` rule is part of how the agent behaves, and a Claude Code or Codex export of the agent should carry it.

Plan `2026-05-21-004` correctly extracted the contracts from Python source (eliminating the entanglement) but landed them in a container-bundle path that:

- Has no analog in the workspace tree — they're invisible from any workspace-browsing surface
- Requires a Dockerfile COPY + a separate `_boot_assert` check to ensure presence at boot
- Has no path to per-tenant customization (every tenant gets the same bundled content baked into the same image)
- Cuts against the established "filesystem is the agent" model that PLATFORM.md / CAPABILITIES.md / GUARDRAILS.md already follow

A subsequent brainstorm explored building a PR-creating admin UI for editing the bundled files. Research surfaced that the proposed shape required extending an existing per-tenant GitHub App to a platform-monorepo target, building a new platform-engineer auth tier, and extending the parser — multi-day work flowing from the wrong premise. The right premise is: **stop bundling the files into the container; load them from the workspace like every other canonical file**.

This refactor does that. It preserves the runtime loader and the frontmatter vocabulary; it deletes the container-bundle delivery path; it puts the files where every other agent-shaping file already lives.

---

## Requirements

- R1. The three system contracts (`computer-thread-contract`, `eval-runtime-constraints`, `runbook-execution-contract`) live as `SKILL.md` files under `packages/workspace-defaults/files/system-contracts/<slug>/SKILL.md`. They are _not_ duplicated in `packages/skill-catalog/`.
- R2. The workspace composer (existing flow, no changes required to its mechanism) writes the three files into each agent's S3 workspace prefix at `system-contracts/<slug>/SKILL.md` during materialize-at-write-time, the same way it writes `PLATFORM.md` today.
- R3. `system_contract_loader.py` reads from `<workspace_dir>/system-contracts/*/SKILL.md` instead of `/app/skill-catalog/`. `WORKSPACE_DIR` (`/tmp/workspace`, already imported from `install_skills`) is the new base path. The `SKILL_CATALOG_DIR` env var is deleted.
- R4. The loader's per-turn matching logic (`contract: system` filter, `activates_on` evaluation, `template_variables` substitution) is preserved verbatim. Only the source path changes.
- R5. The Dockerfile's `COPY packages/skill-catalog/ /app/skill-catalog/` line (added in `2026-05-21-004` U2) is deleted. The container no longer bundles the skill-catalog directory.
- R6. The `_boot_assert.EXPECTED_SYSTEM_CONTRACTS` check (added in `2026-05-21-004` review autofix) is deleted. Workspace files are governed by workspace-sync at boot, not by image build. A missing system contract logs a warning at first matching turn and the loader falls through closed — same behavior as any other missing workspace file.
- R7. The `conftest.py` test-side `SKILL_CATALOG_DIR` env-var setup is replaced with `WORKSPACE_DIR`-style fixture setup. Loader unit tests in `test_system_contract_loader.py` create a tempdir with the new path layout and pass it directly to `load_system_contracts`.
- R8. Integration tests in `test_server_chunk_streaming.py` that exercise the resolved system prompt (Computer turn + eval mode + runbook turn paths) continue to pass — the loader returns the same rendered bodies because only the source path changed.
- R9. The `u8-status.ts` audit script's `contract: system` carve-out (added in `2026-05-21-004` CI fix) is no longer needed because system contracts no longer live in `packages/skill-catalog/`. Remove the carve-out and let `u8-status.ts` revert to its pre-`2026-05-21-004` shape.
- R10. `sync-catalog-db.ts` does not need a `contract: system` filter (Finding 2 from the `2026-05-21-004` review) because system contracts are no longer in `packages/skill-catalog/` for it to discover. The pre-existing concern that they'd leak into the admin Skills install UI is resolved by relocation.

---

## Implementation Units

### U1. Move system-contract SKILL.md files to workspace-defaults

**Goal:** Relocate the three contract files from `packages/skill-catalog/<slug>/SKILL.md` to `packages/workspace-defaults/files/system-contracts/<slug>/SKILL.md`. File contents are byte-identical — git history should record this as a rename (`git mv`).

**Requirements:** R1, R10 (relocation makes the `contract: system` carve-out in `sync-catalog-db.ts` moot — system contracts are no longer in `packages/skill-catalog/` for the sync to discover)

**Dependencies:** none

**Files:**

- `packages/skill-catalog/computer-thread-contract/SKILL.md` → `packages/workspace-defaults/files/system-contracts/computer-thread-contract/SKILL.md` (rename)
- `packages/skill-catalog/eval-runtime-constraints/SKILL.md` → `packages/workspace-defaults/files/system-contracts/eval-runtime-constraints/SKILL.md` (rename)
- `packages/skill-catalog/runbook-execution-contract/SKILL.md` → `packages/workspace-defaults/files/system-contracts/runbook-execution-contract/SKILL.md` (rename)
- `packages/skill-catalog/computer-thread-contract/` (delete dir, now empty)
- `packages/skill-catalog/eval-runtime-constraints/` (delete dir, now empty)
- `packages/skill-catalog/runbook-execution-contract/` (delete dir, now empty)

**Approach:** Use `git mv` so the diff renders as a rename rather than a delete-plus-add. Frontmatter and body content are unchanged. After the moves, the `packages/skill-catalog/` directory contains only user-invocable skills (artifacts, sales-prep, web-search, etc.) — the discriminator question that motivated `2026-05-21-004` review Finding 2 (system contracts leaking into admin Skills install UI) goes away because they're not in the catalog anymore.

**Test expectation: none -- this is a pure file rename. Behavior coverage migrates with U2/U4.**

**Verification:** `find packages/skill-catalog -name 'SKILL.md'` does not return any `contract: system` file. `find packages/workspace-defaults/files/system-contracts -name 'SKILL.md'` returns exactly three.

---

### U6. Register system contracts in workspace-defaults (composer plumbing)

**Goal:** Make the three relocated SKILL.md files actually flow through the workspace-defaults composer. The composer (`loadDefaults()` in `packages/workspace-defaults/src/index.ts`) does NOT walk the `files/` directory — it returns a static `CONTENT` record keyed by a hardcoded `CANONICAL_FILE_NAMES` array, with each file body inlined as a TypeScript string constant. A parity test enforces byte-equality between the inline constants and the `.md` files on disk. Adding files to the source tree is not enough; they have to be registered as canonical files and inlined.

**Requirements:** R2 (this is the actual work R2 was claiming would happen "for free")

**Dependencies:** U1

**Files:**

- `packages/workspace-defaults/src/index.ts` (modify — extend `CANONICAL_FILE_NAMES`, add three inline string constants, extend the `CONTENT` record, bump `DEFAULTS_VERSION`)
- `packages/workspace-defaults/src/__tests__/parity.test.ts` (modify — extend `AUTHORITATIVE_SOURCES` map with the three new entries)

**Approach:**

- Extend the `CANONICAL_FILE_NAMES` tuple with the three new entries: `"system-contracts/computer-thread-contract/SKILL.md"`, `"system-contracts/eval-runtime-constraints/SKILL.md"`, `"system-contracts/runbook-execution-contract/SKILL.md"`.
- Add three inline TypeScript template-literal constants (e.g., `const COMPUTER_THREAD_CONTRACT_SKILL_MD = \`...\``) with the verbatim content of each SKILL.md. Same pattern as the existing `SOUL_MD`/`PLATFORM_MD`/`ARTIFACT_BUILDER_SKILL_MD` constants.
- Extend the `CONTENT` record so each new `CANONICAL_FILE_NAMES` key maps to its inline constant.
- Update `AUTHORITATIVE_SOURCES` in the parity test so each new key resolves to its source `.md` file under `packages/workspace-defaults/files/system-contracts/<slug>/SKILL.md`. The parity test then enforces byte-equality between the inline constants and the on-disk files.
- Bump `DEFAULTS_VERSION` (currently 17 → 18) so the `seed-workspace-defaults` Lambda re-seeds the tenant-defaults S3 prefix on next deploy.

**Patterns to follow:**

- Existing `skills/artifact-builder/SKILL.md` inline constant + `CONTENT` entry — closest precedent for a subdirectory-nested SKILL.md inlined as a defaults string.
- `parity.test.ts` `AUTHORITATIVE_SOURCES` map shape.

**Test scenarios:**

- The parity test in `packages/workspace-defaults/src/__tests__/parity.test.ts` passes after the new entries are added — byte-equality between the inline constants and the `packages/workspace-defaults/files/system-contracts/<slug>/SKILL.md` source files.
- `loadDefaults()` output includes the three new `system-contracts/<slug>/SKILL.md` keys.
- `DEFAULTS_VERSION` is incremented by one.

**Verification:** `pnpm --filter @thinkwork/workspace-defaults test` passes. `pnpm --filter @thinkwork/workspace-defaults build && node -e "console.log(Object.keys(require('./packages/workspace-defaults/dist').loadDefaults()).filter(k => k.startsWith('system-contracts/')))"` prints the three expected keys.

---

### U2. Update the loader to walk the workspace path

**Goal:** Change `system_contract_loader.py`'s catalog walk from `/app/skill-catalog/*/SKILL.md` to `<workspace_dir>/system-contracts/*/SKILL.md`. The per-turn matching logic and template substitution are unchanged.

**Requirements:** R3, R4

**Dependencies:** U1, U6

**Files:**

- `packages/agentcore-strands/agent-container/container-sources/system_contract_loader.py` (modify)
- `packages/agentcore-strands/agent-container/container-sources/server.py` (modify — the loader call site changes how it passes `catalog_dir`)

**Approach:**

- The loader's `load_system_contracts(catalog_dir, conditions, variables)` signature is unchanged. Callers pass the path; the loader still walks `<catalog_dir>/*/SKILL.md`, filters by `contract: system`, evaluates `activates_on`, substitutes `{{var}}` placeholders.
- The caller in `server.py` swaps the source: `SKILL_CATALOG_DIR = os.environ.get("SKILL_CATALOG_DIR", "/app/skill-catalog")` becomes a path under `WORKSPACE_DIR` — e.g., `os.path.join(WORKSPACE_DIR, "system-contracts")`. `WORKSPACE_DIR` is already imported from `install_skills` (currently `/tmp/workspace`).
- The `SKILL_CATALOG_DIR` env var is no longer read by server.py and can be deleted as a tracked constant. Tests will pass a different path directly (see U4).
- The loader function does **not** become workspace-aware in its signature — it still takes a directory and walks it. This keeps the loader pure and lets the caller decide where it's pointed (workspace path in production, tempdir in tests).

**Patterns to follow:**

- `_build_system_prompt` already reads canonical workspace files from `WORKSPACE_DIR` at `server.py:382-499` — the loader call site joins that base with the `system-contracts/` subpath.

**Test scenarios:**

- (Existing 15 loader unit tests in `test_system_contract_loader.py` continue to pass unchanged — they pass an explicit `catalog_dir` to the loader and don't care what the production caller does.)
- New: in `test_server_chunk_streaming.py`, a Computer turn test that previously asserted the contract loaded from the source-tree `packages/skill-catalog/computer-thread-contract/SKILL.md` now asserts it loads from a fixture path representing the synced workspace (see U4 for fixture details).
- Negative: when `<workspace_dir>/system-contracts/` does not exist (e.g., an older agent's workspace was provisioned before this change rolled out), the loader returns `[]` with a single warning log line. No turns crash.

**Verification:** Computer turn integration test (`test_execute_agent_turn_adds_computer_applet_contract`) passes with the workspace path. Resolved `system_prompt` contains `## Computer Thread Contract` + canonical-phrase smokes. The 33-test affected suite from `2026-05-21-004` continues to pass.

---

### U3. Delete container-bundle delivery + boot-assert check

**Goal:** Remove the Dockerfile COPY that bundles `packages/skill-catalog/` into the container image, and remove the `_boot_assert.EXPECTED_SYSTEM_CONTRACTS` tuple + corresponding check. System contracts now arrive via workspace-sync, not via image build.

**Requirements:** R5, R6

**Dependencies:** U2 (loader must already read from workspace before we delete the bundle path)

**Files:**

- `packages/agentcore-strands/agent-container/Dockerfile` (modify — delete the `COPY packages/skill-catalog/ /app/skill-catalog/` line + its comment block)
- `packages/agentcore-strands/agent-container/container-sources/_boot_assert.py` (modify — delete `EXPECTED_SYSTEM_CONTRACTS` tuple + the conditional inclusion in `_missing()` + the `system-contracts` segment in the success print)
- `packages/agentcore-strands/agent-container/conftest.py` (modify — remove the `SKILL_CATALOG_DIR` env-var defaulting block; see R7 / U4 for the test-fixture replacement)

**Approach:**

- Dockerfile: the COPY line + its 6-line comment block (added in `2026-05-21-004` U2) is removed wholesale. The Dockerfile no longer mentions `skill-catalog`.
- `_boot_assert.py`: the `EXPECTED_SYSTEM_CONTRACTS` tuple is deleted; `_missing()` reverts to iterating only `EXPECTED_AUTH_AGENT`; the success-log line reverts to its pre-`2026-05-21-004` count and breakdown.
- `conftest.py`: the `SKILL_CATALOG_DIR` env-var defaulting (added in `2026-05-21-004` U2) is removed. Tests that need the loader pointed at fixture content use tempdirs directly (already the existing pattern for `test_system_contract_loader.py`); the server-side integration tests in `test_server_chunk_streaming.py` need a new fixture path setup (covered in U4).

**Test expectation: none for U3 directly -- this is pure deletion of redundant safety nets. Behavior coverage stays with U2/U4 tests.**

**Verification:** `grep -rn 'skill-catalog' packages/agentcore-strands/` returns no hits in Dockerfile, conftest, \_boot_assert. The container image build still succeeds. `_boot_assert` runs at boot without complaint.

---

### U4. Update integration tests for workspace-path fixture

**Goal:** Update `test_server_chunk_streaming.py` and `test_runbook_context.py` to use a workspace-path fixture instead of the source-tree `packages/skill-catalog/` symlink. Tests provision a fake `<tmp>/system-contracts/<slug>/SKILL.md` tree and point `WORKSPACE_DIR` at it for the duration of the test.

**Requirements:** R7, R8

**Dependencies:** U2

**Files:**

- `packages/agentcore-strands/agent-container/test_server_chunk_streaming.py` (modify — replace `SKILL_CATALOG_DIR` env handling with a workspace tempdir setup; the 14 tests in the file mostly stub `_build_system_prompt` and don't actually exercise the loader path, but the 3 Computer/eval/runbook integration tests at the end do)
- `packages/agentcore-strands/agent-container/test_runbook_context.py` (no functional changes expected — this file tests `format_runbook_context`, not the loader)
- `packages/agentcore-strands/agent-container/conftest.py` (the fixture-helper additions live here so multiple test modules can reuse them)

**Approach:**

- Add a conftest helper `_with_system_contracts_workspace(tmp_path, slugs)` that copies the requested SKILL.md files from `packages/workspace-defaults/files/system-contracts/<slug>/SKILL.md` into `<tmp_path>/system-contracts/<slug>/SKILL.md` and returns `<tmp_path>`. Tests use `monkeypatch.setattr(server, "WORKSPACE_DIR", tmp_path)` to point the loader at the fixture.
- The 3 Computer / eval-mode / runbook integration tests that previously relied on the conftest pointing `SKILL_CATALOG_DIR` at the source tree now opt into the fixture explicitly.
- Loader unit tests in `test_system_contract_loader.py` continue to use their own tempdir-with-fixture pattern — no changes.

**Patterns to follow:**

- The existing `_write_skill` helper in `test_system_contract_loader.py` is the tempdir-fixture pattern; the new conftest helper mirrors it but reads real SKILL.md content from `packages/workspace-defaults/files/system-contracts/` instead of writing synthetic frontmatter.

**Test scenarios:**

- Existing `test_execute_agent_turn_adds_computer_applet_contract` continues to pass with structural + canonical-phrase smoke assertions (`save_app`, `shadcn`, `delegate_to_workspace`, `preview_app`).
- Existing `test_execute_agent_turn_uses_lean_eval_runtime` continues to pass with eval-mode skill loading.
- Existing `test_execute_agent_turn_adds_runbook_context` continues to pass with the runbook contract heading appearing before the data block.
- New: an integration test that runs the full Computer turn path with `<workspace_dir>/system-contracts/` deliberately empty (simulating a freshly-provisioned agent whose workspace hasn't synced yet) — agent turn completes without crashing, system prompt has no contract heading, loader logs one warning.

**Verification:** All tests in `test_server_chunk_streaming.py` (14), `test_system_contract_loader.py` (15), `test_runbook_context.py` (4) pass — same 33-test baseline as `2026-05-21-004`'s final state.

---

### U5. Revert u8-status.ts carve-out

**Goal:** Remove the `contract: system` recognition added in `2026-05-21-004` CI fix. System contracts no longer live in `packages/skill-catalog/`, so the audit no longer encounters them.

**Requirements:** R9

**Dependencies:** U1 (the files must already have moved out of skill-catalog before u8-status stops needing the carve-out)

**Files:**

- `packages/skill-catalog/scripts/u8-status.ts` (modify — remove the `contract === "system"` branch added in `2026-05-21-004`)

**Approach:** Revert `u8-status.ts` to its pre-`2026-05-21-004` shape. The carve-out logic (treating `contract: system` as a `done` state with execution `(contract)`) is unconditional dead code once U1 ships.

**Test scenarios:**

- The existing `__tests__/u8-status.test.ts` tests pass: `unknown = 0`, `done >= 15`, `regressed = 0`. The 3 contract slugs are no longer in the audit because they're no longer in `packages/skill-catalog/`.

**Verification:** `pnpm --filter @thinkwork/skill-catalog test` passes. `u8-status.ts` output no longer shows `(contract)` rows.

---

## Key Technical Decisions

- **Workspace path = `system-contracts/<slug>/SKILL.md`.** Parallels the existing `skills/<slug>/SKILL.md` convention for user-invocable skills. Reserved-prefix patterns (`_system/`, etc.) were considered but rejected — the `system-contracts/` name is self-describing and doesn't need a special marker. Top-level alongside `PLATFORM.md` was considered (e.g., `COMPUTER_THREAD_CONTRACT.md` at workspace root) but rejected — the loader needs a discoverable container, not three magic top-level filenames.
- **Loader signature stays directory-based.** `load_system_contracts(catalog_dir, ...)` continues to take a directory; only the caller chooses what to point it at. Keeps the loader pure (no S3, no `os.environ` reads, no WORKSPACE_DIR assumption) and lets tests use tempdirs without monkeypatching anything in the loader module.
- **`WORKSPACE_DIR + "/system-contracts"` is hardcoded at the call site, not behind an env var.** The earlier `SKILL_CATALOG_DIR` env var was an artifact of the container-bundle path differing from the source-tree path. With workspace-resident files, the path is the same everywhere (`<workspace>/system-contracts/`) and tests can manipulate `WORKSPACE_DIR` directly (already env-configurable via `install_skills`).
- **Composer registration is explicit, not directory-walk.** The workspace composer (`loadDefaults()` in `packages/workspace-defaults/src/index.ts`) does NOT walk `packages/workspace-defaults/files/` recursively. It returns a static `CONTENT` record keyed by the hardcoded `CANONICAL_FILE_NAMES` array, with each file body inlined as a TypeScript string constant. A parity test enforces byte-equality between the inline constants and the on-disk `.md` files. To make the three new system-contract SKILL.md files flow through to each tenant's defaults S3 prefix, U6 extends `CANONICAL_FILE_NAMES`, inlines the three string constants, updates the parity test's authoritative-sources map, and bumps `DEFAULTS_VERSION`. The dual-representation parity-test pattern (file on disk + inline constant + byte-equality test) is the team's established way of managing canonical workspace files — see `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md`.
- **`_boot_assert` does not gain a workspace-side check.** Workspace files arrive via S3 sync at request time, not at image build. Their absence is a sync-failure mode, not a build-failure mode, and the loader's existing fail-closed semantics (warn + skip) are the right handling for that class of failure. Building a `_boot_assert`-style check would either fail the boot on every cold start before sync completes (false positive) or block-and-wait on sync (architecture change). Skip both.
- **Tenant override is naturally enabled but not implemented here.** Once system contracts live in the workspace, a tenant editing the workspace copy of `system-contracts/computer-thread-contract/SKILL.md` would automatically be picked up by the loader on the next turn for that agent. The existing per-agent workspace editor in admin already supports editing workspace files. v1 of this refactor doesn't ship that affordance; it just makes it possible.

---

## Scope Boundaries

### In scope

- The three file relocations (U1)
- Loader path update (U2)
- Dockerfile + boot-assert + conftest cleanup (U3)
- Integration test fixture migration (U4)
- u8-status.ts carve-out removal (U5)

### Deferred to Follow-Up Work

- **Per-tenant workspace edits of system contracts.** Now mechanically possible (any workspace-file editor can target them) but not exposed in the admin UI as a separate affordance. A future plan can add a per-agent "system contracts" editor section if friction surfaces; the existing workspace file tree may already be sufficient.
- **Versioning beyond git history of `packages/workspace-defaults/files/`.** Same model as PLATFORM.md / CAPABILITIES.md / etc. — git is the version control.
- **Migration runbook for agents provisioned before this refactor.** Their workspace S3 prefixes don't yet contain `system-contracts/`. The next materialize cycle for each agent will write them in (via the composer). Until then, the loader returns `[]` with a warning and turns proceed without the contracts — graceful degradation, not a hard failure. A bulk re-materialize script may be useful but is not required.
- **Renaming `system_contract_loader.py` to something workspace-aware** (e.g., `workspace_contract_loader.py`). Cosmetic; current name still accurate.

### Outside this product's identity

- **A separate DB table for system contracts.** Files in the workspace tree are the source of truth. A DB row would duplicate state and re-open every question this refactor closes.
- **A separate sync mechanism for system contracts.** The workspace-defaults composer is the existing sync mechanism. Adding another path would re-introduce the multi-delivery-path problem this refactor exists to eliminate.
- **A platform-engineer admin UI for editing system contracts pre-merge.** github.com's web file editor + the existing CI is the editor. Adding an in-admin editor was the previous wrong direction; not re-opening it.

---

## Risk Analysis & Mitigation

- **Risk: rollout race — new container code reads from `/tmp/workspace/system-contracts/` but some agents' workspaces haven't been re-materialized with the new files yet.** Resolved by the loader's existing fail-closed semantics: agents missing the workspace files lose the contracts in their system prompt with a warning log line; turns still complete. Acceptable for a transient rollout window.
- **Risk: workspace bootstrap doesn't actually mirror `packages/workspace-defaults/files/system-contracts/` because the composer's discovery rules exclude unrecognized subdirectories.** Mitigation: U2 includes a fixture test that verifies the loader reads files from the path the composer writes them to. If the composer doesn't auto-discover the new subdir, U2's design surfaces it before merge.
- **Risk: by removing the `_boot_assert` check, missing system contracts become an invisible failure mode in production.** Mitigated by the loader's warning log line firing on every turn that would have activated a missing contract — CloudWatch shows the gap. If the operational signal turns out to be too quiet (no alarm, easy to miss), a follow-up plan can add a CloudWatch metric.
- **Risk: tests pass but the live composer doesn't pick up the new files.** Verified post-merge by tailing AgentCore CloudWatch logs after the Deploy run completes — the loader's startup behavior and per-turn system_prompt log lines confirm the new files are reaching the runtime.

---

## Verification Strategy

- Per-unit: `uv run pytest` against affected test files (`test_system_contract_loader.py`, `test_server_chunk_streaming.py`, `test_runbook_context.py`).
- After U2/U3: `grep -rn 'skill-catalog' packages/agentcore-strands/` returns zero hits in container-related files.
- Pre-merge: a manual diff of a fresh agent's workspace (via admin UI workspace browser, or `aws s3 ls`) after running the workspace composer locally confirms `system-contracts/<slug>/SKILL.md` files appear under the agent's S3 prefix.
- Post-merge to dev: tail AgentCore CloudWatch logs after the Deploy run completes. The boot log no longer references "3 system-contracts" (because `_boot_assert` no longer checks for them); the first Computer turn after the new container reloads produces a system_prompt containing the Computer Thread Contract heading (sourced from the workspace, not the image bundle).

---

## Anti-Goals

- **Do not introduce a new env var** to configure the workspace-relative path. The path is `WORKSPACE_DIR/system-contracts/`. Hardcoded at the call site. Tests manipulate `WORKSPACE_DIR` itself if they need a different root.
- **Do not preserve the `SKILL_CATALOG_DIR` env var** for backward compatibility. No production caller other than this codebase reads it. Delete it cleanly.
- **Do not edit the contract content during this refactor.** Same anti-goal as `2026-05-21-004` — verbatim port from source path to destination path. `git mv` makes this explicit.
- **Do not add a DB row, a Drizzle migration, or any persistent-storage surface.** The whole point is "filesystem is the agent." Adding DB state for system contracts contradicts the refactor.
- **Do not add an admin UI for editing system contracts.** The previous direction explored this and was wrong. The existing per-agent workspace editor can edit any workspace file once the contracts live there; no new UI required.
