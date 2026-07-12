---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
linear_issue: THINK-265
date: 2026-07-12
type: docs
execution: code
---

# CLAUDE.md CONCEPTS.md Bullet Dedup - Plan

## Goal Capsule

- **Objective:** Fix a paper cut in the repo-root `CLAUDE.md` "Repository at a glance" list: lines 21–22 carry a duplicated `CONCEPTS.md` bullet, and the second copy has the Compliance-module reference run on without a line break.
- **Product authority:** Linear issue THINK-265 (verbatim fix, scope, and verification criteria). Confirmed against `origin/main` at `ad94f1a9e`; re-confirmed at `944f43bc6`.
- **Open blockers:** none.

## Product Contract

### Problem

`CLAUDE.md` lines 21–22 on `origin/main` read:

```
- `CONCEPTS.md` — shared domain vocabulary (entities, named processes, status concepts); relevant when orienting to the codebase or discussing domain terms
- `CONCEPTS.md` — shared domain vocabulary (entities, named processes, status concepts); relevant when orienting to the codebase or discussing domain concepts Compliance module reference: `docs/src/content/docs/compliance/` (rendered at `/compliance/` in the Starlight site)
```

The second bullet duplicates the first and swallows the Compliance-module pointer into a run-on sentence, so agents reading the file get a confusing double entry and a hard-to-parse reference.

### Requirements

- R1: Keep exactly one `CONCEPTS.md` bullet in the "Repository at a glance" list, with the existing wording ("… discussing domain terms").
- R2: Move the Compliance module reference (`docs/src/content/docs/compliance/`, rendered at `/compliance/` in the Starlight site) onto its own bullet in the same list so it reads cleanly.

### Scope

- In scope: one file, `CLAUDE.md`. Documentation only — no code, no behavior change.
- Out of scope: `AGENTS.md` (its "at a glance" list has no duplicate), any other docs, any compliance content.

### Verification

- `grep -c 'CONCEPTS.md' CLAUDE.md` within the "Repository at a glance" list yields exactly one bullet.
- The Compliance-module reference appears on its own line/bullet.
- `pnpm format:check` passes (pre-commit hook covers this).

### Assumptions

- A1: A dedicated bullet (rather than appending to the `docs/` bullet) is the cleanest reading; the issue's fix text ("its own separate line/bullet") permits either — trivial reversible choice made autonomously.

## Planning Contract

- **Product Contract preservation:** unchanged from the merged requirements artifact (PR #3623).
- **Plan depth:** Lightweight — one file, one unit, no technical decisions beyond A1 (already recorded).
- **Key technical decision:** the Compliance bullet keeps the existing pointer text **verbatim, including its inline-code backticks** (`Compliance module reference:` followed by `` `docs/src/content/docs/compliance/` `` and the `/compliance/` rendering note), and lands immediately after the deduplicated `CONCEPTS.md` bullet, staying inside the "Repository at a glance" list — no new content invented, only re-lineation of what is already there.
- **Child/unit split:** a single shippable unit (U1). No Linear child issues — the parent issue itself is the shippable unit; splitting a two-line docs edit into children adds dispatch overhead with no independent value.
- **Checkpoint PR boundary:** one PR for U1 (default one-PR-per-unit; nothing grouped).
- **Dependency order:** U1 only; no dependencies.
- **Rollout notes:** none — `CLAUDE.md` is read by agents/humans from the repo; no deploy, no schema, no runtime surface. The post-merge Deploy workflow runs as usual but this change exercises nothing in it.
- **Risks:** near-zero. Only risk is a concurrent merge touching the same `CLAUDE.md` lines; mitigated by branching from fresh `origin/main` and rebasing if the PR falls behind.

## Implementation Units

### U1. Deduplicate CONCEPTS.md bullet and split out Compliance reference

- **Goal:** `CLAUDE.md` "Repository at a glance" has exactly one `CONCEPTS.md` bullet and a separate Compliance-module bullet.
- **Requirements:** R1, R2 (with A1).
- **Dependencies:** none.
- **Files:** `CLAUDE.md` (only).
- **Approach:** delete the second (run-on) `CONCEPTS.md` bullet at line 22; add a new bullet directly after line 21 carrying only the Compliance-module reference text already present in the run-on copy.
- **Test scenarios:** `Test expectation: none — documentation-only change with no runtime surface; verification is textual (see Verification below).`
- **Verification:**
  - Exactly one line in `CLAUDE.md` matches `CONCEPTS.md` as a list bullet (`grep -c '^- \`CONCEPTS.md\`' CLAUDE.md` → 1).
  - Exactly one bullet carries the Compliance-module reference (`grep -c '^- Compliance module reference' CLAUDE.md` → 1) and it contains `docs/src/content/docs/compliance/`.
  - `pnpm format:check` passes (pre-commit runs it).
  - The list renders cleanly (each bullet one line, no run-on) when viewed on GitHub.

## Verification Contract

Per-unit end-to-end proof. This change has **no deployed-dev browser surface** — `CLAUDE.md` is a repo-root agent-instructions file, not shipped to the web/mobile apps or the runtime — so the end-to-end flow is repo-and-GitHub level, not an app flow:

- **U1 flow:** open `CLAUDE.md` on `main` in the GitHub UI (or `git show origin/main:CLAUDE.md`) after merge → the "Repository at a glance" list shows a single `CONCEPTS.md` bullet followed by a distinct Compliance-module bullet; no duplicated or run-on line remains. Textual gates: the two grep checks in U1 (the line-anchored, authoritative form of the Product Contract verification) plus `pnpm format:check` green in CI on the PR.

## Definition of Done

- U1 merged to `main` via a squash-merged PR with all checks green.
- `origin/main` `CLAUDE.md` satisfies both grep gates and the GitHub-render check above.
- No other file modified.

### Notes

Factory daemon tracer issue (Milestone-1 shakedown). Brainstorming stopped at Requirements Review; this planning pass enriched the artifact to implementation-ready. The `CLAUDE.md` edit itself ships in the work phase.
