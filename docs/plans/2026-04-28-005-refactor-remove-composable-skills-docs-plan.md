---
title: "refactor: Remove composable-skills documentation section"
type: refactor
status: completed
date: 2026-04-28
origin: docs/brainstorms/2026-04-28-pre-launch-cleanup-sweep-requirements.md
---

# refactor: Remove composable-skills documentation section

## Overview

Delete the three-page Composable Skills section from the docs site (`/concepts/agents/composable-skills/{,authoring,primitives}`) and remove its sidebar registration in `docs/astro.config.mjs:107-124`. Move the two superseded plans that designed and shipped the runtime — `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` and `docs/plans/2026-04-22-005-feat-composable-skills-hardening-handoff-plan.md` — to `docs/plans/archived/` so the U6 retirement audit trail survives.

The `execution: composition` runtime mode the docs describe was retired in U6 of plan `2026-04-22-005`. `packages/agentcore-strands/agent-container/container-sources/skill_md_parser.py:52` enforces `ALLOWED_EXECUTION_VALUES = ("script", "context")` and rejects composition with an audit error referencing U6 verbatim. Zero skills in `packages/skill-catalog/` use composition mode today (verified during planning). The docs were the only surviving public artifact suggesting the runtime was still live.

This is item R8 in the pre-launch cleanup sweep brainstorm and is intentionally landed as a single PR with no code changes per the origin's "one PR per cleanup item" Key Decision.

---

## Problem Frame

The three composable-skills doc pages collectively run ~647 lines and a top-level sidebar section in the docs site. They tell a reader that ThinkWork ships a YAML-declared multi-step composition runtime with primitives, parallelization, learnings, and admin observability. None of that is true today: the runtime mode is rejected by the parser, the primitives library is empty, and the admin observability surface they link to (`/applications/admin/skill-runs/`) was never published. A new contributor or evaluator reading the section would mistakenly conclude the platform supports a runtime mode that does not exist, then discover the gap only when their `execution: composition` SKILL.md errors at parse time. Removing the pages and the nav entry brings the docs surface in line with the runtime as it actually ships.

---

## Requirements Trace

- R1. Delete the three composable-skills doc pages from the docs site (origin §Tier 1 R8, see origin: `docs/brainstorms/2026-04-28-pre-launch-cleanup-sweep-requirements.md`).
- R2. Remove the Composable Skills section from the docs sidebar in `docs/astro.config.mjs` (origin §Tier 1 R8).
- R3. Move the two composable-skills plans to `docs/plans/archived/` to preserve the U6 retirement audit trail without leaving them in the active plan listing (origin §Tier 1 R8 + origin §Outstanding Questions §Deferred to Planning, archive-vs-delete decision).
- R4. After removal, `pnpm --filter @thinkwork/docs build` succeeds — the Starlight broken-link check does not surface any orphaned cross-references (origin §Tier 1 R8 verification).
- R5. After removal, repo-wide grep for `composable-skills` returns zero hits in `docs/src/`, plus the two known outside-`docs/src/` references (`docs/STYLE.md:417`, `scripts/smoke/README.md:215`) are updated. Remaining hits in `packages/skill-catalog/`, `apps/admin/src/`, and elsewhere are out of scope (covered by R9 / R10 in the origin).

---

## Scope Boundaries

- **Out of scope: R9 prose sweep.** Rephrasing "composable-skill connector script" → "connector skill" in `docs/src/content/docs/concepts/agents/code-sandbox.mdx:12,31,148` and the two skill-catalog files (`packages/skill-catalog/sandbox-pilot/SKILL.md:46`, `packages/skill-catalog/customer-onboarding-reconciler/README.md`) is item R9 and ships in a separate PR. R8's diff stays purely structural.
- **Out of scope: R10 GraphQL field rename.** Renaming the `compositionFeedbackSummary` resolver and the stale "composition invocations" prose in the admin skill-runs UI is item R10 and is meaningfully bigger (touches schema + codegen + 4 packages). Defer to its own plan.
- **Out of scope: any code or runtime changes.** The `execution: composition` rejection tripwires in `skill_md_parser.py` and `skill_resolver.py` stay. The associated audit tests (`test_skill_md_parser.py::test_execution_composition_rejected`, `test_skill_resolver.py::test_unparseable_local_logs_and_falls_through`) stay. The `skill_runs` audit table, admin observability UI, scheduled-jobs reconciler, and `triggered_by_run_id` reconciler-loop tracking all stay — they are generic skill-run infrastructure, not composition-specific.
- **Out of scope: redirect entries for the deleted URLs.** The Astro Starlight site has no Redirect plugin configured, and the three pages have zero verified inbound links from outside their own section (verified during planning). External consumers (search engines, prior-session citations) hitting cached URLs will get a 404; acceptable for retired internal docs that were never in any onboarding or marketing path.
- **Out of scope: the broken `/applications/admin/skill-runs/` links** inside the deleted pages. They become moot once the host pages are gone.

---

## Context & Research

### Relevant Code and Patterns

- `docs/src/content/docs/concepts/agents/composable-skills/index.mdx` — overview, 171 lines.
- `docs/src/content/docs/concepts/agents/composable-skills/authoring.mdx` — field-by-field walkthrough, 265 lines.
- `docs/src/content/docs/concepts/agents/composable-skills/primitives.mdx` — primitives library, 211 lines.
- `docs/astro.config.mjs:107-124` — sidebar registration. The block is a self-contained `{ label: "Composable Skills", collapsed: true, items: [...] }` entry inside the Agents component group; removing it leaves the surrounding entries (Agent Design, Skills, Code Sandbox) untouched.
- `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` — original design (`status: complete`).
- `docs/plans/2026-04-22-005-feat-composable-skills-hardening-handoff-plan.md` — hardening handoff (`status: active`, despite the runtime having been retired in U6 of this very plan).
- `docs/plans/archived/` — destination directory for archived plans. Existing convention is `git mv`; some archived plans carry a `Status: Shipped (...)` line at the top, others have no frontmatter at all. No frontmatter rewrite required.
- Sibling cleanup plan that just shipped: `docs/plans/2026-04-28-002-refactor-remove-external-task-terraform-plan.md` — same structural shape (small, surgical, single-PR), same origin doc.

### Institutional Learnings

- Memory `project_composable_skills_r13_next` notes that connector-skill work survived the runtime retirement; the **runtime** is gone, but **connector skills** as a design pattern (regular `execution: script` skills carrying OAuth tokens) remain. R8's deletion does not orphan future work — connector-skill docs no longer need the composable-skills nav section to live in.
- The composable-skills runtime retirement happened in U6 of plan `2026-04-22-005`. The audit trail lives in `packages/agentcore-strands/agent-container/container-sources/skill_md_parser.py:52-160` and the `test_execution_composition_rejected` test. Archiving the two plans rather than deleting them keeps the source-of-truth chain intact for any future archaeologist who follows the parser's plan reference back.
- "Merge PRs as CI passes" (memory `feedback_merge_prs_as_ci_passes`) — this PR fits the v1 pre-launch cadence: deploy to dev IS the E2E validation; squash-merge as soon as the 4 checks go green.

### External References

- _None._ Internal docs surgery only; no Astro/Starlight reference research required.

---

## Key Technical Decisions

- **Archive, not delete, the two plans.** The brainstorm flagged this as a decision deferred to planning. Recommendation: archive. The U6 retirement decision and its rationale live inside these two plans; deletion would lose the "why we retired it" history. `docs/plans/archived/` already holds eight other shipped plans (compounding-memory series, external-task-integration PRD) for the same reason.
- **One PR for the three doc deletions, the sidebar edit, and the two plan moves.** Splitting (e.g., delete pages first, archive plans second) provides no safety benefit and would leave a transient state where the sidebar entry is gone but its target pages still exist (or vice versa). Atomic.
- **No redirect manifest entries for the deleted URLs.** Verified during planning that no other doc page links to `/concepts/agents/composable-skills/*` (the 8 grep hits in `docs/src/` are all intra-section). The Astro Starlight site does not have a Redirect plugin configured. Adding one purely for these three pages is over-investment for a retired internal surface.
- **Build the docs site to catch dangling sidebar entries.** `pnpm --filter @thinkwork/docs build` validates that every `slug:` in the sidebar config resolves to an existing content-collection entry — that catches a sidebar block left in place pointing at deleted pages. Starlight's default build does **not** validate markdown-body links; coverage of stale prose references comes from R5's post-deletion grep, not the build. Both are run as verification in U1.
- **Keep U1 and U2 conceptually separate.** Even though they ship in the same PR, the two units cover different concerns (live docs surface vs historical plans archive) and benefit from being reviewed independently. A reviewer scrutinizing the diff sees two clean concerns rather than one mixed change.

---

## Open Questions

### Resolved During Planning

- "Are there inbound doc-site links to the three composable-skills pages?" — Resolved: **no external inbound links inside `docs/src/`**. Grep returned 8 matches, all of which are the three pages cross-linking to each other (Overview ↔ Authoring ↔ Primitives). Two references outside `docs/src/` exist (`docs/STYLE.md:417`, `scripts/smoke/README.md:215`) and are folded into U1's Files list as in-scope cleanups.
- "Should the deleted pages get redirect entries?" — Resolved: **no**. The Starlight site does not configure redirects, and no external consumer relies on these specific URLs. 404 is acceptable.
- "Archive vs delete the two plans?" — Resolved: **archive** (move to `docs/plans/archived/`). Captured in the brainstorm's deferred-to-planning question; rationale recorded in Key Technical Decisions above.
- "Do the archived plans need a frontmatter status flag rewrite?" — Resolved: **no**. The existing `docs/plans/archived/` directory contains plans with mixed frontmatter conventions; some have no frontmatter at all. `git mv` alone preserves git history and matches existing archive practice.
- "Is the active hardening plan (`2026-04-22-005`) still doing work that archive would orphan?" — Resolved: **no**. Its U6 retired the runtime; later units in the same plan are post-retirement hardening that has either shipped (PR #422, #426) or is itself moot now. Archiving aligns the plan's directory location with its actual lifecycle state.

### Deferred to Implementation

- _None._ All planning-time questions resolved.

---

## Implementation Units

- U1. **Delete the composable-skills doc pages and remove the sidebar entry**

**Goal:** Atomically remove the three doc files and the sidebar registration so the docs site no longer surfaces the section. Verify the Starlight build passes (broken-link check) before commit.

**Requirements:** R1, R2, R4, R5.

**Dependencies:** None.

**Files:**
- Delete: `docs/src/content/docs/concepts/agents/composable-skills/index.mdx`
- Delete: `docs/src/content/docs/concepts/agents/composable-skills/authoring.mdx`
- Delete: `docs/src/content/docs/concepts/agents/composable-skills/primitives.mdx`
- Delete (directory cleanup): `docs/src/content/docs/concepts/agents/composable-skills/` becomes empty after the three file deletions; remove the directory entry if `git rm` does not handle it automatically.
- Modify: `docs/astro.config.mjs` — remove the `Composable Skills` section block at lines 107-124.
- Modify: `docs/STYLE.md:417` — drop `composable-skills/*` from the example list of concept pages with no admin counterpart. Current text: `(\`composable-skills/*\`, \`code-sandbox\`, \`compounding-memory-pipeline\`, etc.)`. After: `(\`code-sandbox\`, \`compounding-memory-pipeline\`, etc.)`. The remaining examples still illustrate the point.
- Modify: `scripts/smoke/README.md:215` — update the path reference from `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` to `docs/plans/archived/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` so the link survives U2's archive move.

**Approach:**
- `git rm` the three mdx files in one operation.
- Edit `astro.config.mjs` to remove the entire `{ label: "Composable Skills", collapsed: true, items: [...] }` block. The surrounding entries (Agent Design above, Skills/Code Sandbox below) are unaffected; verify the JS object remains syntactically valid by running the build.
- Patch the two outside-`docs/src/` references (`docs/STYLE.md:417`, `scripts/smoke/README.md:215`) in the same commit — they are direct consequences of this PR's deletions/moves, not separable concerns.
- Run `pnpm --filter @thinkwork/docs build` from repo root. Starlight's default build validates the sidebar `slug:` references against the content collection, so it will surface a sidebar entry left pointing at a deleted page. It does **not** check markdown-body links — that coverage comes from the post-deletion repo-wide grep in Verification (planning verified zero outbound body-link references, so the grep should return clean on first run).

**Patterns to follow:**
- Standard pre-commit gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` per `CLAUDE.md`.
- `docs/STYLE-AUDIT.md` notes that "concepts/mcp-servers.mdx" was previously folded + deleted as an orphan; same atomic-deletion pattern applies here, just at section scope rather than single-page scope.

**Test scenarios:**
- Test expectation: none — pure docs surgery with no behavioral change. Validation comes from the Starlight build (see Verification).

**Verification:**
- `git status` shows three files deleted under `docs/src/content/docs/concepts/agents/composable-skills/` and one modified file (`docs/astro.config.mjs`).
- `pnpm --filter @thinkwork/docs build` exits 0 — confirms the sidebar `slug:` validation passes (no `slug:` references a deleted page).
- After build, `find docs/src/content/docs/concepts/agents/composable-skills -type f` returns nothing (or the directory is gone).
- Repo-wide grep for `composable-skills` in `docs/src/` returns zero hits.
- `grep -n "composable-skills" docs/STYLE.md scripts/smoke/README.md` returns the updated lines (STYLE.md no longer lists `composable-skills/*`; smoke README points at the archived path).
- The published docs site sidebar (after merge + deploy) no longer shows the Composable Skills entry under Agents.

---

- U2. **Archive the two superseded composable-skills plans**

**Goal:** Move the original design plan and the hardening handoff plan to `docs/plans/archived/` so the active plans listing reflects what's currently in flight, while preserving the U6 retirement audit trail.

**Requirements:** R3.

**Dependencies:** None. Independent of U1; could run in either order. Bundled into the same PR per the "one PR for everything" decision.

**Files:**
- Move: `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` → `docs/plans/archived/2026-04-21-003-feat-composable-skills-with-learnings-plan.md`
- Move: `docs/plans/2026-04-22-005-feat-composable-skills-hardening-handoff-plan.md` → `docs/plans/archived/2026-04-22-005-feat-composable-skills-hardening-handoff-plan.md`

**Approach:**
- Use `git mv` (not delete + create) to preserve file history. Both files retain their original filename — the archive directory is the signal of supersession, not a renamed prefix.
- Do not rewrite frontmatter. Existing `docs/plans/archived/` entries use mixed conventions; the source of truth for "this is archived" is the directory location, not a frontmatter flag.
- The two plans contain the U6 retirement decision in their respective bodies; archiving (rather than deleting) keeps the narrative chain intact for any future archaeologist who follows a reference from `skill_md_parser.py:52` ("composition was retired in U6 of plan 2026-04-22-005") back to the source plan.

**Patterns to follow:**
- `docs/plans/archived/external-task-integration.md`, `docs/plans/archived/0.3.0-admin-configurable-runtime.md`, and the eight compounding-memory archived plans demonstrate the convention: `git mv` to `archived/`, no frontmatter rewrite.

**Test scenarios:**
- Test expectation: none — file relocation only.

**Verification:**
- `git log --follow docs/plans/archived/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` shows the original file's commit history (confirms `git mv` preserved blame).
- `ls docs/plans/2026-04-21-003-*` and `ls docs/plans/2026-04-22-005-*` both return nothing (files are gone from the active plans dir).
- `ls docs/plans/archived/2026-04-2*-feat-composable-skills-*.md` shows both files in the archive.

---

## Documentation / Operational Notes

- **PR description should call out that the runtime was already retired.** Readers seeing "Delete Composable Skills" might assume this is the runtime retirement itself. Make it clear this is doc-cleanup catching up to an earlier code change (U6 of plan `2026-04-22-005`), not a new behavior change.
- The Starlight site rebuilds in CI on merge. External readers hitting cached `/concepts/agents/composable-skills/*` URLs will get a 404; acceptable per Scope Boundaries — there is no documented external onboarding flow that points at these pages.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-28-pre-launch-cleanup-sweep-requirements.md](../brainstorms/2026-04-28-pre-launch-cleanup-sweep-requirements.md)
- Sibling cleanup plan (just shipped): [docs/plans/2026-04-28-002-refactor-remove-external-task-terraform-plan.md](2026-04-28-002-refactor-remove-external-task-terraform-plan.md)
- Runtime retirement audit trail: `packages/agentcore-strands/agent-container/container-sources/skill_md_parser.py:52-160`
- Plans being archived:
  - `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md`
  - `docs/plans/2026-04-22-005-feat-composable-skills-hardening-handoff-plan.md`
