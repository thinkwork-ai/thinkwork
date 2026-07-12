---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
linear_issue: THINK-265
date: 2026-07-12
type: docs
---

# CLAUDE.md CONCEPTS.md Bullet Dedup - Plan

## Goal Capsule

- **Objective:** Fix a paper cut in the repo-root `CLAUDE.md` "Repository at a glance" list: lines 21–22 carry a duplicated `CONCEPTS.md` bullet, and the second copy has the Compliance-module reference run on without a line break.
- **Product authority:** Linear issue THINK-265 (verbatim fix, scope, and verification criteria). Confirmed against `origin/main` at `ad94f1a9e`.
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

### Notes

Factory daemon tracer issue (Milestone-1 shakedown, non-LFG): this brainstorm run stops at the Requirements Review gate; the CLAUDE.md edit itself ships in a later phase.
