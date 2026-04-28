---
title: Relabel admin "Runtime" → "Harness" + add Harness columns to lists
type: refactor
status: completed
date: 2026-04-28
---

# Relabel admin "Runtime" → "Harness" + add Harness columns to lists

## Overview

Replay an admin-only presentation rename that was already implemented on the unmerged branch `refactor/admin-runtime-to-harness` (commits `b1cd291`, `153ed87`, dated 2026-04-27). The branch never landed on `main`, and PR #669 (`feat(admin): split agent template configuration layout`) since reorganized one of the target files, so a clean cherry-pick is no longer guaranteed. This plan re-grounds the same change against the current `main`.

The product term has settled on "Harness" for the Strands-vs-Pi execution substrate (see `apps/www` messaging refactors and `feat(www): Reground messaging around Agent Harness for Business`). The admin SPA still surfaces the old internal name "Runtime" in three operator-facing places, and two list views never gained a Harness column at all.

Four UI surfaces change:

1. **Agent Template detail** — single field label.
2. **New Agent dialog** (`AgentFormDialog`) — single field label + one helper microcopy line.
3. **Agent Templates list** — add a new Harness badge column (currently absent).
4. **Agents list** — add a new Harness badge column (currently absent), preserving the existing Status column.

No GraphQL schema changes. No internal identifier renames — the wire-format enum stays `AgentRuntime { STRANDS, PI }`, TS state stays `runtime` / `setRuntime`, and the `updateAgentRuntime` mutation keeps its name. Only user-visible strings change, plus two list queries gain the `runtime` field they don't yet select.

---

## Problem Frame

Operators working in admin can't tell at-a-glance which harness an agent or template runs on, because the Templates and Agents lists have never carried that column. Three other admin surfaces still call the field "Runtime" — inconsistent with how the product is now positioned externally and on the Agent Template detail's underlying data. Eric's hunch ("I thought we already did this") is correct: prior commits exist on a branch but never reached `main`. This plan documents what to redo and explicitly skips the wire-format rename.

---

## Requirements Trace

- R1. Agent Template detail page shows "Harness" instead of "Runtime" as the field label next to the Strands/Pi select.
- R2. New Agent dialog (`AgentFormDialog`) shows "Harness" instead of "Runtime" as the field label, and its one helper line below the select reads "previous harness" instead of "previous runtime".
- R3. Agent Templates list table gains a new Harness column rendering the template's runtime as a badge (e.g., "Strands", "Pi"), positioned between **Description** and **Model**.
- R4. Agents list table gains a new Harness column rendering the agent's runtime as a badge, positioned between **Agent Template** and **Human**. The existing Status column is preserved as-is.
- R5. Templates list and Agents list GraphQL queries select the `runtime` field (they don't today). The admin codegen artifacts are regenerated so the new fields are typed.
- R6. No GraphQL schema changes. No mutation rename. No TS identifier rename. Internal references to `runtime` / `AgentRuntime` are intentionally left in place because they match the wire format, per `feedback_verify_wire_format_empirically`.

---

## Scope Boundaries

- No changes to the mobile app — explicitly admin-only per Eric's request.
- No changes to the WWW marketing site, docs, or runbooks.
- No changes to the GraphQL schema, AgentCore SDK, or Strands/Pi container code. The internal name stays `runtime` everywhere except user-visible strings.
- No removal of the existing Agents-list "Status" column (deviates from prior commit `153ed87`, which replaced it). Confirmed with user 2026-04-28.
- No new sort options on either list — Harness is purely a display column.
- No shared `formatHarness` utility extraction yet — inline the helper on each list, mirroring the existing `formatModel` precedent ("third-caller rule").

### Deferred to Follow-Up Work

- The unmerged branch `refactor/admin-runtime-to-harness` and its now-stale plan file (which only exists in commit `b1cd291`, never on `main`): delete the branch after this plan's PR merges. Tracked here so it isn't forgotten.

---

## Context & Research

### Relevant Code and Patterns

- **Agent Template detail edit form** — `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx:654` renders `<Label>Runtime</Label>` next to a Strands/Pi `<Select>`. The `runtime` state (line 160) and `AgentRuntime.Strands | Pi` values stay untouched.
- **New Agent dialog** — `apps/admin/src/components/agents/AgentFormDialog.tsx`: `<FormLabel>` at line 253 reads "Runtime"; helper line at line 287 reads "In-flight chat will complete on the previous runtime." The `name="runtime"` `<FormField>` (line 248) and `runtime: z.nativeEnum(AgentRuntime)` (line 46) stay.
- **Agent Templates list** — `apps/admin/src/routes/_authed/_tenant/agent-templates/index.tsx`: columns array declared inline at lines 120–194. `TemplateRow` interface at line 31 needs a `runtime` field. `formatModel` helper at line 90 is the precedent for an inline `formatHarness`. The Source column at lines 162–171 already uses `<Badge variant="outline">` with `text-[10px]` — same styling for the new Harness badge.
- **Agents list** — `apps/admin/src/routes/_authed/_tenant/agents/index.tsx`: columns array at lines 45–121. `AgentRow` type at line 28 needs a `runtime` field. The Agent Template column at lines 68–80 uses `<Badge variant="outline" className="text-xs whitespace-nowrap">` — match that style for consistency rather than inventing new text sizes.
- **GraphQL queries that need a one-line addition** — `apps/admin/src/lib/graphql-queries.ts`:
  - `AgentsListQuery` (lines 8–45) selects `status`, `templateId`, `agentTemplate { ..., model }` etc., but does NOT select `runtime`. Add it directly on the agent.
  - `AgentTemplatesListQuery` (lines 1667–1689) selects `model`, `source`, etc., but does NOT select `runtime`. Add it.
- **Queries already selecting runtime (no change needed)** — `AgentDetailQuery` (`runtime` on agent), `AgentTemplateDetailQuery`, and the `Update*Runtime` / `Update*Template` mutations.
- **Enum + display values** — `apps/admin/src/gql/graphql.ts:326` defines `AgentRuntime { Strands = 'STRANDS', Pi = 'PI' }`. The values come back as `STRANDS` / `PI` (uppercase) from the server. The inline `formatHarness` helper title-cases them to "Strands" / "Pi", matching the existing `<SelectItem>` literal labels and the prior commit's approach.

### Institutional Learnings

- `feedback_verify_wire_format_empirically.md` — applicable in reverse: it tells us *not* to bulk-rename wire-format identifiers as a side effect of UI relabelling. The plan respects this by keeping `runtime` / `AgentRuntime` everywhere except user-visible strings.
- `feedback_user_opt_in_over_admin_config.md` — does NOT apply. Harness selection is operator-facing infrastructure config (admin's domain), not a per-user integration setting.
- Prior commits `b1cd291` and `153ed87` on branch `refactor/admin-runtime-to-harness` are the authoritative reference for the exact text and column positioning that was approved. They are usable as a paste-source for the label and helper-line strings, but the column-insertion code must be redone against current `main` because PR #669 reorganized `$templateId.$tab.tsx` and the prior plan also *replaced* the Agents-list Status column rather than adding alongside it.

### External References

- None required. Pure presentation-layer change with local precedent on every surface.

---

## Key Technical Decisions

- **Don't cherry-pick the prior commits.** PR #669 reshaped `$templateId.$tab.tsx` and the prior commit's diff is small enough that re-applying by hand is faster than resolving conflicts. Use the prior commits as a textual reference only.
- **Add the Agents-list Harness column instead of replacing Status.** Confirmed with user 2026-04-28; deviates from prior commit `153ed87`.
- **Render Harness as a Badge, not plain text.** User's request explicitly said "(badge)". The prior commit rendered it as muted text via an inline `formatHarness`; the badge form is more scannable on a dense list and matches how Source / Agent Template are already rendered.
- **Keep the `formatHarness` helper inline per list.** Two callers, no shared util — mirrors the existing `formatModel` pattern in the same file. Extract only when a third caller appears.
- **Codegen runs once, not per unit.** All GraphQL changes land in U3+U4; regenerate `pnpm --filter @thinkwork/admin codegen` once after both queries are edited so `gql/gql.ts` and `gql/graphql.ts` aren't churned twice.

---

## Open Questions

### Resolved During Planning

- *Should the Agents list replace Status or add Harness alongside?* → Add alongside. Confirmed with user 2026-04-28.
- *Should the dialog rename be in scope?* → Yes. Confirmed with user 2026-04-28.
- *Plain text or Badge for the new columns?* → Badge, per user's "(badge)" annotation on image #2.
- *Cherry-pick vs. re-apply?* → Re-apply by hand; PR #669 reorganized one target file enough that cherry-picking is not net-faster.

### Deferred to Implementation

- Exact `Badge` variant/size for the Harness column — match existing same-list precedent (Source on templates list, Agent Template on agents list) and adjust if it looks visually off in the dev server. Decide at implementation time after seeing it in the browser.

---

## Implementation Units

- U1. **Rename Runtime label on Agent Template detail**

**Goal:** Change the user-visible field label on the Agent Template detail's Configuration tab from "Runtime" to "Harness".

**Requirements:** R1, R6

**Dependencies:** None.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx`

**Approach:**
- Change `<Label>Runtime</Label>` (currently around line 654) to `<Label>Harness</Label>`. Leave the surrounding `<Select>`, the `runtime` / `setRuntime` state, and the `AgentRuntime.Strands | Pi` `<SelectItem>` values untouched.

**Patterns to follow:**
- Same file's existing label conventions (`<Label>Model</Label>` directly above).

**Test scenarios:**
- *Test expectation: none* — pure label string swap, no behavior change. Visual verification in the dev server is the proof; covered in U5.

**Verification:**
- Editing an existing template renders "Harness" above the Strands/Pi select.
- Saving the template still hits the existing `updateAgentTemplate` mutation with `runtime` in the payload (no regression).

---

- U2. **Rename Runtime label + helper text in New Agent dialog**

**Goal:** Change the user-visible field label and the "previous runtime" helper microcopy in `AgentFormDialog`.

**Requirements:** R2, R6

**Dependencies:** None (independent of U1).

**Files:**
- Modify: `apps/admin/src/components/agents/AgentFormDialog.tsx`

**Approach:**
- Line 253: `<FormLabel ...>Runtime</FormLabel>` → `<FormLabel ...>Harness</FormLabel>`.
- Line 287: `In-flight chat will complete on the previous runtime.` → `In-flight chat will complete on the previous harness.`
- Leave the `name="runtime"` `<FormField>`, the Zod schema (`runtime: z.nativeEnum(AgentRuntime)`), and the `UpdateAgentRuntimeMutation` reference untouched.

**Patterns to follow:**
- The exact strings used in commit `b1cd291` — match for naming consistency with other surfaces.

**Test scenarios:**
- *Test expectation: none* — pure label/microcopy swap. Visual verification in the dev server is the proof; covered in U5.

**Verification:**
- Opening "New Agent" from the Agents list shows "Harness" above the Strands/Pi select.
- Switching the harness on an agent that has recent activity shows the helper line "In-flight chat will complete on the previous harness."
- Submitting the dialog still creates an agent and (when applicable) calls `updateAgentRuntime` with the selected runtime.

---

- U3. **Add Harness badge column to Agent Templates list (with query update)**

**Goal:** Render a new Harness column on the Agent Templates list table, between **Description** and **Model**, fed by `agentTemplate.runtime`.

**Requirements:** R3, R5

**Dependencies:** None (independent of U1, U2).

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts` (add `runtime` to `AgentTemplatesListQuery`).
- Modify: `apps/admin/src/routes/_authed/_tenant/agent-templates/index.tsx`.
- Regenerate: `apps/admin/src/gql/gql.ts`, `apps/admin/src/gql/graphql.ts` (codegen output, hands-off).

**Approach:**
- Add `runtime` (one line) to the `AgentTemplatesListQuery` selection set, near the `model` line.
- Import `AgentRuntime` from `@/gql/graphql`.
- Add `runtime?: AgentRuntime | null;` to the `TemplateRow` interface (line 31).
- Add an inline `formatHarness(runtime: AgentRuntime | null | undefined): string` helper next to `formatModel`. Implementation: `if (!runtime) return "—"; return runtime.charAt(0) + runtime.slice(1).toLowerCase();`
- Insert a new column object into the `columns` array between the Description column (currently index 1) and the Model column (currently index 2) with:
  - `id: "harness"`, `header: "Harness"`, sized to ~110px to fit "Strands".
  - Cell renders `<Badge variant="outline" className="text-[10px]">{formatHarness(row.original.runtime)}</Badge>` when `runtime` is present, falling back to the muted-em-dash treatment used elsewhere when null.
- Run `pnpm --filter @thinkwork/admin codegen` once after the query change so the typed document picks up the new field. Don't hand-edit `gql/*.ts`.

**Patterns to follow:**
- `formatModel` in the same file (line 90) — inline helper, no shared util.
- The Source column (line 162) — same `<Badge variant="outline" className="text-[10px]">` styling so the new column reads as part of the same visual family.

**Test scenarios:**
- *Happy path:* Templates list renders three or more rows, each showing a Harness badge with "Strands" or "Pi". Visual verification only — covered in U5.
- *Edge case:* A template with `runtime: null` (should not exist in practice given the GraphQL non-null type, but handled defensively) renders "—".
- *Integration scenario:* Codegen regeneration after adding `runtime` to the query produces no TypeScript errors in the rest of the admin SPA. Verified by `pnpm --filter @thinkwork/admin typecheck` in U5.

**Verification:**
- The Templates list shows a Harness column between Description and Model with a per-row badge.
- The column is not sortable (matches Source column behavior — purely informational).
- `pnpm --filter @thinkwork/admin typecheck` passes.

---

- U4. **Add Harness badge column to Agents list (with query update)**

**Goal:** Render a new Harness column on the Agents list table, between **Agent Template** and **Human**, fed by `agent.runtime`. The existing Status column stays in place.

**Requirements:** R4, R5

**Dependencies:** None (independent of U1–U3, but bundle codegen with U3 — see Approach).

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts` (add `runtime` to `AgentsListQuery`).
- Modify: `apps/admin/src/routes/_authed/_tenant/agents/index.tsx`.
- Regenerate: `apps/admin/src/gql/gql.ts`, `apps/admin/src/gql/graphql.ts` (codegen output, hands-off).

**Approach:**
- Add `runtime` (one line) to the `AgentsListQuery` agent selection set.
- Import `AgentRuntime` from `@/gql/graphql`.
- Add `runtime: AgentRuntime | null;` to the `AgentRow` type (line 28).
- Map `runtime: a.runtime ?? null` inside the `useMemo`-based mapper that produces `rows` (currently around line 156).
- Add an inline `formatHarness` helper at the top of the file (mirroring the templates list pattern) — same implementation as U3.
- Insert a new column object into the static `columns` array between the existing `agentTemplateName` column (index 2) and the `humanPairName` column (index 3) with:
  - `accessorKey: "runtime"`, `header: "Harness"`, sized to ~110px.
  - Cell renders `<Badge variant="outline" className="text-xs whitespace-nowrap">{formatHarness(row.original.runtime)}</Badge>` when `runtime` is present, falling back to the muted em-dash on null.
- Do **not** modify the `SortField` type, `FilterBarSort` options, or the existing Status column. The sort dropdown stays as-is.
- Run `pnpm --filter @thinkwork/admin codegen` once after both U3 and U4 query edits to keep the codegen diff to a single regeneration step.

**Patterns to follow:**
- `formatModel`-style inline helper, lifted from U3.
- The `agentTemplateName` column (line 68) — same `<Badge variant="outline" className="text-xs whitespace-nowrap">` styling so the new column reads as part of the same visual family.

**Test scenarios:**
- *Happy path:* Agents list renders rows with a Harness badge between Agent Template and Human. The column is consistent with the existing Agent Template badge sizing.
- *Edge case:* An agent created before runtime defaulted to STRANDS (defensive null) renders "—".
- *Integration scenario:* `OnAgentStatusChangedSubscription` real-time refetch still works — confirmed by adding/removing an agent in dev and watching the Harness column populate immediately. Subscription re-uses `AgentsListQuery`, so the new field flows in automatically.

**Verification:**
- The Agents list shows columns in this order: Name | Status | Agent Template | Harness | Human | Budget | Heartbeat.
- The Status column is unchanged in appearance and behavior.
- Adding or removing an agent in another tab still triggers a re-fetch via the subscription, and the new Harness column updates immediately for the affected row.
- `pnpm --filter @thinkwork/admin typecheck` passes.

---

- U5. **Local verification + open PR**

**Goal:** Cross-check all four surfaces in the admin dev server, run the standard pre-commit gauntlet, and open a PR targeting `main`.

**Requirements:** R1–R6

**Dependencies:** U1, U2, U3, U4.

**Files:**
- None (verification + git workflow only).

**Approach:**
- Boot `pnpm --filter @thinkwork/admin dev` (port 5174) and walk all four surfaces:
  1. `/agent-templates` — confirm Harness badge column between Description and Model.
  2. `/agent-templates/<id>/configuration` — confirm "Harness" label above the Strands/Pi select.
  3. `/agents` — confirm Harness column between Agent Template and Human; confirm Status column unchanged.
  4. From `/agents`, click "New Agent" — confirm "Harness" label and (if showing on a recent-activity agent edit) "previous harness" helper text.
- Run `pnpm --filter @thinkwork/admin typecheck`, `pnpm --filter @thinkwork/admin lint`, and `pnpm format:check` from the repo root.
- Commit per Conventional Commits: `refactor(admin): rename Runtime to Harness; add Harness columns to lists`.
- Push and open a PR against `main` (single PR, do NOT target the existing `refactor/admin-runtime-to-harness` branch — that branch is stale).
- After merge, delete the local branch + worktree per `feedback_cleanup_worktrees_when_done`. Also delete the unmerged remote branch `refactor/admin-runtime-to-harness` so the orphan plan file from `b1cd291` can't get re-discovered later.

**Test scenarios:**
- *Happy path:* All four screenshots visually match the user's intent (badge column on lists, renamed label on detail + dialog).
- *Integration scenario:* `pnpm --filter @thinkwork/admin typecheck` passes after codegen.

**Verification:**
- PR opens green on the four standard checks.
- Eric (or whoever signs off) confirms the four surfaces match the screenshot expectations.
- The unmerged `refactor/admin-runtime-to-harness` branch is deleted from origin after the new PR merges.

---

## System-Wide Impact

- **Interaction graph:** None beyond the two list queries gaining a `runtime` field. No new mutations, no new resolvers, no schema diff.
- **Error propagation:** Unaffected. `runtime` is non-null on the GraphQL types — the helper still defends against null defensively because admin sometimes ships ahead of schema changes.
- **State lifecycle risks:** None. No data is being written, only displayed.
- **API surface parity:** Mobile and CLI continue to use whatever vocabulary they currently use. Their queries are unrelated to `AgentsListQuery` / `AgentTemplatesListQuery` in admin.
- **Integration coverage:** The `OnAgentStatusChangedSubscription` re-fetch path implicitly carries the new `runtime` field because it re-runs the same `AgentsListQuery`. Verified in U4's integration scenario.
- **Unchanged invariants:** GraphQL `runtime` field, `AgentRuntime` enum, `updateAgentRuntime` mutation, `runtime` Zod field on `AgentFormDialog`, the Status column on the Agents list, and the templates-list Source column — all explicitly unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Codegen drift if `pnpm --filter @thinkwork/admin codegen` isn't re-run after the query edits — leaves `gql/*.ts` out of sync and the typecheck fails on `runtime` not existing on the typed document. | U3+U4 explicitly require running codegen once after both query edits. U5's `typecheck` step is the gate. |
| Admin port collision when running the dev server in a worktree (must bind to 5175+, must be in Cognito callback URLs). | Per `project_admin_worktree_cognito_callbacks` — if a worktree is needed, add the port to the `ThinkworkAdmin` callback URL list before starting the second server. Single-tree dev on port 5174 sidesteps this entirely. |
| Lingering unmerged `refactor/admin-runtime-to-harness` branch could be rediscovered in a future session and double-applied. | U5 explicitly deletes that remote branch after this PR merges. |
| Visual badge sizing looks inconsistent across the two lists because the templates list uses `text-[10px]` and the agents list uses `text-xs`. | Match each list's existing badge precedent — that's already the convention; consistency is *within-list*, not *across-list*. Decision recorded in Key Technical Decisions. |

---

## Documentation / Operational Notes

- No docs updates required — the admin SPA is the only surface that exposed "Runtime" in user-visible copy, and `apps/www` already uses "Harness".
- No rollout, monitoring, or feature flag — pure UI.

---

## Sources & References

- **Prior unmerged commits (textual reference only, do not cherry-pick):**
  - `b1cd291` — `refactor(admin): rename Runtime to Harness on template edit + agent dialog`
  - `153ed87` — `refactor(admin): add Harness column to lists; replace Status on agents`
  - Both on branch `refactor/admin-runtime-to-harness`, never merged.
- **Related WWW work (frames the product term):** `84a174a feat(www): Reground messaging around Agent Harness for Business`.
- **Files of interest:**
  - `apps/admin/src/routes/_authed/_tenant/agent-templates/$templateId.$tab.tsx`
  - `apps/admin/src/components/agents/AgentFormDialog.tsx`
  - `apps/admin/src/routes/_authed/_tenant/agent-templates/index.tsx`
  - `apps/admin/src/routes/_authed/_tenant/agents/index.tsx`
  - `apps/admin/src/lib/graphql-queries.ts`
- **Memory references:** `feedback_verify_wire_format_empirically`, `feedback_cleanup_worktrees_when_done`, `project_admin_worktree_cognito_callbacks`, `feedback_pnpm_in_workspace`.
