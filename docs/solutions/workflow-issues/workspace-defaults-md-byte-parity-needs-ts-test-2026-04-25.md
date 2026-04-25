---
title: "Workspace-defaults `.md` edits need a TS parity-test pass before push"
date: 2026-04-25
category: docs/solutions/workflow-issues/
module: workspace-defaults
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Editing any file under `packages/workspace-defaults/files/`
  - Touching the inlined `loadDefaults()` constants in `packages/workspace-defaults/src/index.ts`
  - Running pre-push verification on a Strands-runtime PR that includes a `workspace-defaults` doc change
tags: [workspace-defaults, byte-parity, pre-push, ci, vitest, plan-008]
---

# Workspace-defaults `.md` edits need a TS parity-test pass before push

## Context

`packages/workspace-defaults/` is the seed source for every agent's workspace files (`AGENTS.md`, `MEMORY_GUIDE.md`, `CONTEXT.md`, `IDENTITY.md`, `SOUL.md`, `PLATFORM.md`, `GUARDRAILS.md`, `ROUTER.md`, `TOOLS.md`, `USER.md`, and the three `memory/*.md` writable files). The package keeps **two synchronized representations** of every canonical file:

1. The authoritative `.md` source in `packages/workspace-defaults/files/<name>.md`
2. A verbatim inlined string constant in `packages/workspace-defaults/src/index.ts` (e.g., `AGENTS_MD`, `MEMORY_GUIDE_MD`, `CONTEXT_MD`), exposed via `loadDefaults()`

The runtime container reads from `loadDefaults()`, not from the `.md` files directly — `src/index.ts` is what gets bundled into the deploy artifact. The `.md` files exist for human authoring + diff readability + the bootstrap-workspace.sh tooling.

A byte-parity guardrail at `packages/workspace-defaults/src/__tests__/parity.test.ts` enforces `loadDefaults()[name] === readFileSync(authoritative)` for every entry in `CANONICAL_FILE_NAMES`. The `AUTHORITATIVE_SOURCES` map at `src/index.ts:32-40` declares which `.md` source each constant mirrors.

This guardrail is **only exercised by vitest** (TS-side). A Python-only pre-push verification (e.g., `uv run pytest packages/agentcore-strands/agent-container/`) misses it entirely.

## Guidance

When editing any `packages/workspace-defaults/files/*.md`, do all three of:

1. **Update the matching inlined constant** in `packages/workspace-defaults/src/index.ts` so the strings are byte-identical (template-literal escaping aside — backticks and `${...}` need backslash-escaping in the inlined version).
2. **Run the TS parity test locally before pushing:**
   ```bash
   pnpm --filter @thinkwork/workspace-defaults test
   ```
   Total runtime: ~300ms. There is no excuse not to.
3. **Don't trust a Python-only pre-push pass** to clear the gate. The vitest suite is the byte-parity contract; Python tests cover Strands runtime behavior, not workspace-defaults.

If the change is non-trivial (multi-paragraph rewrite of a `.md` file), prefer to copy-paste the new file content directly into the constant rather than hand-translating — the parity test will reject anything off by a single character.

## Why This Matters

Without this discipline, a PR that edits `packages/workspace-defaults/files/*.md` will:

1. Pass local Python tests
2. Pass local TypeScript tests **only if the developer remembered to run them**
3. Fail CI on the parity test, requiring a re-push cycle

Cycle cost: one extra commit + ~3-5 minutes of CI re-run. Cumulative cost across many `.md` edits adds up. More importantly: the runtime keeps reading the *old* inlined constant until the inline copy is updated, so any forgotten parity update silently means agents in production are reading stale guidance even though the authoritative `.md` looks correct.

## When to Apply

- Every PR that touches `packages/workspace-defaults/files/<canonical>.md`
- Every PR that touches `packages/workspace-defaults/src/index.ts` directly (verify the inlined string still matches `files/*.md`)
- Any plan-008 unit (or follow-up) that updates `MEMORY_GUIDE.md`, `AGENTS.md`, `ROUTER.md`, or any other workspace-defaults file as part of a sub-agent / system-prompt teaching change

Especially relevant for the **plan §008 fat-folder sub-agents** workstream, where multiple units (U2 in PR #589, future Phase E admin-builder UI work) touch the workspace-defaults docs.

## Examples

**The actual miss that prompted this doc** (PR #589, U9 spawn-live):

U2 of the `2026-04-25-004-feat-u9-spawn-live-plan.md` plan added a "Sub-agent path composition" paragraph to `MEMORY_GUIDE.md` and updated the writable-folder map legend in `AGENTS.md`. The author ran `uv run --no-project --with pytest --with strands-agents pytest packages/agentcore-strands/agent-container/` (494/494 passed) and pushed. CI's `pnpm test` then failed on the workspace-defaults parity test:

```
FAIL src/__tests__/parity.test.ts > workspace-defaults parity > content for AGENTS.md matches its authoritative .md source byte-for-byte
AssertionError: expected '# AGENTS.md\n\nThe Layer-1 Map for th…' to deeply equal '# AGENTS.md\n\nThe Layer-1 Map for th…'
- Expected
+ Received
@@ -15,15 +15,12 @@
- <sub-agent>/        ← specialist sub-agent — its own CONTEXT, optional skills/,
-                       and its own memory/ (write_memory at sub-agent scope)
+ <sub-agent>/        ← specialist sub-agent — its own CONTEXT, optional skills/
```

Fix was a single follow-up commit (`fix(workspace-defaults): sync inlined AGENTS.md + MEMORY_GUIDE.md constants`) propagating the new content into `AGENTS_MD` and `MEMORY_GUIDE_MD` constants verbatim. Local `pnpm --filter @thinkwork/workspace-defaults test` after the sync: 15/15 parity tests pass. CI re-ran green; PR merged.

**The pre-push command that would have caught it locally:**

```bash
pnpm --filter @thinkwork/workspace-defaults test
```

300ms. Worth running on every workspace-defaults `.md` change.

## Related

- `packages/workspace-defaults/src/__tests__/parity.test.ts` — the byte-parity guardrail itself
- `packages/workspace-defaults/src/index.ts` — `AUTHORITATIVE_SOURCES` map (lines 32-40)
- PR #589 (U9 spawn-live) — the recurrence that prompted this doc
- Plan-008 master: `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`
- Memory `feedback_pnpm_in_workspace` — never use `npm` in this workspace; the parity test command is `pnpm --filter`, not `npm run`
