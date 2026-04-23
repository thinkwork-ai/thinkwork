---
title: Sort admin template skills alphabetically and rename composable-primitive → workflow
type: refactor
status: active
date: 2026-04-23
---

# Sort admin template skills alphabetically and rename composable-primitive → workflow

## Overview

Two small UX improvements to the admin **Agent Templates → Edit Template → Skills** tab:

1. Sort the skills table alphabetically by name so the list is predictable as the catalog grows.
2. Rename the category label `composable-primitive` → `workflow` on the skills currently tagged with it (frame, gather, synthesize, package, compound, skill-dispatcher, and the `customer-onboarding-reconciler/act` sub-skill) so the badge reads as a human-friendly grouping instead of internal framework jargon.

The category field is purely a display label — no code branches on the string value — so the rename is mechanical. No DB migration is required because the value lives in a free-text `text("category")` column populated from `skill.yaml` files via the existing catalog sync.

---

## Problem Frame

Today the Skills tab on a template renders catalog rows in whatever order the API returns them (effectively DB insertion order). With ~17 skills today and more landing as connector skills are built (see `project_composable_skills_r13_next` memory), the list is already hard to scan and will get worse.

Seven of those rows carry the category badge `composable-primitive`. That label was inherited from the composable-skills framework terminology and leaks internal concepts into an operator-facing surface. Operators building templates shouldn't need to know what a "primitive" is — they need a label that hints at what these skills are *for*. `workflow` communicates that frame/gather/synthesize/package/etc. are the pieces an agent uses to move through a reasoning workflow.

---

## Requirements Trace

- R1. The Skills tab DataTable renders catalog rows sorted alphabetically (case-insensitive) by display name.
- R2. Every skill currently tagged `category: composable-primitive` in `packages/skill-catalog/*/skill.yaml` is retagged to `workflow`.
- R3. After a catalog sync to the dev stack DB, the admin Skills tab shows the new `workflow` badge on all seven affected rows, and no rows still show `composable-primitive`.
- R4. No code path (admin, API, Strands runtime) breaks on the category rename — verified by the absence of string literal dependencies on `composable-primitive` (confirmed by repo search during planning; plan continues to treat this as a renaming of a display value).

---

## Scope Boundaries

- Not redesigning the Skills tab layout, filters, pagination, or column set.
- Not renaming any other category values (`productivity`, `operations`, `communication`, `orchestration`, `task-management`, `research` stay as-is).
- Not changing the schema — `skill_catalog.category` remains a free-text `text` column.
- Not refactoring the category taxonomy into an enum or lookup table. That's a larger design question about whether categories should be controlled vocabulary; out of scope for this PR.
- Not adding an admin-side UI for reordering skills manually — alphabetical sort only.
- Not touching the `category: composable-primitive` references that appear in README prose, plan documents, or code comments (those describe the *framework*, not the UI label).

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx` — the template edit page. Skills tab starts at the `activeTab === "skills"` block (~line 817); catalog is loaded via `listCatalog().then(setCatalog)` (~line 310) and passed directly to `<DataTable data={catalog} />` (~line 892). Sort needs to happen between the fetch and the render.
- `apps/admin/src/lib/skills-api.ts` — `listCatalog()` typed as `CatalogSkill[]` with a `name: string` field we sort on.
- `packages/skill-catalog/` — source of truth. Seven files currently declare `category: composable-primitive`:
  - `frame/skill.yaml`
  - `gather/skill.yaml`
  - `synthesize/skill.yaml`
  - `package/skill.yaml`
  - `compound/skill.yaml`
  - `skill-dispatcher/skill.yaml`
  - `customer-onboarding-reconciler/sub-skills/act/skill.yaml`
- `packages/skill-catalog/scripts/sync-catalog-db.ts` — reads every `skill.yaml` and upserts into `skill_catalog` in Aurora; used to propagate the rename to the DB. Line 153 maps YAML `category` straight into the insert payload, so no script change needed.
- `packages/api/src/handlers/skills.ts` `getCatalogIndex()` (~line 620) — returns `category: r.category` verbatim from the DB. No branching on the value.
- `packages/database-pg/src/schema/skills.ts:33` — `category: text("category")` (nullable free-text column; no enum, no constraint).

### Institutional Learnings

- `project_composable_skills_r13_next` — hardening + context-dispatch shipped; connector script skills are next. Renaming the display category now (before more skills land) keeps a smaller blast radius than doing it after R13 connector skills are authored.
- `feedback_graphql_deploy_via_pr` — the admin + API changes deploy via PR to main; no hotfix-style direct Lambda update.

### External References

- None needed — this is a display-only rename plus a one-line sort.

---

## Key Technical Decisions

- **Sort in the client, not the API.** The catalog endpoint is generic and serves other consumers (mobile, CLI); ordering is a UI concern specific to the admin template edit page. Sort inside `$templateId.tsx` using `useMemo` over the `catalog` state so re-renders don't resort on every keystroke.
- **Case-insensitive sort by `name`, stable with `localeCompare`.** `String.prototype.localeCompare` with `{ sensitivity: "base" }` is the idiomatic modern choice for user-visible alphabetical ordering.
- **No DB migration.** `skill_catalog.category` is free-text; re-running `sync-catalog-db.ts` against the YAML upserts the new value and overwrites the old one per the script's `onConflictDoUpdate` behavior. No backfill script needed.
- **Rename in one atomic PR.** YAML changes + sync script run + admin sort land together so the dev stack never shows a split label state.
- **Search-and-replace in YAML only, not in prose/comments.** The string `composable-primitive` also appears in README/plan/comment prose describing the composable-skills framework — those are historically accurate references to a framework concept and should not be retagged.
- **The `act` sub-skill keeps the `workflow` tag.** It was categorized alongside frame/gather/synthesize/package/compound because it's an action primitive in the same composition mode. Tagging it `workflow` preserves the original intent under the new label.

---

## Open Questions

### Resolved During Planning

- **What to rename `composable-primitive` to?** → `workflow` (user selection).
- **Where to sort?** → Client-side in the admin route, not in the API.
- **Does this need a DB migration?** → No — `skill_catalog.category` is nullable free-text; the sync script handles the overwrite.

### Deferred to Implementation

- Whether to also sort the per-agent Skills tab (`apps/admin/src/routes/_authed/_tenant/agents/$agentId_.skills.tsx`). If the same DataTable pattern exists there and the inconsistency would be jarring, extend the sort. Out of scope for this plan unless the implementer finds it trivial.

---

## Implementation Units

- [ ] U1. **Retag `composable-primitive` → `workflow` in skill.yaml files**

**Goal:** Update the source-of-truth category value on the seven affected skills.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `packages/skill-catalog/frame/skill.yaml`
- Modify: `packages/skill-catalog/gather/skill.yaml`
- Modify: `packages/skill-catalog/synthesize/skill.yaml`
- Modify: `packages/skill-catalog/package/skill.yaml`
- Modify: `packages/skill-catalog/compound/skill.yaml`
- Modify: `packages/skill-catalog/skill-dispatcher/skill.yaml`
- Modify: `packages/skill-catalog/customer-onboarding-reconciler/sub-skills/act/skill.yaml`

**Approach:**
- Single-line change in each file: `category: composable-primitive` → `category: workflow`.
- Do not touch any other field, any README text, or any plan document that mentions the `composable-primitive` framework concept.

**Patterns to follow:**
- Existing skill.yaml structure. The category field is a plain scalar with no quoting in any of the seven files today — keep it unquoted.

**Test scenarios:**
- Test expectation: none — this is a data-only source-of-truth edit; behavior is verified end-to-end in U3.

**Verification:**
- `grep -r "composable-primitive" packages/skill-catalog --include="*.yaml"` returns zero matches.
- `grep -r "category: workflow" packages/skill-catalog --include="*.yaml"` returns exactly seven matches.

---

- [ ] U2. **Sort catalog rows alphabetically in the Skills tab**

**Goal:** Render the Skills tab DataTable with rows sorted case-insensitively by skill display name.

**Requirements:** R1

**Dependencies:** None (parallel with U1)

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx`

**Approach:**
- Add a `useMemo` derived from `catalog` that returns a new array sorted by `name` using `localeCompare` with `{ sensitivity: "base" }`.
- Pass the sorted array (not raw `catalog`) as the DataTable's `data` prop in the Skills tab block.
- Keep `catalog` as the state source of truth — the derived sorted copy is for rendering only, so `availableSkills`, `catalogMap`, and any other consumer that doesn't care about order stay on the original.
- Do not change columns, page size, or any other DataTable prop.

**Patterns to follow:**
- Existing `useMemo` usage in the same file (the manifest meta cache dependency array around line 320 shows the idiom).
- `String.prototype.localeCompare` with `sensitivity: "base"` — idiomatic for case- and accent-insensitive user-visible ordering.

**Test scenarios:**
- Happy path: given a catalog with names in reverse alphabetical order, the rendered table displays them A→Z.
- Edge case: case-mixed names (e.g., "artifacts" vs "Frame") interleave correctly under case-insensitive compare.
- Edge case: empty catalog renders without error (no rows, no sort work).

**Verification:**
- Local admin dev server on port 5174+ shows the Skills tab rows in alphabetical order.
- First row in the screenshot's context ("Artifacts") still appears at the top; "Web Search" appears near the bottom.
- No TypeScript or lint regressions: `pnpm --filter @thinkwork/admin typecheck` and `pnpm -r --if-present lint` clean.

---

- [ ] U3. **Propagate the rename to the dev stack and visually verify**

**Goal:** After U1 merges (or pre-merge in a preview), the dev-stage `skill_catalog` table reflects the new category and the admin UI shows `workflow` badges for all seven skills.

**Requirements:** R3, R4

**Dependencies:** U1

**Files:**
- No code changes. Operational step.

**Approach:**
- Run `pnpm tsx packages/skill-catalog/scripts/sync-catalog-db.ts` against the dev stage. The script's `onConflictDoUpdate` upserts the new category value over the existing row.
- Open the admin dev server, navigate to **Agent Templates → Default → Skills**, and confirm: (a) all rows are alphabetical (from U2), (b) the seven affected skills display a `workflow` badge, (c) no row still shows `composable-primitive`.
- If any stale row is observed, re-check that the YAML edits in U1 saved correctly and rerun the sync.

**Patterns to follow:**
- `packages/skill-catalog/README.md` documents the sync script invocation.

**Test scenarios:**
- Test expectation: none — verification is a live UI inspection, not a code test. Existing unit/integration tests for the catalog handler continue to pass unchanged because they don't assert on category values.

**Verification:**
- `psql "$DATABASE_URL" -c "SELECT slug, category FROM skill_catalog WHERE slug IN ('frame','gather','synthesize','package','compound','skill-dispatcher','act') ORDER BY slug;"` shows `workflow` for every row.
- Visual confirmation in the admin SPA matches the description above.
- `grep -r "composable-primitive" apps/admin packages/api` returns no matches related to category display (README/plan/comment prose unrelated to the UI label is fine).

---

## System-Wide Impact

- **Interaction graph:** None. The category string is read-through from YAML → DB → API → UI badge. No resolver, Lambda handler, Strands tool, or MCP server branches on the value.
- **Error propagation:** Unchanged.
- **State lifecycle risks:** Brief split state between U1 merging and the dev sync running — the UI would show `composable-primitive` until the sync lands. Acceptable because the sync is a one-command operator action that runs immediately after deploy.
- **API surface parity:** The `/api/skills/catalog` response shape is unchanged — only the value of `category` for seven rows differs. Mobile and CLI consumers receive the same payload structure and don't render the category value in any gatekeeping way.
- **Unchanged invariants:** `skill_catalog.category` remains free-text `text` (no schema change). All other categories (`productivity`, `operations`, `communication`, `orchestration`, `task-management`, `research`) are untouched. Skill dispatch, permissions, and template sync logic are unaffected.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A downstream consumer silently depends on the literal string `composable-primitive`. | Repo-wide search during planning confirmed zero code references outside `skill.yaml` and descriptive prose. U3's verification step includes a post-sync grep. |
| Someone re-syncs the catalog from a stale checkout and reverts the rename. | The YAML is the source of truth and is merged to main in the same PR as the admin change; a stale re-sync would show in diff review. |
| The `act` sub-skill's category tag was a classification mistake, not deliberate. | Out of scope to re-classify — keep the original intent (composition-mode action primitive) under the new label. A follow-up can retag it separately if needed. |

---

## Sources & References

- Related code: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.tsx`, `packages/skill-catalog/*/skill.yaml`, `packages/skill-catalog/scripts/sync-catalog-db.ts`, `packages/api/src/handlers/skills.ts`
- Related work: composable-skills hardening (#422, #426) and R13 connector skills (`project_composable_skills_r13_next` memory)
