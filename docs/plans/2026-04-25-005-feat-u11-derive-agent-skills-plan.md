---
title: "feat: U11 — derive `agent_skills` from composed AGENTS.md"
type: feat
status: active
date: 2026-04-25
origin: docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md
---

# feat: U11 — derive `agent_skills` from composed AGENTS.md

## Overview

Make the `agent_skills` Postgres table a **derivative** of the composed workspace AGENTS.md routing tables instead of a hand-written list maintained by the admin skills-assignment page. The new `derive-agent-skills.ts` function walks an agent's composed S3 tree, pulls every AGENTS.md (root + each sub-agent folder), parses it via the U6 `parseAgentsMd` parser (#571), unions the routing-row `skills:` columns, dedups by slug, and writes the result back to `agent_skills` in a single transaction (upsert the derived set, delete rows not in it).

This is the narrow slice of master plan §008 U11 (lines 692-727 of `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`). U21 retires the standalone admin skills-assignment page in a later unit; this PR makes the recompute mechanism real and wires it into every `AGENTS.md` `put` so the table stays in sync. The legacy `setAgentSkills` GraphQL mutation continues to work and continues to call `regenerateWorkspaceMap` (which writes its own root AGENTS.md), but it now logs a deprecation warning so we can spot last-callers in the admin UI before U21.

---

## Problem Frame

Today, `agent_skills` rows are written by `setAgentSkills` (GraphQL mutation) and the autogenerator (`workspace-map-generator.ts`) reads from them to render the root AGENTS.md "Skills & Tools" table. The data flow is **DB → file**:

```
admin UI → setAgentSkills mutation → agent_skills rows → regenerateWorkspaceMap → AGENTS.md
```

In the Fat-folder world (master plan §008), AGENTS.md is the canonical routing source, sub-agent folders each have their own AGENTS.md, and the agent builder (U17–U19) edits AGENTS.md directly — not the per-skill DB rows. The data flow needs to invert to **file → DB**:

```
agent builder → AGENTS.md put → derive-agent-skills → agent_skills rows
```

`agent_skills` still has to exist as a fast lookup for `chat-agent-invoke.ts` (`skills_config` payload, `permissions`, `model_override`, `rate_limit_rpm`) — runtime invocation can't afford to re-parse the composed tree on every call. So `agent_skills` becomes computed-but-persisted: derive-agent-skills is the single writer, AGENTS.md is the single source of truth.

The non-skill columns (`config`, `permissions`, `rate_limit_rpm`, `model_override`, `enabled`) survive a recompute when the slug still appears in the derived set — the upsert path preserves them. Slugs that disappear from AGENTS.md get hard-deleted; that's intentional and matches the test scenario "recompute with 0 routing rows → `agent_skills` has 0 rows."

---

## Requirements Trace

- **R1.** Given an agent with a composed tree containing N sub-agent folders, each folder's AGENTS.md routing table contributes its `skills:` cells (split, decoration-stripped, deduped by slug) to the derived `agent_skills` set. The root AGENTS.md is included with `goTo = ""` (the agent itself). (Master R20, R23.)
- **R2.** Upsert preserves the existing `permissions`, `config`, `rate_limit_rpm`, `model_override`, `enabled` columns when the slug already has a row — only `skill_id`/`tenant_id`/`agent_id` are guaranteed by the derive. (Master AE6.)
- **R3.** Slugs no longer present in any composed AGENTS.md routing row are deleted in the same transaction. The whole operation is atomic — either the full derived set replaces the prior set, or nothing changes.
- **R4.** A malformed AGENTS.md (one that throws from `parseAgentsMd`) aborts the recompute and surfaces the error to the caller. The composer cache is unaffected (already invalidated before the derive call).
- **R5.** Recompute runs synchronously inside the `workspace-files.ts` `put` handler whenever the written `path` ends in `AGENTS.md` (root or sub-agent folder). Latency budget: <500 ms for a 5-folder agent. Failure of the derive **fails the put** (returns 500 with the parser error message) — we won't accept a "saved but stale" state.
- **R6.** The legacy `setAgentSkills` mutation (`packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`) keeps working but logs `[setAgentSkills] DEPRECATED — derive-agent-skills (U11) is now the canonical writer` once per call. No behavior change; this is a beacon for U21.
- **R7.** Pass the full composed-tree result from `composeList` to the writer, not a per-folder dict — per `apply-invocation-env-field-passthrough` learning, downstream code must see what the parser saw, not a filtered subset.

**Origin actors:** A1 (template author), A2 (tenant operator), A6 (ecosystem author). All three trigger AGENTS.md writes.
**Origin flows:** F1 (template inheritance — root AGENTS.md), F2 (external folder import — sub-agent AGENTS.md added by U15).
**Origin acceptance examples:** AE6 (workspace-skills unification: composed routing → `agent_skills`).

---

## Scope Boundaries

- **Not retiring** the `setAgentSkills` GraphQL mutation. Mobile and admin still call it during the U17–U19 / U21 transition; deprecation log lights the path for removal in U21.
- **Not retiring** `regenerateWorkspaceMap` (`packages/api/src/lib/workspace-map-generator.ts`). It writes the root AGENTS.md from `agent_skills`; until U21 retires `setAgentSkills`, both directions exist. The directions don't loop because:
  - `setAgentSkills` → `regenerateWorkspaceMap` → root `AGENTS.md` write → `derive-agent-skills` reads composed tree → re-derives the same skill set → upsert is a no-op (rows already match).
  - The "no-op" is enforced by checking if the derived set equals the existing set before issuing any writes; see Approach in U2.
- **Not touching** the `permissions`, `config`, `rate_limit_rpm`, `model_override`, `enabled` columns on derive — those continue to be authored exclusively by `setAgentSkills` and the per-skill admin UI until U21 reroutes them onto AGENTS.md row metadata. Derive only manages the *set membership*, not per-row fields.
- **Not adding** sub-agent enumeration to `regenerateWorkspaceMap`. That function still renders only the root agent's view; the agent builder (U17) renders the multi-folder tree from its own composed-tree fetch.
- **Not touching** the skill_catalog table. Slug renames in `skill_catalog` continue to flow through whatever sync exists (out of scope here); derive treats slugs as opaque.
- **Not creating** a GraphQL/REST entry point for derive. It's an internal library function called from the `put` handler. Admin UI never invokes it directly.
- **Not refactoring** the `parseAgentsMd` `throws on multiple-tables-without-heading` path. Master plan U6 already documents this and the error surfaces cleanly — derive lets it propagate.

### Deferred to Follow-Up Work

- **U21 (retire admin skills-assignment page)** — separate unit, removes the `setAgentSkills` mutation entirely. After U21, derive becomes the *only* writer.
- **Per-row metadata on AGENTS.md** (rate limits, model overrides, permissions in routing-row cells) — master plan U18 territory. Until then, derive only manages set membership.
- **Skill-catalog slug-rename migration** — when a platform skill renames in `skill_catalog`, derive will treat the old slug as "not present" and delete the row. That's correct behavior, but operators need a migration tool to bulk-rename slugs in AGENTS.md. Out of scope for U11.

---

## Context & Research

### Relevant Code and Patterns

**Composer & parser surfaces (already shipped):**

- `packages/api/src/lib/workspace-overlay.ts:475-619` — `composeFile(ctx, agentId, path)` resolves a single composed file. Already supports sub-agent ancestor walks (U5, #570).
- `packages/api/src/lib/workspace-overlay.ts:628-666` — `composeList(ctx, agentId, { includeContent: true })` returns the union of every composed path with content. **This is the right entry point** — it already surfaces sub-agent folder paths like `expenses/AGENTS.md` because U5 added them to the union path collector.
- `packages/api/src/lib/workspace-overlay.ts:790-803` — `invalidateComposerCache({ tenantId, agentId })` is already called by `handlePut` *before* derive needs to read; we slot in *after* invalidation so derive sees fresh content.
- `packages/api/src/lib/agents-md-parser.ts:95-107` — `parseAgentsMd(markdown)` returns `{ routing, rawMarkdown, warnings, skippedRows }`. Routing rows expose `skills: string[]`. (U6, #571.)
- `packages/api/src/lib/reserved-folder-names.ts` — `RESERVED_FOLDER_NAMES` constant (memory, skills). Parser already filters out reserved goTo paths from `routing`; derive trusts the parser's filter.

**The handler we're modifying:**

- `packages/api/workspace-files.ts:387-433` — `handlePut`. Two branches: `target.kind === "agent"` (writes to S3 + `regenerateManifest` + `invalidateComposerCache`) and template/defaults branch (only invalidates the templateScope cache). Derive only runs on the agent branch — template/defaults edits flow through `setAgentSkills`-style accept-template-update flows and don't touch the per-agent derived set.
- `packages/api/workspace-files.ts:698-711` — `case "put"` dispatcher. Body has `{ path, content, acceptTemplateUpdate }`. The path-ends-with-`AGENTS.md` check happens inside `handlePut`.

**Schema we're writing to:**

- `packages/database-pg/src/schema/agents.ts:128-157` — `agentSkills` table. Composite unique index `(agent_id, skill_id)` is the upsert target. `tenant_id` notNull, `enabled` defaults true, `permissions`/`config`/`rate_limit_rpm`/`model_override` all nullable.
- `packages/api/src/graphql/utils.js` — re-exports `db`, `eq`, `and`, `inArray`, `agents`, `agentSkills`, `agentTemplates`, `tenants`, `snakeToCamel`. Used by `setAgentSkills.mutation.ts`; reuse the same imports for derive.

**The mutation we're deprecating:**

- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts` — full implementation lines 16-245. Already calls `regenerateWorkspaceMap` after the upsert (lines 227-242). Adds a single `console.warn` line right after the existing self-modification guard.

**Test patterns to follow:**

- `packages/api/src/__tests__/agents-md-parser.test.ts` — vitest with inline markdown fixtures; mocks not needed for the parser itself.
- `packages/api/src/__tests__/workspace-overlay.test.ts` — mocks `s3.send` via `vi.mock` at module-load. Use the same pattern for derive's integration test (composeList path).
- `packages/api/src/__tests__/workspace-files-handler.test.ts` — handler-level test with the full mock stack. Use as the pattern for U3's "put AGENTS.md → derive runs" integration test.

### Institutional Learnings

- `feedback_completion_callback_snapshot_pattern` — env reads in the agent-coroutine entry must be snapshotted. **N/A here** — derive runs in a Lambda handler synchronously off a fresh request; no snapshot drift risk.
- `apply-invocation-env-field-passthrough` (referenced in the master plan U11 Approach) — pass the full parsed payload to the writer, not a subset dict. Applied as R7 above.
- `feedback_ship_inert_pattern` — new modules land with tests but no live wiring; integration waits for the dependency gate. **Partial deviation:** U6 (parser) and U10 (skill resolver) are already shipped inert; this PR ships derive *with* its wiring on `AGENTS.md` put. The wiring is itself the contract being tested. Inert-ship of the function alone would leave the recompute path untested at the handler boundary, which is the integration risk we want to flush before U21.
- `feedback_avoid_fire_and_forget_lambda_invokes` — derive is in-process to the handler, not a fire-and-forget invoke. The handler returns 500 on derive failure (not the orphan-success pattern that bit us in 2026-04-14).

### External References

None warranted. Stack is internal — composer + parser + Drizzle. No third-party API or framework version question.

### In-flight plans that interact

- **Plan §008 master** (`docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`) — U17 (agent builder shell), U18 (routing-row inline editor), U21 (retire skills-assignment page) all *call* the `put` handler that derive hooks into. They don't depend on derive directly; they depend on the AGENTS.md put working, which derive is part of.
- **Plan §008 U13** (DynamoDB advisory lock) — when shipped, will wrap `chat-agent-invoke` shared lock around derive's read. **Not blocking U11.** Derive currently runs without a lock; concurrent `setAgentSkills` + AGENTS.md put could race on `agent_skills` rows, but the composite unique index + Postgres MVCC make the race idempotent for the *set membership* part. Per-row metadata (`permissions` etc.) is still owned exclusively by `setAgentSkills`, which has its own ordering inside the transaction.

---

## Key Technical Decisions

- **Use `composeList(..., { includeContent: true })` rather than walking S3 directly.** This is the only path that respects agent-override / template / defaults precedence + sub-agent ancestor walks (U5 contract). Hand-rolling a "list AGENTS.md objects under {prefix}" would miss template-inherited files an agent has not overridden. Rationale: derive's correctness depends on the composer being the source of truth for "what files would the runtime see?" — the same path Strands cold-start uses.
- **Filter to AGENTS.md basename only.** From the composeList result, keep paths matching `(?:^|/)AGENTS\.md$`. Skip anything else (CONTEXT.md, IDENTITY.md, skills/*/SKILL.md, memory/*). The parser is happy to be called on every AGENTS.md regardless of folder depth — it locates a `## Routing` heading or single top-level table.
- **Skill cells are unioned across folders, deduped by slug, in stable insertion order.** Insertion order doesn't matter for storage (the unique index is `(agent_id, skill_id)`), but it matters for log readability when comparing the derived set vs the existing set in failure-diagnosis dumps. Sort alphabetically on read for deterministic equality checks; preserve discovery order in the warning logs.
- **Compare derived set vs existing set before writing.** If they're equal, return early — no transaction, no log noise. This is what prevents the `setAgentSkills → regenerateWorkspaceMap → AGENTS.md put → derive` loop from generating spurious writes. Equality compares slugs only (the columns derive doesn't manage are out of equality scope).
- **Single transaction for upsert + delete.** Drizzle's `db.transaction(async (tx) => { ... })`. Order: insert/upsert the derived set first, then delete rows whose `skill_id NOT IN (derived_set)`. Reverse order would create a window where a runtime read sees zero skills.
- **Derive *only* fires on `AGENTS.md` put.** Other workspace files (CONTEXT.md, SOUL.md, IDENTITY.md, USER.md, skills/*/SKILL.md, memory/*) don't change the routing-row skill set. Wasting a composeList round-trip on every CONTEXT.md edit is the kind of thing that bites later — keep the trigger narrow. Master plan §008 U11 line 702 already says "on `put` of any `AGENTS.md`."
- **`tenant_id` on each upsert row comes from the resolved agent (one DB lookup), not from the AGENTS.md content.** Same pattern `setAgentSkills.mutation.ts:46-54` uses. Mismatch with `ctx.tenantId` would already have failed in `composeList` (the cross-tenant isolation point). Derive trusts that boundary.
- **`enabled` defaults to `true` on insert; preserved on upsert.** Mirrors `setAgentSkills.mutation.ts:204`. The schema default already covers this; we make it explicit so a future schema migration that drops the default doesn't silently break derive.
- **Failure surface: parser throw → 500 with `error: "AGENTS.md parse failed: ${msg}"`; transaction rollback → 500 with `error: "agent_skills derive failed: ${msg}"`.** No silent-warning path; the `put` is rejected so the caller knows the file did *not* persist a usable state. This is the opposite of the existing `regenerateWorkspaceMap` which `console.error`s and swallows — that pattern is acceptable for the legacy AGENTS.md-from-DB direction (the file is regenerated next save) but not acceptable here, because the user's last-good AGENTS.md content is *the input* that's now broken.

---

## Open Questions

### Resolved During Planning

- **Q: Does `composeList` already include sub-agent AGENTS.md paths?** → Yes, U5 (#570) added the union-path collector to walk every layer's prefix, which surfaces `<folder>/AGENTS.md` whenever the folder exists in agent-override, template, or defaults. Verified via `packages/api/src/lib/workspace-overlay.ts:668-697` (`collectUnionPaths`).
- **Q: What if AGENTS.md only exists at the template layer (no agent override)?** → composeList still returns it (with `source: "template"` and content filled). Derive parses it the same way; the resulting `agent_skills` row is correct because the agent inherits the template's routing.
- **Q: What if two folders have AGENTS.md and both reference the same skill slug?** → Dedup by slug; one row in `agent_skills`. Insertion order log shows both folders for diagnostics.
- **Q: Should derive run on a *delete* of AGENTS.md too?** → No. Deletion is an extreme operation that admin UI doesn't expose for AGENTS.md. If it ever happens via the REST handler, the next AGENTS.md *write* triggers a re-derive. Not worth wiring `handleDelete` for an out-of-band operation.
- **Q: How do we know an AGENTS.md path is for *this* agent and not the template/defaults layer?** → `composeList` with `agentId` already restricts to that agent's composed view. Template-scope edits (`target.kind === "template"`) flow through a different `handlePut` branch that doesn't call derive.

### Deferred to Implementation

- **Latency under load:** the 500 ms budget is the master plan's stated number. We'll measure on an agent with 5 folders × 1 AGENTS.md each in CI fixtures and surface the actual p95 in the PR description. If we blow the budget, the fix is parallelizing the per-file content reads inside `composeList`, not in derive itself — composeList already does the S3 reads serially in `composeListIncludeContent` (line 645). That's a follow-up.
- **Slug validation against `skill_catalog`:** master plan U6 leaves slug-form validation (`^[a-z0-9-]+$`) at the parser; derive doesn't double-check that the slug exists in `skill_catalog`. A typo in AGENTS.md would create an `agent_skills` row pointing at a non-existent skill. The runtime resolver (U10) already raises `SkillNotResolvable` for that case, surfaced to the agent. We can add a foreign-key check in a follow-up if it becomes painful in practice.
- **Telemetry for the deprecation log:** how do we count `setAgentSkills` calls during the U17–U21 transition? CloudWatch log filter on the new warning string is fine for v1; if we want a metric, plumb through `cost-recording.ts` or the existing `console` adapter — separate decision.

---

## Implementation Units

- U1. **`derive-agent-skills.ts` library function (no wiring)**

**Goal:** Pure-ish library function that, given an agent id + tenant id, walks the composed tree, parses every AGENTS.md, and writes the derived `agent_skills` set. Tested in isolation with mocked `composeList`.

**Requirements:** R1, R2, R3, R7.

**Dependencies:** U6 (#571, parser), U10 (#574/#575, resolver — not directly used here but the skill-set semantics align), U5 (#570, recursive composer).

**Files:**
- Create: `packages/api/src/lib/derive-agent-skills.ts`
- Test: `packages/api/src/__tests__/derive-agent-skills.test.ts`

**Approach:**
- Exported signature: `deriveAgentSkills(ctx: ComposeContext, agentId: string): Promise<DeriveResult>` where `DeriveResult = { changed: boolean; addedSlugs: string[]; removedSlugs: string[]; foldersScanned: string[]; warnings: string[] }`.
- Use `composeList(ctx, agentId, { includeContent: true })` and filter to entries where path matches `(?:^|/)AGENTS\.md$`. Sort by path so root (`AGENTS.md`) is first; sub-agent folders follow alphabetically — gives deterministic discovery-order logging.
- For each AGENTS.md, call `parseAgentsMd(content)`. Collect `result.warnings` into a per-call array (forward to caller — `console.warn` happens in U2's wiring, not in this pure-ish function). Re-throw parser errors with the path prefixed: `Error("AGENTS.md parse failed at <path>: <message>")`. This keeps the file-level error context tight without losing the parser's specific reason.
- Union all `routing[].skills` arrays into a single ordered slug list. Dedup with a `Set`; preserve first-seen order in `addedSlugs` log only. The DB write uses a sorted-alphabetical list.
- Look up the existing `agent_skills` rows for this agent (`db.select({ skill_id }).from(agentSkills).where(eq(agentSkills.agent_id, agentId))`).
- Compute `addedSlugs` (in derived, not in existing) and `removedSlugs` (in existing, not in derived). If both are empty → return `{ changed: false, ... }` without opening a transaction.
- If non-empty: resolve `tenant_id` via `db.select({ tenant_id }).from(agents).where(eq(agents.id, agentId))` — fail with `Error("Agent ${agentId} not found")` if missing.
- `db.transaction(async (tx) => { ... })`:
  1. For each derived slug: `insert ... onConflictDoNothing` on `(agent_id, skill_id)`. We do *not* `onConflictDoUpdate` — preserving `permissions`, `config`, `rate_limit_rpm`, `model_override`, `enabled` for already-present rows is the whole point. New rows pick up schema defaults.
  2. If `removedSlugs.length > 0`: `delete ... where agent_id = ? AND skill_id IN (removedSlugs)`.
- Return `{ changed: true, addedSlugs, removedSlugs, foldersScanned, warnings }`.

**Execution note:** Test-first. Write the integration test (mocked `composeList`) before the implementation — the function's surface (`DeriveResult` shape, dedup ordering, no-op detection) is what an implementer would otherwise be tempted to over-design.

**Patterns to follow:**
- `packages/api/src/lib/workspace-map-generator.ts` — existing derivative writer, similar S3-driven shape (but inverse direction).
- `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts:150-220` — the upsert-then-delete-not-in-list pattern. Mirror this ordering.
- `packages/api/src/__tests__/workspace-overlay.test.ts` — vitest mock pattern for the composer.

**Test scenarios:**
- Covers AE6. Happy path: `composeList` mock returns `AGENTS.md` (root, 1 skill `approve-receipt`) + `expenses/AGENTS.md` (2 skills `tag-vendor`, `approve-receipt`) + `recruiting/AGENTS.md` (1 skill `score-candidate`). Existing `agent_skills` is empty. Result: `changed: true`, derived set `{approve-receipt, score-candidate, tag-vendor}` (3 rows, dedup). `addedSlugs` length 3, `removedSlugs` empty.
- Happy path: existing rows exactly match the derived set → `changed: false`, no transaction opens. Verified via `db.transaction` spy.
- Happy path / Edge: existing `agent_skills` has 2 rows with `permissions: { ops: [...] }` and `rate_limit_rpm: 60`; derive recomputes the same 2 slugs → upsert preserves the metadata (no UPDATE issued because of `onConflictDoNothing`).
- Edge case: 2 routing rows in different folders both reference `tag-vendor` → 1 row in derived set, dedup. `foldersScanned` shows both folder paths.
- Edge case: composeList returns 0 AGENTS.md (template inheritance gap) → derived set is empty; if existing was non-empty, all rows deleted; `removedSlugs` lists every prior slug. *(This is the test scenario from master plan U11 line 721.)*
- Edge case: AGENTS.md with empty `Skills` cells (every routing row has empty `skills:`) → derived set empty, same delete behavior.
- Error path: `parseAgentsMd` throws (multiple top-level tables, no `## Routing` heading) → derive throws with the path prefixed. No DB writes attempted.
- Error path: `db.select(agents)` returns empty (agent not found) → throws `Error("Agent ${agentId} not found")`; no transaction.
- Integration: malformed sub-folder AGENTS.md → derive throws; root + good folders' upsert is *not* applied (transaction never opens because we throw during parse before constructing the derived set).
- Edge case: routing row with reserved goTo (`memory/`) → parser already filtered into `skippedRows`; derive sees it in `result.skippedRows` but does *not* count its skills (they were tied to the skipped row). Verify by including such a row in the fixture and asserting the `memory`-row's skills don't appear in the derived set.
- Edge case: two folders with the same skill but different casing (`approve-receipt` vs `Approve-Receipt`) → parser already strips decorations but does *not* lowercase. Document in the test that derive treats them as distinct slugs (matches the `agent_skills.skill_id` text column behavior); operators must keep slugs canonical in AGENTS.md. Add this test as a *negative-assertion fixture* so a future "lowercase everything" change has to update the test consciously.

**Verification:**
- All test scenarios green.
- `pnpm --filter @thinkwork/api typecheck` passes.
- The function exports a single public surface; no incidental helpers leak.

---

- U2. **Wire `derive-agent-skills` into `workspace-files.ts` `put` handler**

**Goal:** Every successful `put` of an `AGENTS.md` path on the agent branch triggers `deriveAgentSkills`. Failure of derive fails the put with a 500.

**Requirements:** R5, R7.

**Dependencies:** U1.

**Files:**
- Modify: `packages/api/workspace-files.ts` — `handlePut`, agent branch.
- Test: `packages/api/src/__tests__/workspace-files-handler.test.ts` — extend with derive-on-AGENTS.md-put cases.

**Approach:**
- In `handlePut` agent branch: after `invalidateComposerCache({ tenantId, agentId: target.agentId })`, check if `path === "AGENTS.md"` or `path.endsWith("/AGENTS.md")` (any folder depth). If yes, call `await deriveAgentSkills({ tenantId }, target.agentId)` inside a try/catch.
- On success: log a single line `[derive-agent-skills] agent=${target.agentId} folders=${foldersScanned.length} added=${addedSlugs.join(',')} removed=${removedSlugs.join(',')} changed=${changed}` (omit empty arrays).
- On parser error or transaction error: log `console.error` with the full message, return `json(500, { ok: false, error: "AGENTS.md persisted but agent_skills derive failed: ${message}" })`. **Note:** the S3 put has already succeeded at this point — that's by design. Reverting an S3 write would require a versioning + atomic-rename dance we don't have. The error message tells the caller the file is on disk but the DB is stale; the next AGENTS.md save (or a manual `regenerate-map` action) re-runs derive.
- Forward parser warnings to the caller in the success response: `json(200, { ok: true, deriveWarnings: warnings })` when `warnings.length > 0`. Existing callers ignore extra response fields; admin UI gets a place to surface warnings later.
- Do **not** call derive on the template/defaults branch — those edits don't change a single agent's composed AGENTS.md until the next `regenerateManifest` lands them in the agent's view; and U21 will route the per-agent derive through agent-overrides anyway.

**Patterns to follow:**
- `packages/api/workspace-files.ts:474-529` — `handleUpdateIdentityField` is the existing pattern for action-specific extra logic in the agent branch. Mirror its try/catch + json-response shape.
- `packages/api/src/__tests__/workspace-files-handler.test.ts` — vitest with `vi.mock` for s3 + db. Reuse the existing setup; add cases for the AGENTS.md path.

**Test scenarios:**
- Happy path: `put` of `path: "AGENTS.md"` with valid routing-table content → 200 OK, response includes the (mocked) derive log line in handler logs. Mock `deriveAgentSkills` to return `{ changed: true, addedSlugs: ["a"], ... }`.
- Happy path: `put` of `path: "expenses/AGENTS.md"` triggers derive with the same `target.agentId`.
- Edge case: `put` of `path: "CONTEXT.md"` does **not** call derive. Verify with a `vi.spyOn(deriveModule, "deriveAgentSkills")` and assert the spy not called.
- Edge case: `put` of `path: "expenses/CONTEXT.md"` does not call derive (path doesn't end with AGENTS.md).
- Error path: derive throws (parser error) → handler returns 500 with the error message. S3 put was already issued (verify `s3.send` called; confirm error path doesn't try to undo it).
- Edge case: `put` on the **template** branch (`target.kind === "template"`) → derive not called even when `path` ends with `AGENTS.md`. Template edits flow through a different code path that runs templateScope cache invalidation only.

**Verification:**
- The new test cases pass; existing handler tests still pass.
- A real-staging dry-run: write a 2-folder AGENTS.md via the Lambda (or via `thinkwork-cli` workspace put), inspect `agent_skills` rows.
- No cache loop: a `put` triggered from `regenerateWorkspaceMap` (which is called from `setAgentSkills`) runs derive, which finds the set already matches, returns `changed: false`, no transaction.

---

- U3. **Deprecate `setAgentSkills` mutation with a one-time-per-call warning**

**Goal:** Surface a single deprecation log line on every `setAgentSkills` call so we can identify last-callers in the admin UI before U21 retires the mutation.

**Requirements:** R6.

**Dependencies:** None (independent of U1, U2 — purely a logging change).

**Files:**
- Modify: `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`
- Test: `packages/api/src/__tests__/set-agent-skills-deprecation.test.ts` *(or extend an existing setAgentSkills test if one exists; verify via grep before deciding)*

**Approach:**
- After `requireTenantAdmin(ctx, agent.tenant_id)` (line 54), add a single line:
  ```ts
  console.warn(
    `[setAgentSkills] DEPRECATED — derive-agent-skills (U11) is now the canonical writer. agent=${args.agentId} caller_authType=${ctx.auth.authType}`,
  );
  ```
- Do **not** behavior-gate on a feature flag. The mutation continues to work exactly as before; this is a beacon, not a deprecation lockout. U21 will remove the mutation entirely.
- Do **not** rate-limit the warning. CloudWatch Logs Insights queries are easier when every call emits a line; the cost is trivial.

**Patterns to follow:**
- The existing `console.warn` at `setAgentSkills.mutation.ts:58` (`Ignoring empty skills list`) — same level, same format.

**Test scenarios:**
- Happy path: a successful `setAgentSkills` call emits the deprecation `console.warn` exactly once. Use `vi.spyOn(console, "warn")` and assert call count + substring match.
- Edge case: the empty-skills early-return path (line 57) emits *both* warnings (the existing one and the new one); spy assertions accept that.
- Edge case: the `apikey` self-edit GraphQLError throw (line 33) does *not* reach the warning (returns before). Verify via the spy not being called.

**Verification:**
- New test green.
- Manual grep over the codebase: no caller of `setAgentSkills` is removed in this PR — that's U21's job.

---

- U4. **Documentation note: AGENTS.md is the writer; `agent_skills` is derived**

**Goal:** A short paragraph in the existing developer docs that names derive-agent-skills as the canonical writer and explains why the legacy `setAgentSkills` mutation logs a deprecation warning.

**Requirements:** Documentation hygiene; no functional requirement.

**Dependencies:** U1, U2, U3.

**Files:**
- Modify: `CLAUDE.md` — extend the "Architecture: the end-to-end data flow" section with one bullet under §4 Persistence.
- Modify (if exists): `docs/agent-design/` Starlight pages introduced by master plan U29 — only if §008 U29 has already shipped; otherwise defer and let U29 author the canonical doc.

**Approach:**
- Two-sentence add to `CLAUDE.md`: "`agent_skills` is **derived** from composed AGENTS.md routing rows; `derive-agent-skills.ts` runs on every `AGENTS.md` put. The legacy `setAgentSkills` mutation continues to work but logs a deprecation warning — U21 will retire it."
- Skip the docs/agent-design/ page edit if the directory doesn't exist yet (U29 is still upstream).

**Patterns to follow:**
- The existing CLAUDE.md §4 bullets — short, declarative, file-path-anchored.

**Test scenarios:** Test expectation: none — pure docs change.

**Verification:**
- `grep -n "derive-agent-skills" CLAUDE.md` returns the new line.

---

## System-Wide Impact

- **Interaction graph:** `workspace-files.ts:handlePut` (agent branch) → `invalidateComposerCache` → `deriveAgentSkills` → `composeList` → `parseAgentsMd` (per file) → `db.transaction(...)` upserts/deletes on `agent_skills`. Existing caller `setAgentSkills.mutation.ts` → `regenerateWorkspaceMap` → S3 put of root AGENTS.md → (handler now also calls derive) → re-derives the same set → no-op return.
- **Error propagation:** Parser throw → handler 500 (S3 already wrote; client knows DB is stale and next save retries). Transaction throw → handler 500 (S3 wrote; DB unchanged; same retry pattern).
- **State lifecycle risks:** A successful S3 put with a failed derive leaves AGENTS.md on disk but `agent_skills` stale. The next AGENTS.md save retries derive. Worst case: an operator writes a malformed AGENTS.md, the put 500s, they fix it, the next put 200s and `agent_skills` syncs. The chat-agent runtime, in the meantime, reads from `agent_skills` and sees the *previous* derived state — correct behavior.
- **API surface parity:** No GraphQL or REST schema change. Response from the put handler grows an optional `deriveWarnings` array; existing callers ignore unknown fields.
- **Integration coverage:** Mocks-only tests prove the upsert/delete logic. The "derive runs after S3 put" coverage is at the handler-test layer (U2). A real end-to-end check (write AGENTS.md via CLI, query `agent_skills` over psql) is the manual verification step before merging.
- **Unchanged invariants:** `regenerateWorkspaceMap` continues to produce the same root AGENTS.md from `agent_skills`. The runtime `chat-agent-invoke.ts` continues to read `agent_skills` for `skills_config`. The composite unique index on `(agent_id, skill_id)` continues to enforce one row per slug per agent. The `permissions`, `config`, `rate_limit_rpm`, `model_override`, `enabled` columns remain owned by `setAgentSkills` until U21.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Derive's failure surface (S3 wrote, DB didn't) leaves a brief stale window. | Document in the error message; rely on the next save to retry; never silently swallow. The legacy `regenerateWorkspaceMap` is the reverse direction and self-heals on next `setAgentSkills`. |
| `setAgentSkills` → `regenerateWorkspaceMap` → S3 put → derive could form a cache-busting loop or write storm. | The "compare derived set vs existing set; no-op if equal" check breaks the loop. Verified by U1 test scenario "existing rows match derived set → no transaction." |
| Latency budget (<500 ms) blown on agents with many sub-agent folders. | Master plan defers parallelization to a follow-up. Measure in CI fixtures; surface p95 in the PR description. If we blow it, the fix is in `composeList` (parallel S3 GETs), not in derive. |
| A skill-catalog slug rename leaves a dangling `agent_skills` row pointing at the old slug — derive will *delete* it on next AGENTS.md save. | This is correct by design (the slug isn't in any AGENTS.md anymore). Operators must update AGENTS.md routing rows when slug names change. Mitigation is operational, not in this PR. |
| Concurrent `setAgentSkills` + AGENTS.md put could race on `agent_skills` rows. | Composite unique index + Postgres MVCC make set-membership idempotent. Per-row metadata is owned by `setAgentSkills` only; derive's `onConflictDoNothing` preserves it. U13 (DynamoDB advisory lock) is the long-term fix for cross-handler ordering. |
| `parseAgentsMd` is import-cycle-proof? | No cycle — `agents-md-parser.ts` imports only `reserved-folder-names.ts`; derive imports `agents-md-parser.ts` + `workspace-overlay.ts` + Drizzle utils. No back-edge to graphql/. |

---

## Documentation / Operational Notes

- CloudWatch Logs Insights query for the deprecation warning (post-deploy, save in the runbook):
  - `fields @timestamp, @message | filter @message like /\\[setAgentSkills\\] DEPRECATED/ | stats count() by bin(1d)`
- Manual smoke (after merge to dev): `aws lambda invoke ... workspace-files --payload '{action:"put",agentId:"<id>",path:"AGENTS.md",content:"..."}'` then `psql ... -c "select skill_id from agent_skills where agent_id = '<id>'"` — expect rows to match the routing-table cells.
- No migration SQL needed. `agent_skills` schema is unchanged.
- No new env var, IAM grant, or Terraform diff. Reuses the workspace-files Lambda's existing S3+RDS access.

---

## Sources & References

- **Origin master plan:** `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md` lines 692-727 (U11 unit body), lines 27-46 (Requirements Trace mapping R20/R23 to U11).
- **U6 parser PR:** #571 (`packages/api/src/lib/agents-md-parser.ts`). Public surface documented inline in the file's `PINNED_SHAPE_CONTRACT`.
- **U10 resolver PRs:** #574, #575 (`packages/agentcore-strands/agent-container/container-sources/skill_resolver.py`).
- **U5 recursive composer PR:** #570 (`packages/api/src/lib/workspace-overlay.ts:475-666`).
- **Existing inverse-direction writer:** `packages/api/src/lib/workspace-map-generator.ts` (DB → AGENTS.md).
- **The mutation we're deprecating:** `packages/api/src/graphql/resolvers/agents/setAgentSkills.mutation.ts`.
- **Schema:** `packages/database-pg/src/schema/agents.ts:128-157` (`agentSkills` table).
