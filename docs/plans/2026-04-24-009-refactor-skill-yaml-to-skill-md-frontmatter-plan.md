---
title: "refactor(skill-catalog): consolidate skill.yaml into SKILL.md frontmatter"
type: refactor
status: active
date: 2026-04-24
---

# refactor(skill-catalog): consolidate skill.yaml into SKILL.md frontmatter

## Overview

Delete every `packages/skill-catalog/*/skill.yaml` and move all metadata into the corresponding `SKILL.md` frontmatter. This completes the "pure Claude-spec architecture" pivot started in PR #547 (composition primitives retired) and #548 (Skill() meta-tool refs scrubbed) — those PRs left the parallel `skill.yaml` metadata file in place. The user observed it directly in the admin Capabilities → Skills → Artifacts file tree: "scripts/, SKILL.md, skill.yaml" — duplicate state.

After this lands, SKILL.md is the single source of truth: humans read prose, parsers read frontmatter, S3 carries one file per concern.

---

## Problem Frame

Two metadata files per skill (`SKILL.md` + `skill.yaml`) means:

1. **Visible duplication in the admin UI** — operators looking at any agent template see the parallel YAML file alongside the canonical Markdown. Confuses the model, confuses humans.
2. **Drift surface** — fields like `description` exist in both files; the admin's `getCatalogSkill` reads YAML while plugin installers read SKILL.md frontmatter. Today they happen to match because authors hand-keep them in sync, but nothing enforces it.
3. **Format divergence** — composition-shaped skills used `id:` + `name:`, script/context skills use `slug:` + `display_name:`. Two parallel conventions in the same metadata file.
4. **Stale S3 copies** — `bootstrap-workspace.sh` does `aws s3 sync` *without* `--delete`, so stale skill.yaml objects from prior catalog versions accumulate in S3 indefinitely. Any deploy that removes a skill from disk leaves orphaned files in `s3://<bucket>/skills/catalog/<slug>/`.
5. **Two parsers** — Python `_parse_skill_yaml` (homegrown line-by-line) and TS `parseSkillMd` (real `yaml` lib). The Python parser drifts from the TS one because nothing tests them against the same fixtures.

The fix is decisive: one canonical metadata location (SKILL.md frontmatter), one parser per language (extend the existing TS `parseSkillMd`, write a Python equivalent that uses `pyyaml`), and a deploy script that actively deletes stale S3 objects.

---

## Requirements Trace

- **R1.** Every `packages/skill-catalog/*/skill.yaml` is removed from disk.
- **R2.** Every `packages/skill-catalog/*/SKILL.md` carries the full union of skill metadata in its frontmatter (one consolidated header per skill).
- **R3.** SKILL.md frontmatter shape is canonical and unified — one set of field names across all 21 skills, no `id` vs `slug` or `name` vs `display_name` divergence.
- **R4.** Every reader of `skill.yaml` parses SKILL.md frontmatter instead. Behavior is preserved end-to-end: `skill_catalog.tier1_metadata` in Postgres still gets populated, `skill_runner.py` still registers script-mode tools and routes mode:agent skills to sub-agents, the admin Capabilities API still returns the same field shape to the SPA.
- **R5.** `scripts/bootstrap-workspace.sh` actively deletes stale S3 objects (`aws s3 sync --delete`), so removing a file from disk reliably purges it from `s3://<bucket>/skills/catalog/<slug>/` on the next deploy. A one-shot purge of existing stale `*/skill.yaml` S3 objects ships with the change.
- **R6.** `skills.ts::installSkillToTenant` (the tenant-skill writer) emits SKILL.md only — no `SKILL_YAML_TEMPLATE` writes. The admin UI delete-button gate on `skill.yaml` is removed (the file no longer exists; the gate becomes dead code).
- **R7.** A canonical Python frontmatter parser (`packages/agentcore-strands/agent-container/container-sources/skill_md_parser.py` or similar) exists and is the single Python reader of skill metadata; `_parse_skill_yaml` is deleted. The TS `parseSkillMd` is extended to accept the full thinkwork-internal frontmatter schema (currently it only validates Claude-spec base fields).
- **R8.** `pnpm -r typecheck`, `pnpm -r test`, and `uv run pytest packages/agentcore-strands/agent-container/` and `uv run pytest packages/skill-catalog/` all pass with zero references to `skill.yaml` in source files (mandatory grep-for-zero check; comments referring to historical context allowed if explicit).
- **R9.** `validate-skill-catalog.sh` (the deploy-time lint) is updated to validate against SKILL.md frontmatter instead of skill.yaml; CI deploy gate stays green.

---

## Scope Boundaries

- No changes to the `skill_catalog` Drizzle schema or any DB column. `tier1_metadata` JSONB column remains; only its source flips from skill.yaml parse → SKILL.md frontmatter parse.
- No changes to the Strands runtime's per-skill env injection (`_inject_skill_env`) or to plugin upload flow (`plugin-upload.ts`, `plugin-validator.ts`, `plugin-installer.ts`) — those already operate on SKILL.md only per PR #517's U10 saga + PR #514's SI-4 validator.
- No mobile-app changes (mobile doesn't read skill metadata directly).
- No new YAML schema language or formal JSON Schema artifact — frontmatter validation lives in the parser code (TS + Python), not a separate spec.
- Retired-skill test files (`packages/skill-catalog/{frame,synthesize,gather,compound}/tests/test_*_yaml.py`) — those skill directories were deleted in PR #547. If their test files still exist as orphans, this plan removes them (stale already, this just sweeps them).

---

## Context & Research

### Relevant Code and Patterns

- **Existing TS parser to extend:** `packages/api/src/lib/skill-md-parser.ts` (`parseSkillMd`, `MAX_NAME_LEN`, `MAX_DESCRIPTION_LEN`, `NAME_PATTERN`, type `SkillMdParsed`). Built on the `yaml` package. Currently validates only Claude-spec base fields (`name`, `description`, `allowed-tools`). Tests at `packages/api/src/lib/__tests__/plugin-validator.test.ts`.
- **Existing Python parser to retire:** `packages/agentcore-strands/agent-container/container-sources/skill_runner.py::_parse_skill_yaml` (line 63). Hand-rolled line-by-line — does NOT use `pyyaml`. Replace with a real-yaml reader that takes SKILL.md text, splits frontmatter, parses with `pyyaml`.
- **Bootstrap pattern:** `scripts/bootstrap-workspace.sh:87` — current line is `aws s3 sync "$skill_dir" "s3://$BUCKET/skills/catalog/$slug/" --quiet`. Needs `--delete` flag.
- **DB-write pattern:** `packages/skill-catalog/scripts/sync-catalog-db.ts` — reads YAML, populates `skill_catalog` row including `tier1_metadata: JSON.stringify(parsed)`. Pattern to mirror with the new SKILL.md source.
- **U-test pattern:** `packages/skill-catalog/__tests__/u8-status.test.ts` already verifies post-migration shape (e.g., "declares execution: context") — these tests stay structurally similar but read from SKILL.md frontmatter instead.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — separate from this plan but reminds: any new "this file goes to S3 via deploy script" coupling needs a verifiable post-deploy check.
- `feedback_decisive_over_hybrid` — no transition mode supporting both formats. Single PR, single source of truth.
- `feedback_dont_overgate_baseline_agent_capability` — Claude-spec is the baseline; SKILL.md frontmatter IS the format Anthropic ships, no proprietary parallel.
- `feedback_worktree_tsbuildinfo_bootstrap` — fresh worktree must run `pnpm install` then delete tsbuildinfo + rebuild database-pg before any typecheck.
- `feedback_ci_lacks_uv` — TS tests can't shell out to `uv`. Python parser tests run in their own pytest job, never invoked from vitest.

### External References

None. This is a pure internal refactor of a thinkwork-owned format.

---

## Key Technical Decisions

- **Extended frontmatter, not strict Claude-spec.** Anthropic's published Claude-spec accepts `name`, `description`, `license`, `allowed-tools`, `model`. This plan's frontmatter adds thinkwork-specific keys (`execution`, `mode`, `inputs`, `triggers`, `tenant_overridable`, `requires_skills`, `scripts`, `category`, `tags`, `is_default`, `permissions_model`, etc.). Rationale: frontmatter is YAML; we own the parser; Anthropic's tooling ignores unknown keys. Strict Claude-spec would force a parallel sidecar file, defeating the point.
- **One canonical frontmatter shape.** Pick `name` (slug) and `display_name` (human-readable title). Drop `id` and `slug` as alternates. Rationale: the existing `parseSkillMd` already requires `name: [a-z0-9-]+`, and Claude-spec uses `name` for the slug. Composition-shaped skills (sales-prep, account-health-review, renewal-prep, customer-onboarding-reconciler) currently use `id:` — those get renamed in U2.
- **`display_name` is optional.** Skills like artifacts/workspace-memory don't currently carry one; the admin UI falls back to formatting `name` if absent. Don't force every skill to gain a display_name.
- **Single-PR migration, not two-phase.** All readers flip at once. Per `feedback_decisive_over_hybrid` — supporting "either YAML or frontmatter" leaves drift opportunities and never gets cleaned up. The blast radius is contained because the catalog is in-tree and synced on deploy; there's no external caller to break.
- **TS parser extends, Python parser is new.** `parseSkillMd` already exists and is the SI-4 source of truth. Extend its accepted-key list and add validation for thinkwork-specific fields. The Python container has no equivalent; create `container-sources/skill_md_parser.py` using `pyyaml` (already in `pyproject.toml`'s dependency tree via `strands` — verify in U1; if absent, add).
- **Bootstrap script gets `--delete`.** Without it, removing a file from disk doesn't remove it from S3 — operationally invisible. Add the flag in U4. Pair with a one-shot purge of existing stale `*/skill.yaml` S3 objects so we don't wait for the first sync to clean up.
- **`skill_catalog.tier1_metadata` JSONB shape stays the same.** `setAgentSkills.mutation.ts::parseTier1Metadata` and downstream readers don't know or care whether the source was YAML or frontmatter — they read JSONB. Only `sync-catalog-db.ts` (the producer) needs to flip its source.
- **Test files for retired skills** (`frame/`, `synthesize/`, `gather/`, `compound/`) already exist as orphans per the research. Verify in U3 and delete the orphans (one-line decision in execution).

---

## Open Questions

### Resolved During Planning

- **Strict Claude-spec or extended?** → Extended. Owned schema, owned parser.
- **Single-PR or two-phase?** → Single-PR.
- **`name` vs `display_name` reconciliation?** → `name` is canonical slug, `display_name` optional human-readable.
- **Bootstrap script needs `--delete`?** → Yes, plus one-shot S3 purge.
- **Existing parser to reuse?** → TS: `packages/api/src/lib/skill-md-parser.ts`. Python: none, build new in U1.

### Deferred to Implementation

- **Exact field-by-field merge mapping** for each of the 21 SKILL.md files — needs per-file inspection (some have minimal current frontmatter, some have rich; some YAML files are 70 lines, some 15). U2 handles this; the merge is mechanical but hands-on.
- **`pyyaml` availability in the agentcore container** — research suggests `strands` may pull it in transitively; U1 verifies and adds explicit dep if needed.
- **Whether `validate-skill-catalog.sh` becomes obsolete** — research notes it does its own walk and lints; once SKILL.md frontmatter is the format, decide in U4 whether to update it or delete it (the parser-level validation in U1 may make it redundant).
- **Whether the admin UI builder.tsx flow needs UX changes** when "create skill" no longer produces a skill.yaml file — minimal: drop the file from the file-tree the UI shows. U4 handles.

---

## Implementation Units

- [x] **U1. Extend TS `parseSkillMd` schema + add Python `skill_md_parser`** — shipped, 22 TS + 20 Python tests, parsers added without breaking existing callers

**Goal:** Build the parsers that every reader will use. Both languages parse the same canonical SKILL.md frontmatter shape; both reject malformed files with specific errors. The TS extension preserves SI-4 validation for plugin uploads while adding thinkwork-internal field validation; the Python parser is brand new.

**Requirements:** R3, R7

**Dependencies:** None.

**Files:**
- Modify: `packages/api/src/lib/skill-md-parser.ts` (extend `SkillMdParsed` type + `parseSkillMd` validation; accept the union of all internal fields)
- Modify: `packages/api/src/lib/__tests__/plugin-validator.test.ts` (existing SI-4 tests must still pass) and add a new test file
- Create: `packages/api/src/lib/__tests__/skill-md-parser.test.ts` (frontmatter-shape tests for thinkwork-internal fields)
- Create: `packages/agentcore-strands/agent-container/container-sources/skill_md_parser.py` (canonical Python parser using pyyaml)
- Create: `packages/agentcore-strands/agent-container/test_skill_md_parser.py` (parser tests)
- Modify: `packages/agentcore-strands/agent-container/container-sources/_boot_assert.py` (add `skill_md_parser` to `EXPECTED_CONTAINER_SOURCES` per the institutional learning about Dockerfile COPY + boot-assert pairing)
- Modify: `packages/agentcore-strands/pyproject.toml` (add `pyyaml` if not transitively available — verify first)

**Approach:**
- **Frontmatter schema (canonical):**
  - **Required:** `name` (slug, `[a-z0-9-]+`), `description` (multiline allowed)
  - **Recommended:** `version`, `license`, `metadata.{author, version}`, `display_name`
  - **Behavioral (governs runtime):** `execution` ("script" | "context"; default "context"), `mode` ("tool" | "agent"; default "tool"), `model` (optional, sub-agent override), `scripts: [{name, path, description, default_enabled}]` (only for execution: script), `inputs: {...}`, `triggers: {chat_intent, schedule, webhook}`, `tenant_overridable: [...]`, `requires_skills: [...]`, `permissions_model` ("operations" or null)
  - **Catalog metadata (governs admin display):** `category`, `icon`, `tags: [...]`, `requires_env: [...]`, `oauth_provider`, `oauth_scopes: [...]`, `mcp_server`, `mcp_tools: [...]`, `dependencies: [...]`, `is_default`, `compatibility`
- TS: extend `SkillMdParsed` interface to include all the above. Validation rules live next to the type. Existing SI-4 callers (plugin-validator) still see the same minimal subset they validated before — extra fields are allowed but not required for plugin uploads.
- Python: `parse_skill_md(path: str) -> dict`. Reads file, splits leading `---\n...\n---\n`, parses with `yaml.safe_load`, returns dict matching the canonical shape (with sane defaults for missing fields). Raises `SkillMdParseError` on malformed/missing-required-fields.
- Both parsers expose **two entry points:** parse-string (for in-memory content from S3) and parse-file (for disk reads).

**Patterns to follow:**
- TS validation idioms in current `parseSkillMd` (clear error messages, no exceptions, return `{ ok: true | false, ...}`).
- Python `_parse_skill_yaml` for behavior (default fallbacks, never crashes), but use real `yaml.safe_load` instead of hand-rolled parsing.

**Test scenarios:**
- **Happy path** — TS: minimal valid frontmatter (just `name` + `description`) → ok with defaults applied. Python: same.
- **Happy path** — TS: full frontmatter (every field populated) → ok with all fields preserved.
- **Edge case** — TS: `name` missing → fails with `MISSING_NAME`.
- **Edge case** — TS: `name` malformed (`Account Health Review` with caps + spaces) → fails with `INVALID_NAME_FORMAT`.
- **Edge case** — Python: file missing → returns None (matches existing `_parse_skill_yaml` behavior so callers can short-circuit).
- **Edge case** — Python: malformed YAML → raises `SkillMdParseError` with file path in the message.
- **Edge case** — TS + Python: `execution: composition` (retired) → both reject with `UNSUPPORTED_EXECUTION` (matches U6 audit drift tripwire).
- **Edge case** — TS + Python: file with no frontmatter (just markdown body) → returns empty/default dict. Both parsers must agree on this — happy path for skills like `customer-onboarding/SKILL.md` until U2 adds frontmatter, but U3 readers should still tolerate it during migration.
- **Edge case** — TS + Python: `scripts: [{name, path, description, default_enabled}]` with mixed types (some scalars as strings, some bools). Both parsers must coerce consistently — Python's `_parse_skill_yaml` had a custom coercion for "true" → True; pyyaml does this natively. Add an explicit test that the new Python parser produces the same shape on the same fixture.
- **Integration** — Python parser called on every existing post-U2 SKILL.md file (loop through `packages/skill-catalog/*/SKILL.md`); none should raise.

**Verification:**
- All new tests pass.
- Existing SI-4 plugin-validator tests still pass.
- Python parser parses every post-U2 SKILL.md without raising.
- `pnpm --filter @thinkwork/api typecheck` clean.

---

- [x] **U2. Migrate every SKILL.md to carry full frontmatter; delete skill.yaml** — shipped, 16 skills (plan said 21; 4 retired in earlier work, count was stale), 23 new tests, body content byte-identical

**Goal:** Every `packages/skill-catalog/*/SKILL.md` carries one merged frontmatter with all metadata. Every `packages/skill-catalog/*/skill.yaml` is deleted. SKILL.md body content is unchanged (mechanical merge, not rewrite).

**Requirements:** R1, R2, R3

**Dependencies:** U1 (parser must accept the new shape so post-merge tests can validate)

**Files:**
- Modify: 19 `packages/skill-catalog/<slug>/SKILL.md` files (carry merged frontmatter)
- Create: 2 SKILL.md files where currently no frontmatter exists (`packages/skill-catalog/customer-onboarding/SKILL.md`, `packages/skill-catalog/sandbox-pilot/SKILL.md` — add frontmatter at top)
- Delete: every `packages/skill-catalog/<slug>/skill.yaml` (currently 18+ files per `find` earlier in session)
- Modify: `packages/skill-catalog/__tests__/u8-status.test.ts` (assertions flip from "skill.yaml has execution: context" → "SKILL.md frontmatter has execution: context")
- Test: `packages/skill-catalog/__tests__/skill-md-frontmatter.test.ts` (new — sanity check that every skill's frontmatter parses + has required fields)

**Approach:**
- **Mechanical merge per skill:** read existing SKILL.md frontmatter (typically `name`, `description`, `license`, `metadata.{author,version}`); read skill.yaml; produce one merged frontmatter that's the union, resolving the `id`→`name`, `name`→`display_name`, `slug`→`name` divergence.
- **Format collisions to resolve:**
  - skills with `id:` in skill.yaml → that becomes `name:` in SKILL.md. Existing SKILL.md `name:` (already a slug) wins on conflict.
  - skills with `name: "Prep for Meeting"` (display-style) in skill.yaml → that becomes `display_name:` in the merged frontmatter.
  - skills with `slug:` and `display_name:` in skill.yaml → `slug` becomes `name`, `display_name` stays.
- **Body unchanged.** The frontmatter block expands; everything from the closing `---` onward stays byte-identical.
- **For the 2 frontmatter-less SKILL.md files:** add a full frontmatter block at the top derived from their skill.yaml. Existing markdown body stays.
- **Delete skill.yaml files last** in this unit, after the merged frontmatter is in place — the readers in U3 still read skill.yaml until U3 ships, but the disk state at end of U2 has both forms briefly. That's fine: this is a single PR, not multiple deploys.

**Patterns to follow:**
- The shape of existing SKILL.md frontmatter blocks (one `---\n...\n---\n` at the top, no blank lines inside the block).
- Single-quote strings only when YAML requires it (e.g., contains a `:` or starts with `[`).

**Test scenarios:**
- **Happy path** — every `packages/skill-catalog/<slug>/SKILL.md` parses cleanly via U1's `parseSkillMd`; field count matches expectations per skill (script skills carry `scripts:`, context skills don't, etc.).
- **Edge case** — for each skill, post-U2 frontmatter contains every field that the pre-U2 skill.yaml carried (zero data loss).
- **Edge case** — `customer-onboarding` and `sandbox-pilot` SKILL.md now have valid frontmatter (previously had none).
- **Integration** — the existing `u8-status` audit script still reports 0 regressed, 0 unknown after the migration. (Audit logic stays the same; only its source changes from skill.yaml to SKILL.md frontmatter once U3 lands. For U2 alone, audit still reads skill.yaml and stays passing because the YAML files still exist.)

**Verification:**
- 21 SKILL.md files all have valid frontmatter parsable by U1.
- Zero `packages/skill-catalog/<slug>/skill.yaml` files remain on disk (`find packages/skill-catalog -name skill.yaml -not -path '*/node_modules/*'` returns empty).
- `pnpm -r typecheck` clean. New skill-md-frontmatter test passes.

---

- [x] **U3. Update every reader (TS + Python + admin UI) to use frontmatter** — shipped, 31 files touched, tier1_metadata shape preserved + pinned with new test, `_parse_skill_yaml` deleted

**Goal:** Every consumer of skill metadata reads SKILL.md frontmatter via the U1 parsers. No code path opens a `skill.yaml` file. The admin UI no longer references skill.yaml.

**Requirements:** R4, R7

**Dependencies:** U1 (parser), U2 (data must be in frontmatter for readers to work)

**Files:**
- **TS readers (replace skill.yaml read with SKILL.md frontmatter parse):**
  - Modify: `packages/skill-catalog/scripts/sync-catalog-db.ts` (loads each skill's metadata; writes `tier1_metadata` JSONB)
  - Modify: `packages/skill-catalog/scripts/u8-status.ts` (audit; reads `execution` field)
  - Modify: `packages/skill-catalog/scripts/generate-index.ts` (drop hand-rolled YAML parser; use parseSkillMd)
  - Modify: `packages/skill-catalog/scripts/census.ts` (same; metadata walk)
  - Modify: `packages/api/src/handlers/skills.ts::getCatalogSkill` (was `getS3Text(catalogPrefix + skill.yaml)`; flip to `getS3Text(catalogPrefix + SKILL.md)` + parseSkillMd; preserve response shape so admin SPA doesn't break)
  - Modify: `packages/api/src/handlers/skills.ts:874` (auto-install dep path — same flip)
  - Modify: `packages/api/src/handlers/skills.ts:1061` (response payload literal `["skill.yaml", "SKILL.md"]` → `["SKILL.md"]`)
  - Modify: `packages/api/src/handlers/skills.ts:1124-1126` (drop the "refuses to delete skill.yaml" gate — file no longer exists; no protection needed)
  - Modify: `packages/api/src/handlers/skills.ts:1220` (`installSkillToAgent` reads catalog skill.yaml — flip)
  - Modify: `packages/api/src/handlers/skills.ts:1038-1043` (`SKILL_YAML_TEMPLATE` in tenant-skill creation — flip to write SKILL.md with frontmatter; or just write SKILL.md and skip skill.yaml writing entirely per R6)
  - Modify: `packages/api/src/graphql/resolvers/core/authz.ts:159, 209` (delete stale `thinkwork-admin/skill.yaml` comments — slug retired)
- **Python readers:**
  - Modify: `packages/agentcore-strands/agent-container/container-sources/skill_runner.py` (delete `_parse_skill_yaml`; replace internal calls with `skill_md_parser.parse_skill_md`; reads from `<SKILLS_DIR>/<id>/SKILL.md`)
  - Modify: `packages/agentcore-strands/agent-container/container-sources/run_skill_dispatch.py:100` (sub-skill dispatch reads execution from SKILL.md frontmatter)
  - Modify: `packages/agentcore-strands/agent-container/container-sources/server.py:304-311` (the `^\s*execution:\s*context\s*$` regex grep — replace with frontmatter parse)
  - Modify: `packages/agentcore-strands/agent-container/container-sources/skill_inputs.py:4` (docstring; uses parsed-yaml dict — no functional change, dict shape unchanged from U1)
- **Admin UI:**
  - Modify: `apps/admin/src/routes/_authed/_tenant/capabilities/skills/$slug.tsx:662` (drop the `selectedFile !== "skill.yaml"` delete-button gate)
  - Modify: `apps/admin/src/routes/_authed/_tenant/capabilities/skills/builder.tsx:279` (update or delete the comment about generating skill.yaml + SKILL.md)
- **Tests (mass update):**
  - Modify: every TS test in `packages/skill-catalog/__tests__/` that loads skill.yaml fixtures (per research: `census.test.ts:30, 321, 330, 342, 371`)
  - Modify: every Python test in `packages/agentcore-strands/agent-container/test_skill_yaml_coercion.py`, `test_skill_runner_compositions.py`, `test_server_run_skill.py:404, 454, 470, 505`
  - Delete (orphans from PR #547): `packages/skill-catalog/{frame,synthesize,gather,compound}/tests/test_*_yaml.py` (verify directories actually exist before deleting; per research these may be orphan test files for already-deleted skill directories)

**Approach:**
- **TS readers** all follow the same template: open `SKILL.md`, run through `parseSkillMd`, produce a dict with the same shape `tier1_metadata` previously had. Existing JSONB consumers (`setAgentSkills.mutation.ts`, `templateSyncDiff.query.ts`, `syncTemplateToAgent.mutation.ts`) are NOT touched — they read DB columns, not S3. The producer flipping its source is invisible to them.
- **Python `_parse_skill_yaml` is deleted** in U3 (not earlier). Any caller still pointing at it gets a static failure on import; that surfaces via the `_boot_assert` check.
- **Critical: `tier1_metadata` JSONB shape** — must match what `parseTier1Metadata` (in `setAgentSkills.mutation.ts`) expects. Add an integration test that takes a real SKILL.md fixture, runs `sync-catalog-db.ts` parse, and asserts the resulting JSONB has the keys `parseTier1Metadata` consumes.
- **Server.py `execution: context` regex grep** — that regex was a fast path to avoid YAML-parsing every file. Replace with `parse_skill_md` + `meta.get("execution") == "context"`. Bump the parse cost; it's per-skill-per-turn so the impact is microseconds.

**Patterns to follow:**
- Reuse the `parseSkillMd` ok/error idiom across TS readers — never throw, always return a structured result.
- Python `parse_skill_md` returning `None` on missing file matches existing `_parse_skill_yaml` semantics, so callers can keep their `if not meta: continue` patterns.

**Test scenarios:**
- **Happy path** — `sync-catalog-db.ts` reads every SKILL.md and writes `tier1_metadata` rows; row count + key shape matches pre-flip output exactly.
- **Happy path** — `u8-status.ts` audit reports 0 regressed, 0 unknown across 21 skills.
- **Happy path** — admin GET `/api/skills/catalog/sales-prep` returns the same JSON shape as before (snapshot test against pre-U3 fixture).
- **Edge case** — Python `skill_runner.register_skill_tools` still discovers + registers script-mode skills correctly (test against full fixture set).
- **Edge case** — Python `run_skill_dispatch._dispatch_subskill` correctly reads execution type from frontmatter (test against fixtures for each execution type).
- **Edge case** — Python `server.py` correctly identifies context skills for SKILL.md injection (PRD-40 test still passes).
- **Edge case** — `installSkillToTenant` writes only SKILL.md (no SKILL_YAML_TEMPLATE write); follow-up `getCatalogSkill` returns the right shape.
- **Integration** — full agentcore container test suite passes against post-U2 fixtures (no regressions).
- **Integration** — full api test suite passes; `setAgentSkills.mutation.ts` permissions check works against the post-flip JSONB.

**Verification:**
- Mandatory grep-for-zero: `rg -l 'skill\.yaml' packages/ apps/ scripts/` returns only documentation/comment hits, never code reads.
- `pnpm -r typecheck` clean. `pnpm -r test` all passing.
- `uv run pytest packages/agentcore-strands/agent-container/ packages/skill-catalog/` clean.
- Manual: admin UI Capabilities → Skills → any-skill page shows file tree with SKILL.md only (no skill.yaml entry).

---

- [x] **U4. Update bootstrap, lint, and one-shot S3 purge** — shipped (reduced scope; bootstrap `--delete` was already added in PR #547, so existing sync auto-purges stale objects). validate-skill-catalog.sh now walks SKILL.md frontmatter

**Goal:** The deploy pipeline reliably purges stale S3 objects when files disappear from disk; the existing `validate-skill-catalog.sh` lint validates frontmatter shape; existing stale skill.yaml objects in S3 are removed in a one-shot.

**Requirements:** R5, R9

**Dependencies:** U3 (no readers depend on skill.yaml; safe to delete from S3)

**Files:**
- Modify: `scripts/bootstrap-workspace.sh` (line 87 — add `--delete` flag to the `aws s3 sync`)
- Modify: `scripts/bootstrap-workspace.sh` (add a one-shot `aws s3 rm` block that purges existing `skills/catalog/*/skill.yaml` objects from S3 — runs once in the deploy that lands this plan)
- Modify: `scripts/validate-skill-catalog.sh` (flip from skill.yaml walk to SKILL.md frontmatter walk; or delete the script if U1's parser-level validation makes it obsolete — decide during execution)
- Modify: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` if there's an analogous "deploy-time S3 sync should be self-purging" lesson worth capturing alongside it (judgment call during execution)

**Approach:**
- **`--delete` flag** is the durable fix. The one-shot purge is just to clean up state from the era where `--delete` wasn't there.
- **One-shot purge:** `aws s3 ls s3://$BUCKET/skills/catalog/ --recursive | grep '/skill.yaml$' | awk '{print $4}' | xargs -I{} aws s3 rm "s3://$BUCKET/{}"`. Defensive: skip if dry-run mode set; log count of deleted objects.
- **`validate-skill-catalog.sh`:** if U1's parser validates everything that this lint validates, the script becomes redundant. Default decision: rewrite it to walk `packages/skill-catalog/*/SKILL.md` and call the TS parser via `tsx`, exit non-zero on parse failure. Drop only if the rewrite is more than a 30-line script.

**Patterns to follow:**
- The defensive shell idioms in `bootstrap-workspace.sh` already (set -euo pipefail, ERR trap with line+command). Match.
- Existing post-merge migration verifier in `db:migrate-manual` — single-shot, idempotent, logs what it did.

**Test scenarios:**
- **Happy path** — `aws s3 sync --delete` removes a file from S3 when removed from disk (verifiable manually post-merge on dev).
- **Happy path** — `validate-skill-catalog.sh` exits 0 against the post-U2 catalog (every SKILL.md frontmatter parses).
- **Edge case** — `validate-skill-catalog.sh` exits non-zero if a SKILL.md has malformed frontmatter (introduce a fixture failure in test, verify it catches).
- **Edge case** — one-shot purge handles empty S3 prefix gracefully (no skill.yaml objects exist already → exit 0, log `0 deleted`).
- **Test expectation: integration** — the bootstrap script's verification block (e.g., `db:migrate-manual` reporter) is structurally similar; this unit doesn't ship its own pytest/vitest but verifies via a deploy-pipeline run.

**Verification:**
- `bash scripts/validate-skill-catalog.sh` (or its replacement) exits 0 against post-U2 catalog.
- Bootstrap script's `aws s3 sync` line carries `--delete`.
- A one-time purge command exists in the bootstrap script for stale `skill.yaml` objects.
- Manually verify post-deploy on dev: `aws s3 ls s3://thinkwork-dev-storage/skills/catalog/sales-prep/skill.yaml` returns "no such key".

---

- [x] **U5. Mandatory grep-for-zero + retired-skill orphan cleanup** — shipped, deleted test_skill_yaml_coercion.py orphan, verified retired-skill dirs absent, active-code skill.yaml refs = 0

**Goal:** Final hygiene pass. No `skill.yaml` references remain in source. Orphan test files for deleted skills are removed.

**Requirements:** R8

**Dependencies:** U1, U2, U3, U4 — this is the closing pass that catches anything previous units missed.

**Files:**
- Delete (verify first): `packages/skill-catalog/{frame,synthesize,gather,compound,package}/tests/test_*_yaml.py` (research showed these test files exist, but the corresponding skill directories were retired in PR #547 — orphans). Also delete `packages/agentcore-strands/agent-container/test_skill_yaml_coercion.py` if its only purpose was testing the deleted `_parse_skill_yaml`.
- Modify: any remaining test/source files that still grep `skill\.yaml` in active code (not docstring/comment historical references — those are fine)

**Approach:**
- Grep-for-zero loop: `rg 'skill\.yaml' packages/ apps/ scripts/ | grep -v '#\|//\|/\*'`
  - Comments and docstrings referring to historical context: OK to leave (e.g., "this used to read skill.yaml before #XXX").
  - Active code reads: must be zero.
- Retired-skill orphans: for each candidate file (per research), verify the skill directory doesn't exist (`packages/skill-catalog/frame/` doesn't exist → its `tests/test_*_yaml.py` is an orphan → delete).

**Patterns to follow:**
- Mandatory grep-for-zero check from PR #542's plan §U6. Same shape: a single shell command, easy to audit, one-line deliverable.

**Test scenarios:**
- **Happy path** — `rg --type-add 'src:*.{ts,py}' --type src 'skill\.yaml'` returns no matches in active code (only comments).
- **Happy path** — `find packages/skill-catalog -name skill.yaml` returns no matches.
- **Happy path** — `pnpm -r test` and `uv run pytest packages/agentcore-strands/agent-container/ packages/skill-catalog/` all pass.

**Verification:**
- Grep-for-zero passes.
- Test suites green.
- PR description includes a `## What's no longer here` section listing the deleted files for easy review.

---

## System-Wide Impact

- **Interaction graph:**
  - Catalog sync at deploy → `bootstrap-workspace.sh` → `sync-catalog-db.ts` → reads SKILL.md → `tier1_metadata` populated. Downstream (`setAgentSkills.mutation.ts`, `templateSyncDiff.query.ts`, `syncTemplateToAgent.mutation.ts`) reads DB column unchanged.
  - Agent invocation → container pulls from S3 → `skill_runner.py` registers → reads SKILL.md frontmatter (was skill.yaml).
  - Admin Capabilities API → `getCatalogSkill` → reads S3 SKILL.md → returns to admin SPA. Response shape preserved.
  - Tenant skill creation → `installSkillToTenant` → writes SKILL.md only (was SKILL.md + skill.yaml).
- **Error propagation:** Malformed frontmatter at boot/sync time → both parsers raise specific errors. Sync script logs + skips a single bad skill rather than failing the whole sync (existing pattern in `sync-catalog-db.ts`).
- **State lifecycle risks:**
  - **Stale S3 copies until U4 ships.** Until the bootstrap `--delete` lands and the one-shot purge runs, S3 has both the old skill.yaml objects AND the new SKILL.md-only catalog. Readers point at SKILL.md so it's harmless, but operators inspecting S3 will see the old files. U4 in the same PR ensures no in-between state lasts past one deploy.
  - **Container warm starts** during deploy: per `project_agentcore_deploy_race_env`, warm containers may boot pre-env-injection. Not relevant here (no env vars affected), but if a warm container holds a parsed-yaml dict in memory from before deploy, its in-memory state is stale until next invocation. Not a real risk because skill_runner re-reads on every invocation.
- **API surface parity:** The admin SPA's catalog detail view, tenant-skills API, agent-skills permissions API, plugin-validator — all preserve their response shapes. `tier1_metadata` JSONB shape preserved exactly. Single observable change: file-tree endpoint stops listing `skill.yaml`.
- **Integration coverage:** Cross-layer: container parses S3 SKILL.md → uses for tool registration → admin reads same SKILL.md → response goes to SPA. The integration test in U3 covers that the agent-side and admin-side parsers produce the same shape from the same fixture.
- **Unchanged invariants:**
  - `skill_catalog.tier1_metadata` JSONB shape — unchanged.
  - `agent_skills`, `tenant_skills`, `agent_templates.skills` table shapes — unchanged.
  - SKILL.md body content (markdown prose) — unchanged for all 21 skills.
  - Plugin upload flow — unchanged (already SKILL.md-only).
  - Strands runtime per-skill env injection — unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| **Schema drift between TS and Python parsers.** Two parsers, two languages. If they diverge on edge cases (whitespace handling, YAML coercion, default values) we re-create today's bug class. | U1 includes an integration test that runs both parsers against every post-U2 SKILL.md fixture and asserts the resulting dicts are equivalent. Pyyaml + the `yaml` npm package both follow YAML 1.2 reasonably closely; the risk is real but the testing strategy catches it. |
| **`tier1_metadata` JSONB shape regression.** `setAgentSkills.mutation.ts::parseTier1Metadata` and downstream depend on specific JSONB keys. Subtle key renaming during the merge breaks permission checks silently. | U3 includes an end-to-end test against current `parseTier1Metadata` consumers using a representative fixture (e.g., a skill with `permissions_model: operations`). Snapshot test the JSONB before and after the flip. |
| **Stale S3 skill.yaml during the deploy gap.** Between when this PR merges and when `bootstrap-workspace.sh` runs, S3 still has old skill.yaml objects but readers don't read them. Admin UI file tree might briefly show them depending on cache. | Cosmetic only. Once bootstrap runs (CI deploy), purge happens. Don't add a second admin-side filter for transient state. |
| **Two SKILL.md files have no frontmatter today.** `customer-onboarding/SKILL.md` and `sandbox-pilot/SKILL.md`. U1 parsers must tolerate this during U2's transition; existing readers likely already fail on these. | U1 explicit edge case: parser returns empty dict with sane defaults for no-frontmatter files. U2 explicitly adds frontmatter to these two as part of the merge. Verify in U2's "21 SKILL.md parse" test. |
| **The admin "delete" button gate.** `selectedFile !== "skill.yaml"` was preventing operators from deleting that one specific file. Once the file no longer exists, the gate is dead but harmless. If admin code adds a similar gate for SKILL.md (preventing deletion of the canonical metadata file), users can't delete skills via the UI at all. | U3 drops the gate. If post-removal there's a need for "you can't delete THE SKILL.md" protection, that's a separate UX concern — file as polish item; not blocking. |
| **Plugin install path silently changes.** `installSkillToTenant` no longer writes skill.yaml. Tenants who previously had auto-generated skill.yaml in their S3 prefix now don't. Downstream tenant-side tooling (if any) that reads the per-tenant skill.yaml breaks. | Per research: plugin-upload + plugin-installer are already SKILL.md-only. The `SKILL_YAML_TEMPLATE` in `skills.ts:1038` is the only writer. No tenant-side reader was found. Risk is low; surface in PR description as "if you have downstream tooling reading tenant `skill.yaml`, it will break — please flag." |
| **One-shot S3 purge runs on every deploy after merge.** If we leave the `aws s3 rm` block permanent, it's wasted work on every subsequent deploy. | U4 makes it a one-shot: gated on a marker file (e.g., `aws s3 ls .../.skill-yaml-purge-complete` exists → skip). Simpler alternative: ship the purge as a one-shot and remove the block in a follow-up PR after the first deploy. Decide during U4 execution. |
| **CI lacks `uv` for Python parser tests in TS workflows.** Per `feedback_ci_lacks_uv` — TS tests can't shell out to invoke Python. | U3's cross-parser integration test runs in pytest only. The TS-side `tier1_metadata` shape test uses pre-fixtured JSONB, not a Python-generated one. |

---

## Documentation / Operational Notes

- **PR description must call out:** SKILL.md is now the canonical metadata format; skill.yaml is removed. Tenants with downstream tooling that reads per-tenant skill.yaml: speak up before merge.
- **Solution doc to write (post-merge):** `docs/solutions/architecture/skill-md-frontmatter-as-canonical-metadata-2026-04-XX.md` — captures: why two metadata files were a problem, the canonical schema, the parser-pair pattern (TS + Python), and how to extend the schema in the future without re-introducing drift.
- **Deploy verification:** after first deploy of this change, run `aws s3 ls s3://thinkwork-dev-storage/skills/catalog/sales-prep/` and confirm only `SKILL.md` + `scripts/` are present (no `skill.yaml`).
- **Auto-memory entry to add:** "skill metadata is in SKILL.md frontmatter; never reach for skill.yaml — that file format is retired."

---

## Sources & References

- **Triggering observation:** Admin Capabilities → Skills → Artifacts file tree screenshot (2026-04-24 session).
- **Prior PRs in this arc:**
  - #547 (`refactor(skill-catalog): pure Claude-spec rewrite — retire composition primitives`)
  - #548 (`fix(skill-catalog): SKILL.md bodies call tools by real registered names`)
  - #556 (`refactor(skill-catalog): scrub composition-era cruft from 6 context YAMLs`) — partial, the tail of this work
  - #514 (`feat(api): U9 plugin + SKILL.md + zip-safety validator (SI-4)`) — introduced `parseSkillMd`
- **Memory references:**
  - `feedback_decisive_over_hybrid` — single-PR, single-format
  - `feedback_dont_overgate_baseline_agent_capability` — Claude-spec is the baseline
  - `feedback_worktree_tsbuildinfo_bootstrap` — fresh worktree bootstrap dance
  - `feedback_ci_lacks_uv` — TS tests can't shell to uv
  - `project_v1_agent_architecture_progress` — composition arc tail
- **Parser to extend:** `packages/api/src/lib/skill-md-parser.ts`
- **Parser to retire:** `packages/agentcore-strands/agent-container/container-sources/skill_runner.py::_parse_skill_yaml`
