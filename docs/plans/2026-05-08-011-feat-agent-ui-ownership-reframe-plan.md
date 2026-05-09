---
title: Reframe admin Agent UI ownership for Computer-owned threads
type: feat
status: active
date: 2026-05-08
origin: docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md
---

# Reframe admin Agent UI ownership for Computer-owned threads

## Summary

Now that Computers are the primary user-facing workplace/orchestrator and Agents have shifted to AgentCore-managed capabilities/workers/templates/tools, sweep the admin UI so that "Agent" no longer implies the primary chat owner where a Computer is the actual owner. Scope is admin-only label/breadcrumb/empty-state/provenance cleanup — no schema or runtime work. Existing Agent capability/template/worker functionality stays intact.

---

## Problem Frame

PR #960 brought Computer dashboard parity, but the surrounding admin still treats `Agent` as the default chat-owning entity throughout the threads experience: threads detail breadcrumbs always route through `/agents/...` even when `thread.computerId` is set, the threads list "Assignee" column only renders agents, and several tooltips/labels (e.g., "Agent running") still assume agent ownership. After the Computer reframe (`docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md`), Computer-owned threads now exist in production but read in the admin as if an Agent owns them. This PR cleans those surfaces without touching schema, GraphQL contracts, or runtime behavior.

---

## Requirements

- R1. Computer-owned threads (`thread.computerId != null`) display Computer ownership consistently in admin: threads list row, threads detail breadcrumbs, threads detail PropRow, and the assistant role label inside the detail sheet.
- R2. Agent-owned threads continue to display Agent ownership unchanged. Agent capability/template/worker functionality is untouched.
- R3. Tooltips/empty-state copy that says "Agent" generically when ownership can be either Agent or Computer is reframed to a neutral phrasing (e.g., "Worker running" or detect the owner type).
- R4. The sidebar `Agents` group continues to surface AgentCore-managed surfaces (Agents, Templates, Memory, Skills/Tools, Evaluations, Security Center). Group label may stay `Agents` but stops serving as the implicit container for primary chat ownership — the threads experience is reachable from `Work` (Threads, Computers, Inbox) without routing through `/agents`.
- R5. No schema changes, no GraphQL type changes beyond what existing fields already expose (`thread.computerId`, `thread.agent`), no Lambda/runtime changes.

---

## Scope Boundaries

- No schema or migration work. `computer_tasks.status` work stays parked in the Strands worktree.
- No GraphQL contract changes. New consumers of `thread.computerId` use the existing field already shipped in #960.
- No mobile changes. This PR is admin-only.
- No deletion of Agent surfaces — Agents, Agent Templates, Agent capability config, AgentBuilder shell, AgentDetailSheet remain intact.
- No new "Computer" entry in the threads-list assignee filter (would require GraphQL filter argument change). Tracked as deferred follow-up.
- No Cost-by-Agent → Cost-by-Worker rollup change in `-analytics/CostView.tsx`. Out of scope for this UI cleanup PR.

### Deferred to Follow-Up Work

- **Computer as a first-class assignee in the threads filter dropdown:** requires extending `ThreadsPagedQuery` filter args to include `computerId` (or generic `ownerType`). Separate PR after the GraphQL contract is reviewed.
- **Cost-by-Owner rollup** in `apps/admin/src/routes/_authed/_tenant/-analytics/CostView.tsx` (currently `Cost by Agent`).
- **Sidebar group rename** from `Agents` to `Managed Agents` if the team decides the literal label needs more disambiguation. This PR keeps the label so adoption is reversible.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/threads/ThreadDetailSheet.tsx:76` — already implements the right pattern: `const assistantLabel = thread?.computerId ? "Computer" : "Agent";`. Extend this style elsewhere.
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:360-385` — `useBreadcrumbs` always routes through `/agents` when `fromAgentId` is present; needs a Computer branch keyed off `thread.computerId`.
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:770-810` — `ThreadProperties` PropRow already conditionally renders Computer vs Agent. Verified working pattern; no change needed beyond making sure the breadcrumb branch matches.
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx:129` — `<span ... title="Agent running">` tooltip is generic; reframe to "Worker running".
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx:160-161, 406-410` — `ThreadCardItem` only knows about `thread.agent`. Needs to surface a Computer chip when `thread.computerId` is set.
- `apps/admin/src/components/threads/ThreadTraces.tsx:73` — `<TableHead className="w-20">Agent</TableHead>` column header. Trace rows are agent-step-keyed; this column is technically about the runtime that produced the step, not the thread owner. Leave as-is.
- `apps/admin/src/components/Sidebar.tsx:204-247` — `Work` group already contains `Computers`, `Threads`, `Inbox`. `Agents` group label remains.

### Institutional Learnings

- `feedback_aws_native_preference.md` — keep Computer/AgentCore framing aligned with the platform identity; don't introduce SaaS or third-party vocab.
- `project_multi_agent_product_commitment.md` — multi-agent per user is product intent; Agent surfaces stay intact, this PR only adjusts where ownership *language* implies the agent owns the primary chat.

### External References

- N/A — internal UI cleanup, no external standards involved.

---

## Key Technical Decisions

- **Mirror the existing `ThreadDetailSheet.tsx:76` pattern:** check `thread.computerId` first, fall back to `thread.agent`. This pattern is already shipped and reviewed; reusing it keeps the diff small and consistent.
- **No new GraphQL fields.** `thread.computerId` already exists per #960; the threads list query needs to ensure `computerId` is selected. If it isn't, add it to the existing fragment (no new arg).
- **Preserve Agent-owned breadcrumb behavior** when `fromAgentId` is set and `thread.computerId` is null — Agent surfaces are not regressed.
- **Tooltips/empty states use neutral phrasing ("Worker", "Owner")** rather than dual-branching everywhere — keeps the UI compact without a second conditional.
- **Sidebar `Agents` group label stays `Agents`.** The visual distinction is already provided by `Work` containing `Computers` / `Threads` / `Inbox`. Renaming the group is reversible follow-up if reviewers want it.

---

## Open Questions

### Resolved During Planning

- **Scope of "Computer" assignee filter on threads list:** deferred — changing the threads list filter requires a GraphQL contract change and would balloon the PR. The threads-list row chip surfaces Computer ownership without the filter.
- **Whether to rename `Agents` sidebar group:** not in this PR. Reversible follow-up.

### Deferred to Implementation

- Whether the threads-list `ThreadsPagedQuery` already selects `computerId`. If yes, U1 only needs render changes; if no, U1 adds the field selection and runs `pnpm --filter @thinkwork/admin codegen` (does not change schema).
- Exact copy for the Computer chip on the threads-list row (e.g., "Computer", "Computer-owned", "Marco"). Default to the same `Computer-owned` outline badge already used in ThreadProperties for visual consistency.

---

## Implementation Units

### U1. Threads list row — surface Computer ownership

**Goal:** Computer-owned thread rows in the threads list display a Computer chip rather than a missing/empty assignee, mirroring the agent chip pattern.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` (around lines 158-165 type, 406-410 render, 322-329 grouping)
- Modify (only if `computerId` is not already selected): `apps/admin/src/lib/graphql-queries.ts` (or wherever `ThreadsPagedQuery` lives) — add `computerId` to the thread fragment used by the list. No schema change.
- Test: `apps/admin/src/routes/_authed/_tenant/threads/-threads-route.test.ts` (add new file alongside the existing `-symphony.target.test.ts` pattern, or extend an existing route test if one exists)

**Approach:**
- Extend the local `ThreadCardItem` type to include `computerId?: string | null`.
- In the row render, when `thread.computerId` is set, render a `Computer-owned` outline `Badge` in place of the agent identity row. When `thread.agent` is set and no `computerId`, keep current agent identity rendering. When neither, render nothing (current behavior).
- Group-by-assignee: when grouping by assignee, place Computer-owned threads under a synthetic `Computer` group key (label "Computer") so they don't all collapse into "Unassigned". Do not add a new filter arg.
- The "Agent running" running-spinner tooltip on line 129 changes to "Worker running" so it covers both ownership shapes.

**Patterns to follow:**
- `apps/admin/src/components/threads/ThreadDetailSheet.tsx:76` for the Computer-vs-Agent decision.
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:780-790` for the `Computer-owned` outline `Badge` styling.

**Test scenarios:**
- Happy path: a thread with `computerId` and no `agent` renders a `Computer-owned` chip in the list row.
- Happy path: a thread with `agent` and no `computerId` renders the existing agent identity unchanged.
- Edge case: a thread with both `computerId` and `agent` set prefers Computer ownership in the row chip (mirrors `ThreadDetailSheet`).
- Edge case: a thread with neither set renders no chip and is grouped under `Unassigned` when grouped by assignee.
- Integration: when group-by-assignee is active, Computer-owned threads appear in a `Computer` group, not `Unassigned`.

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` passes.
- `pnpm --filter @thinkwork/admin test` passes for the new/updated test file.
- Manual: load threads list with a Computer-owned thread visible; confirm the chip renders.

---

### U2. Threads detail — Computer-aware breadcrumbs

**Goal:** When the open thread is Computer-owned, the breadcrumb trail routes through `/computers/<computerId>` rather than `/agents/...`, even when the user navigated in from an `?fromAgent=...` link.

**Requirements:** R1, R2

**Dependencies:** U1 (so `computerId` is selected on the thread query path used by detail; verify the detail query already selects `computerId`)

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (around lines 360-385 — the `useBreadcrumbs` block)
- Test: `apps/admin/src/routes/_authed/_tenant/threads/-thread-detail-breadcrumbs.test.tsx` (new, small unit test on the breadcrumb-construction helper or a thin shallow render)

**Approach:**
- Decision tree, in order: (1) `thread.computerId` set → breadcrumb is `Computers > <computer name or "Computer"> > <thread title>` linking to `/computers/$computerId`; (2) `fromAgentId` query param set → existing Agent breadcrumb; (3) default → `Threads > <thread title>`.
- Extract the breadcrumb decision into a small pure helper inside the route file (or a sibling util) so it's testable without rendering the page.
- Computer name source: prefer the route's existing thread query result if it exposes a `computer { id, name }` relation; otherwise show literal `"Computer"` as the middle crumb.

**Patterns to follow:**
- The existing `useBreadcrumbs` two-branch pattern in this same file.
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` for the canonical Computer detail route.

**Test scenarios:**
- Happy path: thread with `computerId` set produces breadcrumbs routing through `/computers/<computerId>`.
- Happy path: thread without `computerId` and with `?fromAgent=<id>` produces existing Agent breadcrumbs.
- Happy path: thread with neither produces the default `Threads > ...` breadcrumb.
- Edge case: thread with both `computerId` and `fromAgent` query param prefers Computer breadcrumbs (Computer ownership wins).
- Edge case: thread with `computerId` but no name relation in the query result still produces a valid breadcrumb (literal `"Computer"` in the middle crumb).

**Verification:**
- `pnpm --filter @thinkwork/admin typecheck` passes.
- New breadcrumb-helper test passes.
- Manual: navigate to a Computer-owned thread; confirm breadcrumb routes to `/computers/<id>` and back-arrow lands on the Computer detail page.

---

### U3. Threads detail PropRow — verify Computer/Agent dichotomy already covers all surfaces

**Goal:** Confirm the existing `ThreadProperties` PropRow rendering (lines 770-790) handles all owner shapes correctly and add a `data-testid` or small assertion test so the dichotomy doesn't regress silently.

**Requirements:** R1, R2

**Dependencies:** None (this is verification + light hardening of an already-shipped pattern)

**Files:**
- Modify (optional, only to add `data-testid`): `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (lines 770-790)
- Test: extend the `apps/admin/src/routes/_authed/_tenant/threads/-thread-detail-breadcrumbs.test.tsx` (or sibling) with a PropRow-shape assertion if a reasonable shallow-render harness is in place; otherwise leave as a manual verification step.

**Approach:**
- Re-read the current code; confirm Computer-owned, Agent-owned, and unowned all render the right `PropRow`.
- If a render harness already exists in admin, add a 3-case assertion. If not, skip the test and note in `Verification` that this is a manual smoke.

**Patterns to follow:**
- Existing PropRow usage in the same file.

**Test scenarios:**
- Test expectation: light — only add a unit test if a render harness already exists in admin. Otherwise this unit is verification-only and contributes no behavior change beyond an optional `data-testid`.

**Verification:**
- Manual: open Computer-owned thread → see "Computer" PropRow with `Computer-owned` badge. Open Agent-owned thread → see "Agent" PropRow with linked agent identity. Open unowned thread → neither row appears.

---

### U4. Generic-ownership tooltips and empty-state copy

**Goal:** Reframe the small handful of generic strings that say "Agent" when the underlying state could be Agent or Computer, so the copy stays correct for both.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` (line 129 — `title="Agent running"`)
- Modify: any other generic-ownership strings surfaced during U1/U2 implementation that should become owner-neutral. Candidates to audit during implementation: `apps/admin/src/components/threads/ThreadTraces.tsx` (header `Agent` is per-step, leave as-is), empty-state strings on `apps/admin/src/routes/_authed/_tenant/threads/index.tsx`, any "No agent assigned" copy.
- Test: covered by the U1 test file (no separate test needed for tooltip copy).

**Approach:**
- Replace the running-spinner tooltip from `"Agent running"` to `"Worker running"`.
- Audit the file during implementation for other agent-implies-owner strings; leave per-step Agent labels (e.g., trace column headers) untouched because they describe the runtime that produced the step, not the thread owner.

**Patterns to follow:**
- N/A — copy change.

**Test scenarios:**
- Test expectation: none — pure copy change covered visually and by the U1 list-render assertions.

**Verification:**
- Manual: hover the running spinner on an active Computer-owned thread row; confirm tooltip reads "Worker running".

---

## System-Wide Impact

- **Interaction graph:** No backend or runtime changes. Only admin UI components touched. The threads list and detail routes are the only entry points exercised.
- **Error propagation:** N/A — no new failure modes introduced.
- **State lifecycle risks:** None. No mutations, no caching, no new derived data.
- **API surface parity:** Mobile is unchanged; mobile already renders ownership correctly via separate code. CLI is unchanged.
- **Integration coverage:** Manual smoke covering one Computer-owned thread + one Agent-owned thread + one unowned thread end-to-end is sufficient.
- **Unchanged invariants:** Agent capability/template/worker surfaces (`apps/admin/src/components/agents/*`, `apps/admin/src/routes/_authed/_tenant/agents/*`, `apps/admin/src/routes/_authed/_tenant/agent-templates/*`) are not modified by this plan. AgentCore Managed Agents continue to function unchanged. Sidebar `Agents` group label is unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `ThreadsPagedQuery` does not currently select `thread.computerId`, requiring a fragment change and codegen run | If the field is missing, add it to the existing thread fragment and run `pnpm --filter @thinkwork/admin codegen`. No schema change. Verify in U1. |
| Breadcrumb helper extraction inadvertently changes Agent breadcrumb behavior | The breadcrumb decision tree explicitly preserves the existing Agent branch when `computerId` is null. Test U2 covers this. |
| Generic tooltip rewording surprises a reviewer who expected "Agent" everywhere | Limit copy changes to U4's tightly-scoped list; do not rewrite agent-keyed labels in trace tables, agent-detail surfaces, or the sidebar. |

---

## Documentation / Operational Notes

- No docs updates required. Plan referenced from `docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md` as a UI follow-up.
- No rollout, monitoring, or migration changes.

---

## Sources & References

- **Origin plan (Computer on Strands):** [docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md](docs/plans/2026-05-07-010-feat-thinkwork-computer-on-strands-plan.md)
- Related PR: #960 (Computer dashboard parity, merged at `c4ab0975`)
- Related code:
  - `apps/admin/src/components/threads/ThreadDetailSheet.tsx:76`
  - `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx:360-385, 770-790`
  - `apps/admin/src/routes/_authed/_tenant/threads/index.tsx:129, 158-161, 406-410`
  - `apps/admin/src/components/Sidebar.tsx:204-247`
