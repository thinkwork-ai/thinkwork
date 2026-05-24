---
date: 2026-05-24
type: refactor
status: active
origin: docs/brainstorms/2026-05-24-folder-is-the-agent-thinkwork-alignment-requirements.md
---

# refactor: Folder is the Agent — ThinkWork Alignment Implementation

## Summary

Implement the canonical "folder is the agent — ThinkWork edition" alignment in code: consolidate four system-contract files (SOUL/IDENTITY/PLATFORM/CAPABILITIES) into named sections of `AGENTS.md`; introduce `master/workspaces/<slug>/` as the real subagent storage path (retiring the 2026-04-26 UI fabrication); collapse AGENTS.md derived sections to two tree-walk-derived sections; drop per-Space Hindsight bank wiring (per-user only); add a SPACE.md `## Mentionable Workspaces` render-time parser and a render-layer privacy gate for private Spaces; update Pi + Strands system-prompt loaders to the new pinned reading order; and migrate existing tenants in place with a Plan-B-style idempotent script. Lands behind a substrate-first inert→live seam-swap pattern so both layouts coexist during the deploy cycle.

---

## Problem Frame

The 2026-05-24 brainstorm anchors a canonical interpretation of the "folder is the agent" pattern for ThinkWork. The brainstorm pinned product shape (Model A: Spaces are context-only); the file canon (AGENTS.md absorbs four prior system-contract files; GUARDRAILS.md stays standalone); the storage layout (`master/workspaces/<slug>/` parent folder, retiring the synthetic UI grouping); the pinned reading order (AGENTS.md → CONTEXT.md → GUARDRAILS.md → SPACE.md → USER.md); the memory model (per-user Hindsight only, no per-Space bank in v1); render-layer authz for private Spaces; and SPACE.md mentionable-workspaces routing. Three in-flight brainstorms (`2026-05-22-one-platform-agent-spaces-runtime-requirements`, `2026-05-23-editor-driven-agents-md-section-regen-requirements`, and `2026-05-22-001-refactor-system-contracts-as-workspace-files-plan`) are anchored to the new canon and must be header-edited to record the partial supersession before any of their planning work continues.

The implementation surface is wide. The renderer (`packages/api/src/lib/workspace-renderer/compose-tuple.ts`) is already wired, but its per-Space TOOLS.md/MCP.md/policy merging path is Model B behavior that Model A retires — and the brainstorm's R14 parser and R19a privacy gate need to land there. Both runtimes (`packages/agentcore-pi/agent-container/src/runtime/system-prompt.ts` and `packages/agentcore-strands/agent-container/container-sources/server.py`) hard-code the legacy reading order and must update in lockstep — the AgentCore DEFAULT endpoint cannot be flushed, so a 15-minute mismatch window between the two runtimes is the worst case if shipping is misaligned. The per-Space Hindsight bank wiring is already implemented across Strands `memory_tools.py`, `invocation_env.py`, `hindsight-adapter.ts`, and dedicated tests — teardown is real work, not a code-flag flip. `agent_skills` DB has two readers (the AGENTS.md derived-section renderer and `resolve-agent-runtime-config.ts` — the hot path for tool registration at invocation time), and both must switch to tree-walk derivation atomically. The `workspace-defaults` package has dual surfaces (`files/` markdown and `src/index.ts` string-constant mirror) that must move together; a TS parity test catches drift. The synthetic `agents/` group lives in `apps/admin/src/components/agent-builder/FolderTree.tsx` and is reversed here by switching to real `workspaces/` folder rendering.

The plan adopts a substrate-first inert→live seam-swap pattern (per `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`): forward-compatible readers ship first, the per-tenant migration adds the new layout to existing trees, the system-prompt loaders then drop the legacy file reads, and a cleanup phase removes the legacy file content from `workspace-defaults`. Migration follows the Plan-B 4-step contract (`dry-run` / `apply` / second-apply-as-repair / final-noop) from `docs/solutions/workflow-issues/platform-agent-space-runtime-refactor-autopilot-sequencing-2026-05-23.md`.

---

## Requirements Trace

| Origin requirement                                                            | Plan unit(s)      | Notes                                            |
| ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------ |
| R1 — one master platform agent per tenant                                     | (carried forward) | Pre-existing from 2026-05-22 commit; no new code |
| R2 — workspace tree IS the agent                                              | (carried forward) | Principle reinforced across all units            |
| R3 — workspaces are subagent folders under `master/workspaces/<slug>/`        | U6, U7            | Storage rename + writer + importer               |
| R4 — four canonical root files (AGENTS, CONTEXT, GUARDRAILS, USER)            | U3, U4, U5        | workspace-defaults substrate                     |
| R5 — SOUL/IDENTITY/PLATFORM/CAPABILITIES retired from root                    | U3, U21           | Substrate + migration                            |
| R6 — AGENTS.md regen preserves hand-authored sections byte-identical          | U4                | Editor regen update                              |
| R7 — Folder Structure + Skills & Tools tree-walk-derived                      | U7b, U20          | Regen + runtime-config switchover                |
| R7a — KB + Workflows derived sections dropped                                 | U4                | Regen update                                     |
| R8 — pinned reading order                                                     | U15, U16          | Pi + Strands loaders                             |
| R8a — USER.md omitted on no-user invocations                                  | U15, U16          | Both loaders                                     |
| R9 — route per CONTEXT.md to active workspace                                 | (no code change)  | Existing runtime behavior                        |
| R10 — workspaces at `master/workspaces/<slug>/`                               | U6, U7            | Writer + importer                                |
| R11 — `agents/` UI fabrication retired                                        | U8                | FolderTree update                                |
| R12 — Spaces are context-only (SPACE.md, knowledge/, members, privacy, email) | U11, U23          | Renderer simplification + editor rejection       |
| R13 — Spaces don't contain skills/TOOLS.md/MCP.md                             | U11, U23          | Same                                             |
| R14 — SPACE.md mentionable-workspaces (fenced-block, render-time)             | U12               | Renderer parser + filter                         |
| R15 — per-Space Hindsight bank not provisioned in v1                          | U17, U18, U19     | Memory teardown                                  |
| R16 — cross-thread Space memory deferred to v1.5                              | (Open Questions)  | Already deferred in brainstorm                   |
| R17 — S3 layout `master/workspaces/<slug>/` + `spaces/<slug>/`                | U6, U21           | Writer + migration                               |
| R18 — one-time per-tenant migration                                           | U21               | Migration script                                 |
| R18a — write-then-delete sequencing + per-tenant rollback                     | U21               | Migration script                                 |
| R19 — per-tuple renderer continues; Space layer only SPACE.md + knowledge/    | U11               | Renderer simplification                          |
| R19a — render-layer authz for private Spaces                                  | U13               | Renderer gate                                    |
| R20 — Pi tree walk unchanged; PROMPT_FILES needs update                       | U15               | Pi loader                                        |
| R21 — Pi skill catalog stands as committed                                    | (no change)       | Not in scope                                     |
| R22 — install scope reduces to {baseline, subagent}                           | U23               | Editor rejection                                 |
| R23 — filesystem source of truth (floor-B portability)                        | (principle)       | No code change                                   |

Acceptance Examples (AE1–AE7) from the brainstorm are covered by test scenarios on U4, U11, U12, U15, U17, U21, U23 — linked inline via `Covers AE<N>` annotations.

---

## System-Wide Impact

| Surface                                        | Impact                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api` (Lambda)                        | AGENTS.md regen + editor writer + workspace-bootstrap + renderer + agent_skills derivation all change                                                 |
| `packages/agentcore-pi` (Pi runtime)           | `PROMPT_FILES` reorder + 4-file drop; no skills-discovery change                                                                                      |
| `packages/agentcore-strands` (Strands runtime) | `_build_system_prompt` reorder + 4-file drop; `memory_tools.py` Space-bank teardown; `invocation_env.py` no-active-space simplification               |
| `packages/workspace-defaults`                  | Both `files/` and `src/index.ts` mirror; `PINNED_FILES` collapses; TS parity test stays green                                                         |
| `apps/admin`                                   | `FolderTree.tsx` synthetic `agents/` grouping retired; `workspaces/` rendered as a real top-folder                                                    |
| Database (`agent_skills` table)                | Becomes derived; readers switch to tree-walk; cleanup-catalog brainstorm coordinates removal                                                          |
| S3 tenant trees                                | Per-tenant migration: AGENTS.md absorbs four legacy files' content; subagent folders move under `workspaces/`; legacy files deleted after grace cycle |
| AgentCore Memory banks                         | Per-Space banks in dev deprovisioned; user banks unchanged                                                                                            |
| Three anchored docs                            | Header edits record partial supersession (U1)                                                                                                         |

No mobile, CLI, GraphQL public-API, or Terraform changes required.

---

## Key Technical Decisions

- **Substrate-first inert→live seam-swap** (per learning 2026-05-08). New readers ship parallel to old readers for one deploy cycle, then the legacy paths retire. This keeps the AgentCore Pi + Strands 15-minute no-flush window from producing a broken mismatch state.
- **Plan-B-style migration contract** (per learning 2026-05-23). `--dry-run` / `--apply` / second-apply-is-repair / final-dry-run-returns-noop. Per-tenant rollback semantics, idempotent on repeat.
- **R14 mentionable-workspaces enforced at render time, not advisory.** The renderer parses the SPACE.md `## Mentionable Workspaces` fenced block and filters the rendered AGENTS.md so the model literally cannot `@` an unlisted workspace. Closes the Open Question P14 in favor of render-layer enforcement (the renderer is already wired; the filter is a clean addition).
- **R19a render-layer authz lands in `compose-tuple.ts`.** Membership check on `space_members` before composing private-Space sources; gates both human (A3) and automation (A6) invocations. A6's specific identity-presentation model remains an Open Question.
- **`agent_skills` DB switches in two places, not one.** `workspace-map-generator.ts` for the AGENTS.md `## Skills & Tools` section AND `resolve-agent-runtime-config.ts` for runtime tool registration. Both port `discoverWorkspaceSkills`-style logic server-side.
- **`PINNED_FILES` collapses to `["GUARDRAILS.md"]`.** Currently `["GUARDRAILS.md", "PLATFORM.md", "CAPABILITIES.md"]`. The pin protects safety-critical content from accidental overwrite; under Model A only GUARDRAILS stays standalone.
- **`GOVERNANCE_FILE_BASENAMES` in `workspace-files.ts` drops `CAPABILITIES.md` and `PLATFORM.md`.** Otherwise governance audit emits reference dead surfaces.
- **Per-Space Hindsight teardown includes dev deprovisioning.** Code removal alone leaves orphan banks; explicit teardown step deprovisions any `space_*` banks created in dev/test against AgentCore Memory.
- **Migration touches AGENTS.md content-merge.** When a tenant's `SOUL.md` / `IDENTITY.md` / `PLATFORM.md` / `CAPABILITIES.md` differs from `workspace-defaults` seeds, the migration appends operator-customized content into the new named sections with a `<!-- migrated from <FILENAME>.md on YYYY-MM-DD -->` breadcrumb marker. Pure-defaults tenants get a clean overwrite from the new template.
- **Legacy file deletion is the LAST step.** Migration adds the new sections to existing AGENTS.md first; only after the system-prompt loaders have switched to reading AGENTS.md sections does the migration's second pass delete the four legacy files. Mid-flight failures leave both layouts coexisting (forward-compat readers see the new sections; nothing breaks).

---

## High-Level Technical Design

The work proceeds in 8 logical phases. Phases 1–4 ship parallel readers; Phase 5 migrates tenant data; Phases 6–7 switch readers/teardown; Phase 8 cleans up.

```
Phase 0: Pre-flight — supersession header edits + pre-destructive consumer survey
   │
   ├─ Phase 1: workspace-defaults substrate
   │     New AGENTS.md template with named sections; PINNED_FILES collapse;
   │     GOVERNANCE_FILE_BASENAMES trim; TS+files parity preserved.
   │     Old files (SOUL/IDENTITY/PLATFORM/CAPABILITIES) STAY for now.
   │
   ├─ Phase 2: Renderer Model A simplification + R14 + R19a
   │     compose-tuple.ts drops Space-side TOOLS/MCP/policy merge;
   │     adds SPACE.md mentionable-workspaces parser + filter;
   │     adds private-Space membership gate.
   │
   ├─ Phase 3: Storage layout — workspaces/ parent folder
   │     handleCreateSubAgent writes to workspaces/<slug>/;
   │     vendor-path-normalizer rewrites .claude/agents/X/ → workspaces/X/;
   │     FolderTree retires agents/ synthetic grouping.
   │     Existing flat-storage subagents still readable.
   │
   ├─ Phase 4: AGENTS.md regen update
   │     Derived sections collapse to 2 (Folder Structure + Skills & Tools);
   │     Skills & Tools switches to tree-walk (drops agent_skills DB read).
   │     Editor writer doesn't break legacy 4-section AGENTS.md files in flight.
   │
   ├─ Phase 5: Per-tenant migration
   │     Plan-B-style script. Add absorbed sections to AGENTS.md;
   │     mv subagent folders to workspaces/; idempotent.
   │     Does NOT delete the 4 legacy files yet.
   │
   ├─ Phase 6: System-prompt loaders (Pi + Strands lockstep)
   │     PROMPT_FILES new order; drop SOUL/IDENTITY/PLATFORM/CAPABILITIES reads;
   │     R8a no-user composition path.
   │
   ├─ Phase 7: Memory teardown + agent_skills switchover
   │     memory_tools.py + invocation_env.py + hindsight-adapter.ts revert;
   │     resolve-agent-runtime-config.ts + derive-agent-skills.ts switchover.
   │     dev-side bank deprovisioning.
   │
   └─ Phase 8: Cleanup
         Delete 4 legacy files from packages/workspace-defaults/;
         second migration pass deletes them from tenant trees;
         editor-layer rejection for Space-scoped capability files;
         end-to-end smoke verification.
```

This sketch illustrates phase boundaries and is directional guidance for review; sequencing across PRs within a phase is the implementer's call.

---

## Implementation Units

### Phase 0: Pre-flight

### U1. Supersession header edits to three anchored docs

- **Goal:** Edit the YAML frontmatter (or first heading block, if no frontmatter) of three anchored brainstorms/plans to record the partial supersession by the 2026-05-24 alignment doc. Resolve-Before-Planning gate from the origin doc.
- **Requirements:** Origin Outstanding Questions → Resolve Before Planning entry.
- **Dependencies:** none (must land first).
- **Files:**
  - `docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md`
  - `docs/brainstorms/2026-05-23-editor-driven-agents-md-section-regen-requirements.md`
  - `docs/plans/2026-05-22-001-refactor-system-contracts-as-workspace-files-plan.md`
- **Approach:** Add a header note at the top of each doc immediately after the YAML frontmatter (or H1 if no frontmatter): `> **Partial supersession (2026-05-24):** Sections R6, R10, R17–R19, R20, R21, R22, R24 (or equivalent) are superseded by docs/brainstorms/2026-05-24-folder-is-the-agent-thinkwork-alignment-requirements.md. See that doc's Requirements section for the canonical replacement.` Exact R-IDs vary per anchored doc; map per the origin's Resolve-Before-Planning entry.
- **Patterns to follow:** Existing brainstorm/plan header conventions in `docs/brainstorms/` and `docs/plans/`.
- **Test scenarios:**
  - Test expectation: none — documentation edit, no behavioral change.
- **Verification:** Each of the three docs renders with the supersession callout visible above its Summary section.

### U2. Pre-destructive consumer survey

- **Goal:** Produce a survey doc cataloguing all readers of `SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, `CAPABILITIES.md` across the monorepo before any retirement work lands. Per the destructive-work survey rule (`docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`).
- **Requirements:** Brainstorm R5; survey is a planning input to U3, U15, U16, U21.
- **Dependencies:** U1.
- **Files:**
  - Output: `docs/solutions/workflow-issues/folder-is-the-agent-pre-retirement-consumer-survey-2026-05-24.md` (new)
- **Approach:** Run `rg "SOUL\.md|IDENTITY\.md|PLATFORM\.md|CAPABILITIES\.md"` across the entire repo. Bucket findings by package (`packages/api/`, `packages/agentcore-pi/`, `packages/agentcore-strands/`, `packages/workspace-defaults/`, `packages/skill-catalog/`, `apps/admin/`, `apps/cli/`, `apps/mobile/`, `terraform/`, `docs/`). For each occurrence, note whether it's a runtime read, a string literal in tests, a default-template seed, an audit-event basename, or a doc reference. Identify anything that would silently break if the file were removed.
- **Patterns to follow:** The institutional learning's bucket-by-package + parent-vs-joining-table-asymmetry analysis.
- **Test scenarios:**
  - Test expectation: none — research artifact.
- **Verification:** Survey doc exists, lists every reference grouped by package, and flags any reference that would break if the file were removed. Sign-off: a reviewer can answer "what code paths break if SOUL.md is deleted from a tenant's tree today?" by reading this doc.

---

### Phase 1: workspace-defaults substrate

### U3. Consolidate four system-contract files into AGENTS.md named sections in workspace-defaults

- **Goal:** Rewrite `packages/workspace-defaults/files/AGENTS.md` and the parallel `AGENTS_MD` string constant in `packages/workspace-defaults/src/index.ts` to absorb the content of `SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, and `CAPABILITIES.md` as named hand-authored sections (`## Personality`, `## Identity`, `## Platform Behavior`; `## Skills & Tools` already exists as a derived section so `CAPABILITIES.md` content slots into the operator-visible hand-authored framing alongside it). The four legacy files STAY in `packages/workspace-defaults/files/` and as `SOUL_MD` / `IDENTITY_MD` / `PLATFORM_MD` / `CAPABILITIES_MD` constants for one deploy cycle; they are deleted in U24.
- **Requirements:** R4, R5 (substrate part).
- **Dependencies:** U2.
- **Files:**
  - `packages/workspace-defaults/files/AGENTS.md`
  - `packages/workspace-defaults/src/index.ts` (AGENTS_MD constant ~line 433)
  - `packages/workspace-defaults/src/__tests__/parity.test.ts`
- **Approach:** Compose the new AGENTS.md template with the section order specified in origin R4: `## What This Is` (hand), `## Personality` (was SOUL.md content), `## Identity` (was IDENTITY.md content), `## Platform Behavior` (was PLATFORM.md content), `## Folder Structure` (derived), `## Skills & Tools` (derived), `## Quick Navigation` (hand), `## ID & Naming Conventions` (hand), `## File Placement Rules` (hand), `## Cross-Workspace Flow` (hand), `## Token Management` (hand). Section-boundary parser in `packages/api/src/lib/workspace-map-generator.ts` (U7's territory) already handles arbitrary `## ` headings without code change.
- **Execution note:** Update the `.md` files and the TS mirror together in the same commit; run `pnpm --filter @thinkwork/workspace-defaults test` locally before push. The TS parity test catches drift; Python pre-push tests do not.
- **Patterns to follow:** Existing AGENTS.md template structure in `packages/workspace-defaults/files/AGENTS.md`; the per-section narrative voice from the four legacy files transfers verbatim.
- **Test scenarios:**
  - Covers AE1. `loadFile("AGENTS.md")` returns the new template with all named sections present, byte-identical to the `.md` file on disk.
  - The TS parity test (`packages/workspace-defaults/tests/parity.test.ts`) passes — TS constant and `.md` file are byte-identical.
  - Loading `loadFile("SOUL.md")` / `loadFile("IDENTITY.md")` / `loadFile("PLATFORM.md")` / `loadFile("CAPABILITIES.md")` still returns the legacy content (these are still present for the deploy cycle).
- **Verification:** `pnpm --filter @thinkwork/workspace-defaults build && pnpm --filter @thinkwork/workspace-defaults test` passes. The new AGENTS.md template renders correctly when fed to the editor's section-preserving rewriter (`regenerateAgentsMdDerivedSections`).

### U4. Collapse PINNED_FILES and GOVERNANCE_FILE_BASENAMES

- **Goal:** `PINNED_FILES` in `packages/workspace-defaults/src/index.ts` collapses from `["GUARDRAILS.md", "PLATFORM.md", "CAPABILITIES.md"]` to `["GUARDRAILS.md"]`. `GOVERNANCE_FILE_BASENAMES` in `packages/api/workspace-files.ts` drops `CAPABILITIES.md` and `PLATFORM.md`.
- **Requirements:** R4 (root files canon), R5.
- **Dependencies:** U3 (so the absorbed content is already in AGENTS.md before unprotecting the legacy files).
- **Files:**
  - `packages/workspace-defaults/src/index.ts` (PINNED_FILES ~line 40)
  - `packages/api/workspace-files.ts` (GOVERNANCE_FILE_BASENAMES ~line 991)
- **Approach:** Two-line edits in each file. Verify no other consumer of `PINNED_FILES` expects the old list (`rg "PINNED_FILES" packages/`).
- **Patterns to follow:** Existing imports of `PINNED_FILES` and `isPinnedWorkspacePath` from `@thinkwork/workspace-defaults`.
- **Test scenarios:**
  - Editing `CAPABILITIES.md` on an agent no longer requires `acceptTemplateUpdate=true` (no longer pinned).
  - Editing `GUARDRAILS.md` continues to require `acceptTemplateUpdate=true`.
  - Editing `PLATFORM.md` and `CAPABILITIES.md` no longer emits `workspace.governance_file_edited` audit rows; editing `GUARDRAILS.md` continues to emit them.
- **Verification:** Existing pin-check tests pass with adjusted expectations. Audit-row schema check confirms no orphan emissions for retired filenames.

### U5. Worksace-bootstrap stops seeding 4 retired files for new agents

- **Goal:** `packages/api/src/lib/workspace-bootstrap.ts` (`bootstrapAgentWorkspace`, line 237) stops materializing `SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, `CAPABILITIES.md` in newly-created agent prefixes. Existing tenants are unaffected; only fresh bootstraps change.
- **Requirements:** R4, R5.
- **Dependencies:** U3 (new AGENTS.md template absorbs the content).
- **Files:**
  - `packages/api/src/lib/workspace-bootstrap.ts`
  - Per-tenant `_catalog/defaults/workspace/` S3 prefix — the four files removed via a one-shot admin script run after U3 lands.
- **Approach:** Add the four filenames to an exclusion set inside `bootstrapAgentWorkspace`'s copy loop. Document that the per-tenant `_catalog/defaults/workspace/` prefix also needs the four files removed; provide a small admin CLI command (`thinkwork admin retire-default-files --tenant <slug>`) or document the S3 console action.
- **Patterns to follow:** Existing `NON_SKILL_DIRS` exclusion pattern from `feedback_bootstrap_script_excludes_dev_artifacts`.
- **Test scenarios:**
  - Fresh `bootstrapAgentWorkspace()` invocation against a test tenant produces the new agent prefix WITHOUT `SOUL.md` / `IDENTITY.md` / `PLATFORM.md` / `CAPABILITIES.md`, but WITH the new consolidated `AGENTS.md`.
  - Bootstrapping an agent twice (idempotent re-run) does not re-introduce the four retired files.
- **Verification:** Integration test creates a fresh agent and lists its S3 prefix; expected file set matches the new four-file canon (AGENTS, CONTEXT, GUARDRAILS, USER + skills/ + memory/).

---

### Phase 2: Renderer Model A simplification + R14 + R19a

### U10. Drop Space-side TOOLS.md/MCP.md/policy merge in compose-tuple.ts

- **Goal:** `packages/api/src/lib/workspace-renderer/compose-tuple.ts`'s composition flow stops merging Space-resident `TOOLS.md`, `MCP.md`, and tool/MCP policy. The renderer composes only agent-baseline tool/MCP surfaces; Space sources contribute SPACE.md and `knowledge/` only.
- **Requirements:** R12, R13, R19.
- **Dependencies:** U2 (survey — confirm no other code depends on Space-side tool merging).
- **Files:**
  - `packages/api/src/lib/workspace-renderer/compose-tuple.ts`
  - `packages/api/src/lib/workspace-renderer/tool-policy-merger.ts` (becomes unused; delete or stub for one cycle)
  - `packages/api/src/lib/workspace-renderer/compose-tuple.test.ts`
- **Approach:** Remove the `composeWorkspacePolicy(agent + space)` call. Skip Space-side TOOLS.md/MCP.md reads in the source listing step. The `effectivePolicy` return value collapses to the agent-baseline policy. Leave `tool-policy-merger.ts` as a no-op for one deploy cycle to keep imports stable; delete in U24.
- **Execution note:** Add a characterization test capturing the current Model B behavior (Space-additive TOOLS) BEFORE changing the merger so the diff is provably bounded to "Space side no longer contributes."
- **Patterns to follow:** `compose-tuple.ts` line 137-143 source-listing step; the existing `agentSource` vs `spaceSource` split.
- **Test scenarios:**
  - Covers AE5. Given a Space with a `TOOLS.md` file uploaded (legacy data), when the renderer composes for that Space, then the `TOOLS.md` content does NOT appear in the rendered prefix; only the agent baseline tools are present.
  - Given a Space with no TOOLS.md/MCP.md/skills, when the renderer composes, then the rendered prefix contains agent-baseline tools unchanged.
  - The `effectivePolicy` field returned by `renderWorkspaceTuple` matches the agent-baseline policy verbatim (no Space narrowing applied).
- **Verification:** Existing `compose-tuple` tests pass with Model A expectations. The characterization test from the execution note now asserts the new behavior. Integration: a finance Space with legacy Space-resident skill files does NOT register those skills with the runtime.

### U11. SPACE.md mentionable-workspaces parser + render-time filter

- **Goal:** Add a parser to `compose-tuple.ts` that reads SPACE.md, extracts the `## Mentionable Workspaces` H2 section's fenced code block, parses one workspace slug per line, and uses the resulting allowlist to filter the rendered AGENTS.md's routing table (and the `workspaces/` folder listing if needed) so the model literally cannot `@`mention an unlisted workspace.
- **Requirements:** R14.
- **Dependencies:** U10 (Model A simplification before adding the new parser); origin doc's R14 default-precedence rules.
- **Files:**
  - `packages/api/src/lib/workspace-renderer/compose-tuple.ts`
  - `packages/api/src/lib/workspace-renderer/space-md-parser.ts` (new)
  - `packages/api/src/lib/workspace-renderer/agents-md-composer.ts` (extend to apply the filter when composing rendered AGENTS.md)
  - `packages/api/src/lib/workspace-renderer/space-md-parser.test.ts` (new)
- **Approach:** New module `space-md-parser.ts` exports `parseMentionableWorkspaces(spaceMdContent: string): { mode: 'all' | 'none' | 'allowlist'; slugs: string[] }`. Per origin R14: section absent → `{ mode: 'all' }`; section present, fenced block empty → `{ mode: 'none' }`; section present with slugs → `{ mode: 'allowlist', slugs: [...] }`. `agents-md-composer.ts` applies the filter: in `all` mode, no change; in `none` or `allowlist` mode, the composer strips routing rows that don't match (and the rendered `## Folder Structure` reflects the filter when listing top-level `workspaces/<slug>/` entries).
- **Patterns to follow:** WIRING.md parser shape from `docs/brainstorms/2026-05-24-pi-agent-skill-catalog-and-workspace-install-requirements.md` R4a (H2 sections + fenced blocks). Same parsing primitive.
- **Test scenarios:**
  - Covers AE5. Given a `finance` Space with `## Mentionable Workspaces` listing `sql` and `finance-analyst`, when the renderer composes the tuple, then the rendered AGENTS.md routing table contains rows for `sql` and `finance-analyst` only (no `code-executor`, no `legal`).
  - Given a Space SPACE.md with no `## Mentionable Workspaces` section, when the renderer composes, then ALL top-level workspaces in the master AGENTS.md appear in the rendered routing table.
  - Given a Space SPACE.md with `## Mentionable Workspaces` containing an empty fenced block, when the renderer composes, then NO workspaces appear in the rendered routing table.
  - Given a Space SPACE.md listing a workspace slug that doesn't exist in `master/workspaces/`, when the renderer composes, then the slug is silently dropped (no rendering error; absence is the right signal to the model).
  - Parser handles whitespace, blank lines inside the fenced block, and slug normalization (lowercase, hyphenated).
- **Verification:** Unit tests cover the four mode cases. Integration test against the live renderer composing a Space tuple confirms the rendered AGENTS.md routing filter.

### U12. Render-layer authz for private Spaces (R19a)

- **Goal:** Add a membership check at the top of `renderWorkspaceTuple` in `compose-tuple.ts` that, for private Spaces, verifies the invoking user (or A6 service identity) is a member before composing `spaceSource`. Failed check returns an authorization error; no rendered prefix is produced.
- **Requirements:** R19a.
- **Dependencies:** U10 (Model A renderer baseline).
- **Files:**
  - `packages/api/src/lib/workspace-renderer/compose-tuple.ts`
  - `packages/api/src/lib/workspace-renderer/space-membership-check.ts` (new)
  - `packages/database-pg/src/schema/spaces.ts` (reads `access_mode` from `spaces` table AND membership from the `spaceMembers` table defined in the same file ~line 91)
  - `packages/api/src/lib/workspace-renderer/space-membership.test.ts` (new)
- **Approach:** New `space-membership-check.ts` exports `assertSpaceAccessAllowed({ tenant, space, invokingUser, invokingServiceIdentity })`. Reads `spaces.access_mode`; for `'public'` returns immediately; for `'private'` checks `space_members` for the invoking user OR the service identity (where A6 sources carry one). Throws a typed `SpaceAccessDeniedError`. `renderWorkspaceTuple` calls this between tuple resolution (~line 137) and source listing (~line 143). `chat-agent-invoke.ts` and the standalone `workspace-renderer.ts` Lambda surface the error to callers; A6 sources without authorized identity get a structured 403.
- **Patterns to follow:** Existing access-mode reads in `packages/api/src/lib/spaces/` and DB query patterns in adjacent renderer modules.
- **Test scenarios:**
  - Covers AE5. Given a private `finance` Space with members `[eric, lin]`, when `renderWorkspaceTuple` is invoked for `(master, finance, eric)`, then composition proceeds and a rendered prefix is produced.
  - Given the same private Space, when invoked for `(master, finance, bob)` where bob is not a member, then `SpaceAccessDeniedError` is thrown; no rendered prefix is produced; no S3 writes occur.
  - Given a public Space, when invoked with any user (including non-member), then composition proceeds.
  - Given an A6 invocation (no invoking user) against a private Space with no service identity, then `SpaceAccessDeniedError` is thrown.
  - Given an A6 invocation with an authorized service identity against the private Space, then composition proceeds.
- **Verification:** Unit tests cover the four authz paths. Integration: a `chat-agent-invoke` call with a non-member user against a private Space returns a 403 with the typed error code.

---

### Phase 3: Storage layout — workspaces/ parent folder

### U6. handleCreateSubAgent writes to `workspaces/<slug>/CONTEXT.md`

- **Goal:** When a new subagent is created via the editor, the file lands at `workspaces/<slug>/CONTEXT.md` (under the tenant agent workspace prefix) and the AGENTS.md routing row's `goTo` points at `workspaces/<slug>/`.
- **Requirements:** R3, R10, R17.
- **Dependencies:** U2 (survey confirms no other writer creates subagent folders at flat paths).
- **Files:**
  - `packages/api/workspace-files.ts` (`handleCreateSubAgent` ~line 1326)
  - `packages/api/src/lib/workspace-map-generator.ts` (slug-extractor regex at line 731-733: `^([^/.][^/]*)\/CONTEXT\.md$` must become `^workspaces\/([^/.][^/]*)\/CONTEXT\.md$` or accept both during transition)
  - `packages/api/workspace-files.ts` `isReservedFolderSegment` — confirm `workspaces` is in the reserved list; add if missing.
  - `packages/api/src/lib/reserved-folder-names.ts` — TS source of truth for the reserved set; add `workspaces` here.
  - `packages/agentcore/agent-container/agents_md_parser.py` — Python `RESERVED_FOLDER_NAMES` frozenset; add `"workspaces"` in lockstep (the TS module's comment block documents this cross-language parity contract).
- **Approach:** Update the `target.key()` construction in `handleCreateSubAgent` to prefix `workspaces/` for the subagent's CONTEXT.md path. Routing-row `goTo` written into AGENTS.md becomes `workspaces/${cleanSlug}/`. For one deploy cycle the slug-extractor regex accepts BOTH `<slug>/CONTEXT.md` AND `workspaces/<slug>/CONTEXT.md` so legacy flat-storage subagents still resolve; after Phase 5 migration, the regex tightens to require the `workspaces/` prefix.
- **Patterns to follow:** Existing slug normalization + uniqueness check inside `handleCreateSubAgent`.
- **Test scenarios:**
  - Covers AE4. Creating a new subagent with slug `report-builder` lands at `tenants/<t>/agents/<a>/workspace/workspaces/report-builder/CONTEXT.md` (not flat).
  - The AGENTS.md routing table gains a row with `goTo` = `workspaces/report-builder/`.
  - Creating a subagent with slug `workspaces` is rejected (reserved name).
  - During transition: editing an existing flat-storage subagent's CONTEXT.md (`<slug>/CONTEXT.md`) still works; the regex resolves it; AGENTS.md regen lists it correctly.
- **Verification:** Existing `handleCreateSubAgent` tests pass with adjusted path expectations. Integration: GraphQL `createSubAgent` mutation produces the new path.

### U7. vendor-path-normalizer rewrites to `workspaces/<slug>/`

- **Goal:** FOG/FITA/Codex/Gemini agent bundle imports normalize `.claude/agents/X/`, `.codex/agents/X/`, `.gemini/agents/X/` (and any others currently rewriting to flat `X/`) to `workspaces/X/`. Imports from vendor folder structures land in the new layout from the start.
- **Requirements:** R10.
- **Dependencies:** U6 (writer convention established).
- **Files:**
  - `packages/api/src/lib/vendor-path-normalizer.ts` (`RULES` ~line 33-50)
  - `packages/api/src/lib/__tests__/vendor-path-normalizer.test.ts`
- **Approach:** Update each of the four `to:` callback returns from `match[1] ?? ""` to `` `workspaces/${match[1] ?? ""}` ``. Test fixtures update accordingly.
- **Patterns to follow:** Existing rule shape.
- **Test scenarios:**
  - Importing `.claude/agents/sql/CONTEXT.md` normalizes to `workspaces/sql/CONTEXT.md`.
  - Importing `.codex/agents/finance-analyst/skills/snowflake/SKILL.md` normalizes to `workspaces/finance-analyst/skills/snowflake/SKILL.md`.
  - Non-agent vendor paths (e.g., `.claude/skills/foo/` → `skills/foo/` rule from prior R7 work) are unaffected.
- **Verification:** Existing `vendor-path-normalizer.test.ts` passes with adjusted expectations.

### U8. apps/admin FolderTree retires synthetic `agents/` grouping

- **Goal:** `apps/admin/src/components/agent-builder/FolderTree.tsx`'s `buildWorkspaceTree` stops synthesizing the `__synthetic__/sub-agents` node grouping routed top-folders under an `agents/` label. The file tree shows the actual `workspaces/` folder (rendered like any other top-level folder).
- **Requirements:** R11.
- **Dependencies:** U6, U7 (so subagents actually live at `workspaces/<slug>/` before the UI exposes the real path).
- **Files:**
  - `apps/admin/src/components/agent-builder/FolderTree.tsx` (`buildWorkspaceTree` line 49; synthetic node lines 99-143)
  - `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts`
- **Approach:** Delete the routed-top-folder grouping logic (lines 99-128); delete the synthetic node construction (lines 130-143); remove `SUB_AGENTS_NODE_PATH` references (~line 511-512) and the `canMutate` guard for synthetic nodes (synthetic nodes no longer exist). The renderer falls through to the standard recursive-tree shape.
- **Patterns to follow:** Existing recursive tree-building in the same file.
- **Test scenarios:**
  - Covers AE4. Given a tenant agent workspace with `workspaces/sql/` and `workspaces/finance-analyst/`, when FolderTree renders, then the file tree shows `workspaces/` as a real top-level folder containing `sql/` and `finance-analyst/` as children — NOT a synthetic `agents/` group.
  - Right-clicking the `workspaces/` folder offers the same context menu as any other folder (no special-case synthetic behavior).
  - Existing flat-storage subagents (during transition) render at their actual flat paths until migration moves them.
- **Verification:** FolderTree.test.ts assertions about `__synthetic__/sub-agents` are removed; new assertions cover the real `workspaces/` rendering.

### U9. Slug-extractor regex transition mode in workspace-map-generator

- **Goal:** During Phase 3 (before migration), `regenerateAgentsMdDerivedSections`'s `## Folder Structure` and slug-extractor logic accept BOTH legacy flat (`<slug>/CONTEXT.md`) AND new nested (`workspaces/<slug>/CONTEXT.md`) layouts. After Phase 5 migration completes, this tolerance can tighten (handled in U24).
- **Requirements:** R3, R10.
- **Dependencies:** U6.
- **Files:**
  - `packages/api/src/lib/workspace-map-generator.ts` (slug regex line 731-733; folder-structure renderer)
- **Approach:** Update the slug-extractor regex to a union pattern: `^(?:workspaces\/)?([^/.][^/]*)\/CONTEXT\.md$`. The folder-structure renderer detects the `workspaces/` prefix and renders the tree accordingly (showing `workspaces/` as a parent when the new layout is in use). Add a small helper `getSubagentSlugFromPath(path: string): string | null` and use it everywhere the regex is applied today (`rg "CONTEXT\\.md\\$" packages/api/src/`).
- **Patterns to follow:** Existing regex usage in `workspace-map-generator.ts`.
- **Test scenarios:**
  - Both legacy (`sql/CONTEXT.md`) and new (`workspaces/sql/CONTEXT.md`) paths resolve to slug `sql`.
  - The rendered `## Folder Structure` correctly nests subagents under `workspaces/` when the new layout is in use; renders flat when legacy layout is in use.
  - Mixed tenants (some subagents migrated, some not) render correctly without ordering glitches.
- **Verification:** New unit test covers both path shapes; existing AGENTS.md regen tests pass.

---

### Phase 4: AGENTS.md regen update

### U7'. Collapse derived sections to two; switch Skills & Tools to tree-walk

(Renumbered as U7 in Phase 4 — this is a distinct unit from U7 vendor-path-normalizer. See U-ID stability note below.)

> **U-ID note:** The brainstorm's R7 vs the vendor-path-normalizer share a number conflict only by coincidence; the plan's U7 is the vendor-path-normalizer. Reading-order skipped to avoid renumber. This unit becomes U7b in the rendered order to preserve stability:

### U7b. Collapse AGENTS.md derived sections to two; switch Skills & Tools to tree-walk

- **Goal:** `regenerateAgentsMdDerivedSections` (and the underlying `replaceDerivedAgentsMdSections` / `renderDerivedAgentsMdSections`) produce exactly two derived sections: `## Folder Structure` (already tree-walk-derived) and `## Skills & Tools` (switched from `agent_skills` DB read to tree-walk). `## Knowledge Bases` and `## Workflows` sections are dropped from the derivation output.
- **Requirements:** R7, R7a.
- **Dependencies:** U3 (new AGENTS.md template has the expected section structure), U6 (subagents under `workspaces/`).
- **Files:**
  - `packages/api/src/lib/workspace-map-generator.ts` (`DerivedSectionName` union ~line 110-121; `regenerateAgentsMdDerivedSections` ~line 1142; `renderDerivedAgentsMdSections`)
  - `packages/api/src/lib/skills-tree-walker.ts` (new — port `discoverWorkspaceSkills` logic from Pi runtime)
  - `packages/api/src/lib/__tests__/workspace-map-generator.test.ts`
- **Approach:** Update `DerivedSectionName` union to `'Folder Structure' | 'Skills & Tools'`; `DERIVED_SECTION_ORDER` becomes those two. `## Skills & Tools` renderer switches from the existing DB query (lines 907-918) to calling a new `skills-tree-walker.ts` module that recursively walks `master/skills/<slug>/SKILL.md` and `master/workspaces/<slug>/skills/<slug>/SKILL.md` (recursively for sub-subagents), reading SKILL.md frontmatter for `display_name` and `description`. Drop the KB and Workflows derivation code entirely (or comment-archive for one cycle).
- **Patterns to follow:** Pi runtime's `discoverWorkspaceSkills` at `packages/agentcore-pi/agent-container/src/runtime/tools/workspace-skills.ts` is the reference implementation; port the depth-traversal + frontmatter-parsing logic to TS server-side.
- **Test scenarios:**
  - Covers AE2. Given a tenant agent with `master/skills/web-search/SKILL.md` and `master/workspaces/sql/skills/snowflake/SKILL.md`, when `regenerateAgentsMdDerivedSections` runs, then the rendered `## Skills & Tools` lists both skills (each annotated with its scope: baseline vs subagent path), and no `## Knowledge Bases` or `## Workflows` section is rendered.
  - Editing a SKILL.md frontmatter (`display_name` change) and saving triggers `regenerateAgentsMdDerivedSections`; the `## Skills & Tools` row reflects the new display name on next render.
  - Hand-authored AGENTS.md sections (`## What This Is`, `## Personality`, etc.) round-trip byte-identical through regen.
  - Mixed tenants (some skills, no KBs, no workflows) render correctly with no orphan empty sections.
- **Verification:** Existing `workspace-map-generator.test.ts` updates with new section expectations. The 2026-05-23 editor-regen brainstorm's parser test suite passes against the new 2-section world.

### U8b. Drop `## Knowledge Bases` and `## Workflows` rendering helpers

- **Goal:** Helper functions `renderKnowledgeBasesSection` and `renderWorkflowsSection` (or equivalent — exact names per `workspace-map-generator.ts` line 921-976) are deleted along with their DB query code. The DB queries reading `agent_knowledge_bases` and `routines` for AGENTS.md rendering stop being issued on every editor save.
- **Requirements:** R7a.
- **Dependencies:** U7b.
- **Files:**
  - `packages/api/src/lib/workspace-map-generator.ts`
- **Approach:** Mechanical removal of two helper functions and their two DB queries. Any other callers of the same DB queries (rg "agent_knowledge_bases", rg "routines.join.tenant_workflow_catalog") are out of scope for this unit and continue working — only the AGENTS.md derivation stops using them.
- **Test scenarios:**
  - Editing any file in a tenant with KBs assigned no longer issues an `agent_knowledge_bases` SELECT on AGENTS.md regen.
  - Editing any file in a tenant with active routines no longer issues a `routines` SELECT on AGENTS.md regen.
- **Verification:** DB query log on the integration test environment shows zero `agent_knowledge_bases` or `routines` queries during a 100-editor-save burst.

---

### Phase 5: Per-tenant migration

### U21. Per-tenant migration script (Plan-B 4-step contract)

- **Goal:** A new admin-invokable script `pnpm thinkwork:migrate-folder-canon --stage <stage> [--tenant <slug>] [--dry-run | --apply | --repair]` that, per tenant, (1) reads the four legacy files' content from S3; (2) composes them into the named sections of the tenant's `AGENTS.md` (preserving any operator-customized content as `<!-- migrated from <FILENAME>.md on YYYY-MM-DD -->`-tagged regions); (3) writes the updated `AGENTS.md`; (4) moves any flat-storage subagent folders (`<slug>/CONTEXT.md`) to `workspaces/<slug>/CONTEXT.md`; (5) verifies all writes landed before returning success. **The legacy files are NOT deleted in this run** — deletion is U24's second pass after the loaders cut over.
- **Requirements:** R18, R18a.
- **Dependencies:** U3, U5 (so the new template + bootstrap exclusion are in place), U6, U7, U9 (writer + importer + regex transition support).
- **Files:**
  - `packages/cli/src/commands/migrate-folder-canon.ts` (new)
  - `packages/cli/src/lib/migrations/folder-canon-migrator.ts` (new — the per-tenant migration logic)
  - `packages/cli/src/lib/migrations/__tests__/folder-canon-migrator.test.ts`
- **Approach:** Mirror Plan-B's autopilot sequencing pattern from `docs/solutions/workflow-issues/platform-agent-space-runtime-refactor-autopilot-sequencing-2026-05-23.md`. Single-tenant entry point operates in five modes: `--dry-run` (read S3, compose target state, print diff, exit 0 with no writes), `--apply` (write changes — idempotent: if AGENTS.md already has the named sections, leave them; if subagents already at `workspaces/<slug>/`, leave them), `--repair` (same as `--apply` but explicitly intended for partial-failure re-runs), `--noop-check` (assert no changes needed; exit nonzero if any changes would land). For multi-tenant runs, the orchestrating CLI iterates tenants and dispatches each one independently — a failure on tenant N does NOT block tenants M..M+k.
- **Execution note:** Test the migrator against a snapshot of a real dev tenant's S3 tree before any prod-side invocation. Add a `--snapshot <s3-prefix>` mode that operates on a copied prefix (read+write) without touching the live tenant.
- **Patterns to follow:** `migrate-collapse-agents.ts` from Plan B (referenced in the 2026-05-23 learning) for the dry-run / apply / repair / noop pattern.
- **Test scenarios:**
  - Covers AE1, AE4. Given a tenant with the legacy 4-file layout and flat-storage subagents `master/sql/` and `master/finance-analyst/`, when the migrator runs in `--apply` mode, then the AGENTS.md gains `## Personality`, `## Identity`, `## Platform Behavior` sections populated from the legacy files; the subagent folders land at `master/workspaces/sql/` and `master/workspaces/finance-analyst/`; the AGENTS.md routing rows get rewritten to point at `workspaces/<slug>/`.
  - Running `--apply` a second time on a fully-migrated tenant produces no writes (idempotent).
  - Running `--noop-check` against a fully-migrated tenant exits 0; against a partially-migrated tenant exits nonzero with a list of pending operations.
  - Given a tenant whose `SOUL.md` has operator-customized content (differs from workspace-defaults seed), when migration runs, then the customized content is preserved verbatim inside the new `## Personality` section bounded by a `<!-- migrated from SOUL.md on 2026-05-24 -->` breadcrumb.
  - Mid-flight failure (S3 write error after AGENTS.md write but before subagent moves) leaves the tenant in a consistent intermediate state where `--repair` completes the move.
- **Verification:** Migrator tests against snapshot S3 prefixes confirm the four success scenarios + the failure-recovery path. Dev-stage end-to-end: pick one dev tenant, run `--dry-run`, review diff, run `--apply`, verify the tenant tree matches the target shape; run `--noop-check` and confirm exit 0.

---

### Phase 6: System-prompt loaders (Pi + Strands lockstep)

### U15. Pi system-prompt loader updates PROMPT_FILES + R8a no-user path

- **Goal:** `packages/agentcore-pi/agent-container/src/runtime/system-prompt.ts`'s `PROMPT_FILES` collapses to the pinned order `[AGENTS.md, CONTEXT.md, GUARDRAILS.md, SPACE.md, USER.md]`. SOUL/IDENTITY/PLATFORM/MEMORY_GUIDE/TOOLS reads drop (CAPABILITIES already dropped on 2026-05-24 per the existing comment). The no-invoking-user composition path (R8a) omits USER.md entirely without synthesizing a service-account placeholder.
- **Requirements:** R8, R8a, R20.
- **Dependencies:** U3 (consolidated AGENTS.md template in place), U21 (per-tenant migration completed so AGENTS.md actually has the absorbed sections).
- **Files:**
  - `packages/agentcore-pi/agent-container/src/runtime/system-prompt.ts` (PROMPT_FILES ~line 37-47; reading-order comment block ~line 11-36)
  - `packages/agentcore-pi/agent-container/src/runtime/__tests__/system-prompt.test.ts`
- **Approach:** Reorder PROMPT_FILES to match origin R8 exactly. Drop `SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, `MEMORY_GUIDE.md`, `TOOLS.md` from the array. Update the comment block to reflect the new order and reading-order rationale. Add a no-user branch in the loader: when the invocation env has no user, skip USER.md (don't synthesize a default).
- **Execution note:** This unit ships in lockstep with U16 (Strands). Do NOT merge U15 before U16 — the AgentCore DEFAULT endpoint cannot be flushed (per `project_agentcore_default_endpoint_no_flush`), and a 15-minute mismatch window where Pi reads new order but Strands reads old order is the worst case.
- **Patterns to follow:** The existing PROMPT_FILES frozen-array shape; the `discoverWorkspaceSkills` walker for the unchanged capability-discovery path.
- **Test scenarios:**
  - Covers AE3. Given a tenant with the post-migration layout, when the Pi runtime builds the system prompt for an invocation with an active Space and an invoking user, then files are loaded in order: AGENTS.md, CONTEXT.md, GUARDRAILS.md, spaces/<slug>/SPACE.md (the post-migration path), USER.md.
  - Given an A6 automation invocation (no user), the system prompt builder skips USER.md entirely; no service-account substitute appears.
  - Given a tenant whose SOUL.md / IDENTITY.md / PLATFORM.md still exist (migration hasn't run for this tenant), those files are NOT loaded — only the new five-file canon is consulted. The Pi loader is forward-compatible with both layouts.
- **Verification:** Pi unit tests verify the new order. Container-rebuild + AgentCore reconciler sweep confirm both runtimes pick up the change in the same deploy window.

### U16. Strands system-prompt loader mirrors Pi

- **Goal:** `packages/agentcore-strands/agent-container/container-sources/server.py`'s `_build_system_prompt` updates the hard-coded file list at lines 423-433 to match Pi's new PROMPT_FILES order. The container-bundled `SYSTEM_WORKSPACE_DIR` sources for GUARDRAILS / PLATFORM / MEMORY_GUIDE need re-pointing — GUARDRAILS stays workspace-resident, PLATFORM content moves into the workspace AGENTS.md (drop the container-bundled PLATFORM.md import). Strands' profile-aware path at lines 394-410 inspects `profile.load` from `router_parser.expand_file_list` — sweep that mechanism for references to the four retired filenames.
- **Requirements:** R8, R8a, R20.
- **Dependencies:** U15 (Pi reference order); U21 (migration so tenant AGENTS.md has absorbed sections).
- **Files:**
  - `packages/agentcore-strands/agent-container/container-sources/server.py` (lines 381-460)
  - `packages/agentcore/agent-container/router_parser.py` (profile-aware path; copied into the Strands container at build time per `packages/agentcore-strands/agent-container/Dockerfile`)
  - `packages/agentcore-strands/agent-container/test_server.py` (or equivalent test path)
- **Approach:** Update the hard-coded `(filename, base_dir)` list to the new five-file canon. Switch GUARDRAILS to read from `WORKSPACE_DIR` (no longer container-bundled). Drop PLATFORM and MEMORY_GUIDE container-bundled paths from `SYSTEM_WORKSPACE_DIR`-sourced reads — PLATFORM content moves to AGENTS.md sections. Profile-aware path sweep: if `profile.load` references include the retired filenames, update them or remove (research output flagged this as needing investigation).
- **Execution note:** Ships in lockstep with U15. Post-deploy SHA check confirms both Pi and Strands container images pulled the new code before declaring rollout complete.
- **Patterns to follow:** The Pi-side comment ("Strands `_build_system_prompt` mirrors this order — keep them in sync when editing") is the parity contract.
- **Test scenarios:**
  - Same as U15, executed via Strands test harness. Reading order matches Pi exactly.
  - GUARDRAILS.md is read from WORKSPACE_DIR (tenant's workspace), not from SYSTEM_WORKSPACE_DIR (container bundle).
  - Profile-aware invocations using `profile.load` do not crash on missing retired filenames.
- **Verification:** Strands tests + AgentCore reconciler sweep + smoke test (one chat invocation per runtime) confirm both runtimes read the same file set in the same order.

---

### Phase 7: Memory teardown + agent_skills switchover

### U17. Strands memory_tools.py per-Space bank teardown

- **Goal:** Revert `_hindsight_recall_bank_ids` (line 94-101) to user-bank-only — drop the `space_${space_id}` append. Drop `_resolve_hindsight_write_bank_id` (line 104+) scope='space' routing — all writes go to user bank. Remove `active_space_*` from `_load_invocation_env` snapshot wiring.
- **Requirements:** R15.
- **Dependencies:** U2 (survey identifies all Space-bank read/write sites), U21 (post-migration tenants are running the new layout).
- **Files:**
  - `packages/agentcore-strands/agent-container/container-sources/memory_tools.py`
  - `packages/agentcore-strands/agent-container/container-sources/invocation_env.py`
  - `packages/agentcore-strands/agent-container/container-sources/server.py` (active*space*\* env threading)
  - `packages/agentcore-strands/agent-container/container-sources/run_skill_dispatch.py` (active*space*\* threading)
  - `packages/agentcore-strands/agent-container/test_memory_tools_space_scope.py` (delete or rewrite as negative-assertion test)
  - `packages/agentcore-strands/agent-container/test_memory_tools_user_scope.py` (continues to pass)
- **Approach:** Mechanical removal of the space-bank code branches. Snapshot the prior state in `test_memory_tools_space_scope.py` and rewrite as a "Space-bank should NOT be consulted" assertion (proves the teardown landed). Remove `active_space_id`, `active_space_slug`, `active_space_is_default` from the env-snapshot reads.
- **Patterns to follow:** The existing user-bank-only path is the reference shape.
- **Test scenarios:**
  - Covers AE6. Given a turn in the `finance` Space with invoking user `eric`, when the agent calls `remember("Q3 close deadline is Sept 30")`, then the fact writes to Eric's user bank only; no Space-bank write occurs.
  - Given a subsequent turn in `finance` Space with invoking user `alice`, when she calls `recall("Q3 close")`, then recall fans only over Alice's user bank — the prior `eric`-authored fact does NOT appear.
  - `_load_invocation_env`'s returned snapshot no longer contains `active_space_id` / `active_space_slug` / `active_space_is_default` keys.
- **Verification:** `pytest packages/agentcore-strands/agent-container/test_memory_tools_*.py` passes with new assertions. Smoke: a multi-player Space thread confirms the cross-thread isolation behavior matches the brainstorm's deferred-to-v1.5 stance.

### U18. API hindsight-adapter.ts drops space bank-id branch

- **Goal:** `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`'s bank-id resolution (line 607-609) drops the `space_${spaceId}` branch. User-bank-only resolution for all reads/writes.
- **Requirements:** R15.
- **Dependencies:** U17.
- **Files:**
  - `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`
  - `packages/api/src/lib/memory/adapters/__tests__/hindsight-adapter.test.ts`
- **Approach:** Mechanical: delete the `space_${spaceId}` branch and its callers. Bank-id resolution becomes `user_${userId}` only.
- **Test scenarios:**
  - Recall/remember calls with an active Space context resolve to the user bank id regardless of Space.
  - Calls with no Space context (default Space) also resolve to the user bank id (matches prior default-Space behavior).
- **Verification:** Adapter tests pass with the simplified resolution.

### U19. Deprovision dev-side per-Space Hindsight banks

- **Goal:** Any `space_<slug>` Hindsight banks that were provisioned in dev/test against AgentCore Memory get deprovisioned. Document orphans (if AgentCore Memory deprovisioning is restricted) and accept the cost.
- **Requirements:** R15.
- **Dependencies:** U17, U18 (code path removed before infra deprovisioning).
- **Files:**
  - `packages/cli/src/commands/cleanup-space-hindsight-banks.ts` (new — admin script)
- **Approach:** AWS SDK call enumerates AgentCore Memory banks for the tenant; filters by `space_*` prefix; calls the appropriate delete API. Dry-run mode lists banks without deleting.
- **Test scenarios:**
  - Test expectation: none — admin tooling without behavioral test surface beyond integration. Manual smoke against dev AgentCore Memory.
- **Verification:** After running, `aws bedrock-agentcore-control list-memory-banks` against dev returns zero `space_*` banks.

### U20. resolve-agent-runtime-config switchover to tree-walk

- **Goal:** `packages/api/src/lib/resolve-agent-runtime-config.ts`'s `skillsConfig` assembly (~line 412) stops reading `agent_skills` DB and instead calls the same tree-walker introduced in U7b (`packages/api/src/lib/skills-tree-walker.ts`). This is the hot path — every agent invocation hits it.
- **Requirements:** R7.
- **Dependencies:** U7b (tree-walker exists), U21 (migrated tenant layout).
- **Files:**
  - `packages/api/src/lib/resolve-agent-runtime-config.ts`
  - `packages/api/src/lib/__tests__/resolve-agent-runtime-config.test.ts`
- **Approach:** Replace the `agent_skills` SELECT and join with a call to `discoverAgentSkills(workspacePrefix)` (the tree-walker). Cache aggressively at the renderer-prefix-mtime level if performance is a concern — the rendered prefix has a `.rendered_at` marker the renderer maintains.
- **Patterns to follow:** Pi runtime's `discoverWorkspaceSkills` is the reference; U7b ports it server-side.
- **Test scenarios:**
  - An agent with SKILL.md files at `master/skills/web-search/` and `master/workspaces/sql/skills/snowflake/` has runtime config exposing both skills as registered tools.
  - Adding a new SKILL.md file via the editor immediately reflects in the next runtime invocation (no DB lag).
  - Removing a SKILL.md file removes the skill from runtime config.
- **Verification:** Existing `resolve-agent-runtime-config` tests pass with tree-walk expectations. Smoke: invoking an agent with a known skill confirms tool registration via the tree-walker path.

### U22. derive-agent-skills.ts retirement coordination

- **Goal:** `packages/api/src/lib/derive-agent-skills.ts` becomes a no-op (or is deleted) once both readers (U7b and U20) no longer consume `agent_skills`. The `workspace-files.ts` editor write path stops calling it. Final DB table removal is coordinated with the cleanup-catalog brainstorm (`docs/brainstorms/2026-05-24-codebase-and-database-simplification-cleanup-requirements.md`).
- **Requirements:** R7 (downstream).
- **Dependencies:** U7b, U20.
- **Files:**
  - `packages/api/src/lib/derive-agent-skills.ts`
  - `packages/api/workspace-files.ts` (drop calls to derive-agent-skills at lines 1173, 1456, 1539, 1604)
- **Approach:** Inline the function body deletion; remove the calls from `workspace-files.ts`. The `agent_skills` table itself stays in the DB schema until the cleanup-catalog brainstorm's plan removes it (per brainstorm Scope Boundaries).
- **Patterns to follow:** Existing call-site removal patterns in `workspace-files.ts`.
- **Test scenarios:**
  - Saving a SKILL.md file no longer issues an INSERT/UPDATE against `agent_skills`.
  - Deleting a SKILL.md file no longer issues a DELETE against `agent_skills`.
- **Verification:** DB query log on integration test confirms zero `agent_skills` writes during editor-save bursts.

---

### Phase 8: Cleanup + verification

### U23. Editor-layer rejection for capability-additive files inside Space trees (AE5)

- **Goal:** `packages/api/workspace-files.ts` rejects create/move actions that would land `skills/<...>`, `TOOLS.md`, or `MCP.md` paths inside a `spaces/<slug>/` prefix. The rejection surface follows the existing `isProtectedOrchestrationWritePath` pattern at line 1009.
- **Requirements:** R12, R13, R22.
- **Dependencies:** U10 (Model A renderer behavior in place).
- **Files:**
  - `packages/api/workspace-files.ts` (extend `isProtectedOrchestrationWritePath` or add a sibling check)
  - `packages/api/src/lib/__tests__/workspace-files.test.ts`
- **Approach:** Add a path-pattern check: when `target.kind === 'space'` and the path matches `^skills/` or `^TOOLS\.md$` or `^MCP\.md$`, reject the action with a typed error explaining capability files belong in `master/workspaces/`. UX behavior: file-tree context menu suppresses the creatable-name list to exclude these names when right-clicking inside a Space tree (Open Question D2 — UX choice deferred to implementer judgment per the brainstorm).
- **Patterns to follow:** Existing `isProtectedOrchestrationWritePath` + 403 emission pattern.
- **Test scenarios:**
  - Covers AE5. Given a Space `finance`, when a Space author attempts to create `spaces/finance/skills/foo/SKILL.md`, then the editor returns a 403 with a typed error pointing to `master/workspaces/`.
  - Same for `spaces/finance/TOOLS.md` and `spaces/finance/MCP.md`.
  - Creating `spaces/finance/knowledge/cap-table.md` or editing `spaces/finance/SPACE.md` continues to work (these aren't capability-additive).
- **Verification:** Existing workspace-files tests pass; new test scenarios for rejection paths.

### U24. Final cleanup: drop legacy file content + tighten regex + delete unused merger

- **Goal:** After Phase 5 migration has run against all tenants AND Phase 6 loaders have cut over, this unit performs the final cleanup: delete `SOUL.md`, `IDENTITY.md`, `PLATFORM.md`, `CAPABILITIES.md` from `packages/workspace-defaults/files/` and remove the `SOUL_MD` / `IDENTITY_MD` / `PLATFORM_MD` / `CAPABILITIES_MD` constants from `packages/workspace-defaults/src/index.ts`. Tighten the slug-extractor regex in `workspace-map-generator.ts` to require the `workspaces/` prefix (drop the union-pattern transition tolerance from U9). Delete `tool-policy-merger.ts` (unused per U10). Second migration pass deletes the four legacy files from tenant trees.
- **Requirements:** R5, R10 (cleanup).
- **Dependencies:** U21 (migration ran), U15+U16 (loaders cut over).
- **Files:**
  - `packages/workspace-defaults/files/SOUL.md` (delete)
  - `packages/workspace-defaults/files/IDENTITY.md` (delete)
  - `packages/workspace-defaults/files/PLATFORM.md` (delete)
  - `packages/workspace-defaults/files/CAPABILITIES.md` (delete)
  - `packages/workspace-defaults/src/index.ts` (drop four constants)
  - `packages/api/src/lib/workspace-map-generator.ts` (tighten regex)
  - `packages/api/src/lib/workspace-renderer/tool-policy-merger.ts` (delete)
  - Per-tenant migration's second-pass mode (extend U21's CLI with `--cleanup-legacy-files`)
- **Approach:** Mechanical deletions + regex tightening. The migration CLI extension `--cleanup-legacy-files` runs the second pass: for each migrated tenant, verify the new AGENTS.md sections are intact, then delete the four legacy files from `master/`. Idempotent (already-cleaned-up tenants are no-ops).
- **Test scenarios:**
  - `loadFile("SOUL.md")` throws (no longer exists).
  - The slug-extractor regex rejects `<slug>/CONTEXT.md` at the top level of `master/` (only `workspaces/<slug>/CONTEXT.md` resolves).
  - Running `pnpm thinkwork:migrate-folder-canon --cleanup-legacy-files --apply` against a migrated tenant deletes the four files from S3.
- **Verification:** TS parity test passes. Integration: a fresh editor session against a fully-cleaned-up tenant has no legacy file references anywhere.

### U25. End-to-end verification + rollout sign-off

- **Goal:** Cross-cutting smoke test confirming the entire stack runs correctly after all units land: tenant-tree shape matches R17; Pi + Strands runtimes both read the new five-file canon in the pinned order; SPACE.md mentionable-workspaces filtering blocks unlisted `@`mentions; render-layer authz blocks non-member private-Space access; remember/recall use user bank only; FolderTree UI shows real `workspaces/` folder; no orphan `agent_skills` DB writes.
- **Requirements:** All applicable AEs.
- **Dependencies:** All prior units.
- **Files:**
  - `packages/api/test/integration/folder-canon-rollout.test.ts` (new — co-located with existing integration tests at `packages/api/test/integration/`)
  - Manual checklist: `docs/runbooks/folder-canon-rollout-verification-2026-05-24.md` (new)
- **Approach:** Multi-step integration test that provisions a fresh tenant, exercises each affected surface (editor save → AGENTS.md regen → renderer → Pi invocation → Strands invocation → memory tool), and asserts the expected behavior. Manual runbook covers the post-deploy SHA-check, AgentCore reconciler sweep, and dev-side smoke flow.
- **Test scenarios:**
  - Covers AE1, AE2, AE3, AE4, AE5, AE6, AE7. The E2E test exercises each AE in sequence on a freshly-provisioned tenant.
- **Verification:** E2E test passes. Manual runbook executed against dev stage; sign-off recorded as a `Verified:` line in the migration's runbook doc.

---

## Scope Boundaries

### Out of scope for this plan

- Pi skill catalog work (`docs/brainstorms/2026-05-24-pi-agent-skill-catalog-and-workspace-install-requirements.md`) is in-flight and stays as committed. The catalog's install-scope set reduces mechanically from {baseline, subagent, Space} to {baseline, subagent} as a consequence of R12/R13, but no catalog-side code changes are owned here.
- DB schema removal for `agent_skills` table — coordinated with cleanup-catalog brainstorm.
- Mobile (`apps/mobile`), CLI (`apps/cli`), or GraphQL public-API contract changes — the consolidated AGENTS.md and the `workspaces/` storage path are server-internal at the wire layer; client surfaces consume the same GraphQL/REST surfaces unchanged.
- Terraform infrastructure changes — no new Lambdas, no new S3 buckets, no IAM changes.
- Cross-tenant catalog sharing or a platform-default shared catalog above the tenant boundary.
- Customer-onboarding Space workflow (`spaces.kind = 'customer_onboarding'`) — separate workstream.

### Deferred to Follow-Up Work

- Cross-thread shared Space memory (origin R16) — deferred to v1.5 with two reserved paths (Space `memory/` folder OR re-added per-Space Hindsight bank). This plan implements the per-user-only memory model; the v1.5 design space stays open.
- Thread message export, Hindsight memory export, "export a tenant tree to local Claude Code" tooling — out of v1 per the floor-B portability commitment.
- The 11 deferred Open Questions appended to the brainstorm's `## Deferred / Open Questions` section: customer-onboarding workstream verification (P1), Hindsight drop cross-thread stress-test (P1), Space `knowledge/` reading-order position (P1), editor rejection UX choice (P1), reading order vs portability tradeoff (P2), mechanical migration caveat scope (P2), markdown-encoded capability gating vs render-layer enforcement (P2 — partially resolved by U12's render-time enforcement), AGENTS.md editor affordance for derived sections (P2), bootstrap SPACE.md template content (P2), email security re-specification (P2), A6 trust boundary specifics (P2 — partially resolved by U13's render-side gate).
- AGENTS.md hand-authored section editor affordance (D4 from review) — visual distinction between derived and hand-authored regions in the admin SPA editor. Deferred to a separate admin UX brainstorm.
- Per-tenant email security re-specification (S2 from review) — the 2026-05-22 brainstorm's R26–R31 email controls remain normative until either inlined here in a follow-up PR or explicitly preserved by a Scope-Boundary entry in the alignment doc.

### Outside this product's identity

- (None — this plan is consolidation and migration, not product-shape change. The brainstorm already addressed identity-level decisions.)

---

## Risks & Dependencies

### Risks

- **AgentCore DEFAULT endpoint mismatch window.** Pi and Strands runtime images cannot be flushed on demand; the 15-minute reconciler is the only flush. If U15 and U16 ship in different deploys, there is up to a 15-minute window where one runtime reads the new layout and the other reads the old. **Mitigation:** U15 and U16 ship in lockstep (same PR or back-to-back PRs merged within a single deploy window); post-deploy SHA-check confirms both images updated.
- **Migration content-merge drift.** Tenants who have hand-edited SOUL/IDENTITY/PLATFORM/CAPABILITIES to differ from `workspace-defaults` seeds will have their customizations migrated as breadcrumb-tagged blocks. Operators may want different framing (e.g., merge into existing prose rather than as a tagged block). **Mitigation:** dry-run mode renders the proposed AGENTS.md per tenant; reviewer signs off on the diff before applying. The migration is per-tenant rollback-able.
- **Render-layer authz adds latency to every private-Space invocation.** R19a's `space_members` DB query fires on every renderer call. **Mitigation:** Cache the membership check at the renderer-prefix-mtime level; invalidate on `space_members` changes via the existing invalidation mechanism in the renderer.
- **Tree-walk derivation cost.** R7's switch from `agent_skills` DB read to S3 tree walk runs on every editor save AND every runtime invocation. At enterprise scale (400+ agents × ~50 SKILL.md each = 20,000 SKILL.md files per tenant), naive tree walk is slow. **Mitigation:** Cache aggressively at the renderer-prefix `.rendered_at` marker level — the renderer already maintains it; the skills tree walker piggybacks on the same invalidation signal.
- **Per-Space Hindsight teardown leaves orphan banks in dev.** AgentCore Memory may not support bank deletion via the standard delete API. **Mitigation:** U19 dry-runs the deprovisioning; if deletion is restricted, document orphans and accept the cost (banks have no read traffic post-U17/U18).
- **`agent_skills` DB stays in the schema after this plan.** Until cleanup-catalog brainstorm's plan removes it, the column types and FK references remain — any future migration referencing `agent_skills` must coordinate with this plan's downstream.
- **2026-04-26 UI-fabrication reversal risk.** The original decision (`docs/solutions/conventions/admin-trim-ui-preserve-backend-mutations-2026-05-13.md`) warned that for data-driven UI, keep the parser even when the authoring widget is gone. **Mitigation:** The reversal is justified because the storage change now does operator-facing work (R10's `workspaces/` is the operator-edited surface, and R19a's render-layer authz depends on storage-path-prefix matching). Documented in the canonical brainstorm's Key Decisions; re-validated here.

### Dependencies

- The per-tuple workspace renderer (`compose-tuple.ts`) must be present and wired into `chat-agent-invoke` (verified — already in place per Phase 1 research).
- The 2026-05-23 editor-driven AGENTS.md regen brainstorm's section-boundary parser must handle arbitrary `##` headings (verified — current implementation iterates `DERIVED_SECTION_ORDER` and is data-driven for hand-authored sections).
- AgentCore Memory bank provisioning API for U19's deprovisioning step — confirm AWS SDK support before scheduling U19.
- The Pi skill catalog brainstorm's `discoverWorkspaceSkills` walker (`packages/agentcore-pi/agent-container/src/runtime/tools/workspace-skills.ts`) is the reference implementation for the server-side port in U7b — depends on its current shape.

---

## Verification & Rollout

### Pre-merge verification per unit

Each unit's `Verification` field defines its acceptance criteria. The orchestrating verification posture:

- All TypeScript packages: `pnpm -r --if-present typecheck && pnpm -r --if-present lint && pnpm -r --if-present test`
- Python packages: `uv run pytest packages/agentcore-pi/agent-container/ packages/agentcore-strands/agent-container/`
- workspace-defaults parity: `pnpm --filter @thinkwork/workspace-defaults test`
- Migration script: `pnpm thinkwork:migrate-folder-canon --stage dev --dry-run` against at least one dev tenant; reviewer sign-off on diff before `--apply`

### Rollout sequence (PR order, suggested)

1. **PR 1 — U1, U2:** Supersession header edits + consumer survey. Pure documentation; no runtime impact.
2. **PR 2 — U3, U4, U5:** workspace-defaults substrate. PINNED_FILES + GOVERNANCE collapse. Bootstrap update. Tests pass; no tenant impact yet.
3. **PR 3 — U10, U11, U12:** Renderer Model A simplification + SPACE.md parser + render-layer authz. Renderer behavior changes but legacy tenants still have full file sets so reads continue working.
4. **PR 4 — U6, U7, U9:** Storage layout writer + importer + regex transition. New subagent creates land at `workspaces/<slug>/`; legacy flat-storage subagents continue to resolve via union regex.
5. **PR 5 — U8:** FolderTree UI fabrication retirement. Admin UI surface change; deploy with PR 4 if possible.
6. **PR 6 — U7b, U8b:** AGENTS.md regen update. Skills & Tools tree-walk; KB + Workflows drop. Editor saves continue working with new section set.
7. **PR 7 — U21:** Migration script. Lands but does NOT run yet; sit unmerged until pre-flight dev verification confirms it does what it should.
8. **DEV STAGE GATE:** Run U21's `--dry-run` against one dev tenant; reviewer signs off; run `--apply`; verify; run `--noop-check`; sign off. THEN proceed.
9. **PR 8 — U15, U16 (lockstep):** Pi + Strands system-prompt loader updates. Ship in same PR if container builds allow it; if separate PRs, merge within the same deploy window. Post-deploy SHA-check confirms both runtimes updated.
10. **PR 9 — U17, U18, U19, U20, U22:** Memory teardown + agent_skills switchover. Code-only changes; dev-side bank deprovisioning runs manually.
11. **PR 10 — U23:** Editor-layer rejection for Space-scoped capability files.
12. **DEV STAGE GATE:** Smoke test full stack against dev. Confirm AE1–AE7 all pass.
13. **PR 11 — U24:** Final cleanup. Delete legacy file content from workspace-defaults; tighten regex; delete `tool-policy-merger.ts`; migration second-pass deletes the four legacy files from tenant trees.
14. **PR 12 — U25:** E2E verification + runbook.

### Production rollout

- Per `feedback_merge_prs_as_ci_passes`, merge each PR as CI passes; dev-stage deploy is the E2E validation loop.
- AgentCore image rebuilds: confirm both Pi and Strands containers pull the updated code in the same reconciler sweep before declaring rollout complete (per `project_agentcore_default_endpoint_no_flush`).
- Production migration (when prod exists): run U21 in `--dry-run --tenant <slug>` against each prod tenant first; reviewer sign-off; then `--apply --tenant <slug>` one at a time with 5-minute observation window between tenants.

---

## Outstanding Questions

### Resolve Before Planning

- None remaining. The supersession-tracking question from the origin doc is converted to U1 (planning-owned work).

### Deferred to Planning

- [Affects U6][Technical] Whether `isReservedFolderSegment` currently includes `workspaces` — needs verification by reading `packages/api/workspace-files.ts` to confirm. Add if missing.
- [Affects U15, U16][Technical] The Strands profile-aware path's `profile.load` mechanism — research output flagged this as needing investigation. Sweep references during U16 implementation; update or remove as needed.
- [Affects U19][Needs research] AgentCore Memory bank deprovisioning API support — confirm before scheduling U19. If unsupported, document orphans as acceptable cost.
- [Affects U21][Technical] Migration script's interaction with the in-flight 2026-05-23 S3 HITL substrate removal brainstorm — both touch workspace-events / dispatcher paths. If HITL removal merges before U21 runs, the migration inherits a cleaner surface. If after, the migration may need to coordinate with S3-event handlers that fire on the migrated paths.
- [Affects U23][Design] Editor UX for Space-scoped capability rejection — option (a) suppress menu vs option (b) inline error. Implementer's call per the brainstorm's Open Question D2; this plan does not pre-decide.
- [Affects U7b][Technical] Tree-walk depth limit and ordering for the rendered `## Skills & Tools` section — top-down breadth-first vs alphabetical. Implementer's call.
