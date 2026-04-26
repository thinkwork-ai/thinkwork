---
title: Inert→live seam swap pattern for multi-PR module rollouts
date: 2026-04-25
category: docs/solutions/architecture-patterns/
module: agentcore-strands
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - Shipping a new module that integrates with several already-shipped dependencies
  - The integration is large enough that doing it in one PR would dwarf the module's own surface area
  - You want PR-1 to ship structurally (path validation, type contracts, registration, unit tests) without booting the live integration target
  - You want PR-2 to be a focused diff that swaps in the live behavior with no contract churn
tags:
  [
    architecture-pattern,
    multi-pr,
    ship-inert,
    factory-closure,
    plan-008,
    strands-runtime,
  ]
---

# Inert→live seam swap pattern for multi-PR module rollouts

## Context

A new runtime module integrates with several previously-shipped dependencies AND with one final dependency that's expensive or stateful (Bedrock spawn, real S3 write, real DB connection). Three failure modes the team kept hitting:

1. **Big-bang PRs.** Shipping the entire module in one PR mixes structural decisions (path validation, type contracts, registration boilerplate, dependency wiring) with the integration itself. Reviews drown; bugs hide.
2. **Stub-and-replace.** Shipping a stub that gets replaced wholesale invalidates the stub's tests on swap-day. PR-2 becomes a re-review of the same surface area.
3. **Behind-a-flag.** Feature flags work but add config surface, branch tests, and a deletion task that often gets forgotten.

The pattern this doc captures **is** how Plan §008 actually shipped — used at least twice in 2026-04-25 work — and what made the two PRs cheap to review and safe to roll back.

## Guidance

Ship the module across two PRs against a **stable seam** that production and tests share:

**PR-1 (inert):**

- New module exports a factory that takes a `seam_fn: Callable | None = None` kwarg.
- Module also exports a `_seam_fn_inert(...)` no-op function with the canonical return shape.
- Factory body: `snapshot_seam = seam_fn or _seam_fn_inert`. Production registration does NOT pass `seam_fn=`, so it falls back to inert.
- All other module behavior — input validation, dependency fetches, error wrapping, instrumentation — is live and fully tested.
- Tests pass `seam_fn=` explicitly to inject capture/assertion stubs and exercise the pre-seam pipeline end-to-end.
- The inert function returns a typed payload like `{ok: false, reason: "<seam> not yet wired", ...resolved_context}` that downstream callers can branch on.
- Ship.

**PR-2 (live):**

- Replace ONLY `_seam_fn_inert`'s body with the live integration. Keep the function (under either the same name or a parallel `_seam_fn_live`) so explicit test injection still works.
- Production registration still passes `seam_fn=None` — the factory's fallback now resolves to the live default.
- Add a **body-swap safety integration test** that builds the factory WITHOUT `seam_fn=` and asserts the live default is actually exercised. The assertion must check downstream effects (e.g., `BedrockModel constructor called`, `S3 PutObject called`) — not just the return shape — so a future hardcoded-success replacement can't pass the test.
- Add tests for the live-only paths (success / failure / resource exhaustion / etc.).
- Ship.

The seam contract — `seam_fn(resolved_context: dict) -> dict` with a fixed payload shape — does not change between PR-1 and PR-2. That's the load-bearing invariant.

## Why This Matters

- **PR-1 review focuses on the structural surface.** Path validation, error wrapping, factory snapshots, dependency contracts — the stuff that's hard to undo. PR-1 lands with full test coverage of everything except the seam itself.
- **PR-2 review focuses on the live integration.** What `BedrockModel(...)` returns; how usage tokens are accumulated; what failure modes propagate. The reviewer doesn't have to re-litigate path validation or registration plumbing because PR-1 already locked those in.
- **Body-swap safety test prevents silent regression.** The test exists because PR-2's production registration relies on `seam_fn=None` falling back to the live default. A future PR that adds a sibling `_seam_fn_real()` instead of editing the seam body would silently keep production on inert. The test asserts the live default actually runs, not just that the return value looks right.
- **Rollback is one revert.** PR-2 alone can be reverted without losing PR-1's structural work. The module stays useful (path validation, dependency wiring, observable failure mode) even when the live integration is rolled back.
- **Test isolation stays clean.** Tests that don't need the live integration explicitly inject the inert function via `seam_fn=`. They test the pre-seam pipeline in isolation. The body-swap safety test is the one place that exercises the live default's existence.

## When to Apply

- Multi-step plan execution where one unit's substantive behavior depends on a heavy dependency (Bedrock, real LLM, external API) but the unit's structural design (path validation, factory closure, dependency wiring, error envelope) is independent of that dependency
- The module's deps are already shipped on `main` but the integration target is the last hop
- Reviewers benefit from focused PRs (the project standard per `feedback_merge_prs_as_ci_passes`)
- Production should fail safely if the live integration is reverted (PR-1's inert payload is the safe-by-design fallback)

Do NOT apply when:

- The integration is trivial (one function call, no failure modes worth modeling) — just ship it
- The dependency is mock-friendly enough that PR-1 can use a real test double in production with negligible cost
- The seam contract isn't stable yet (you're still iterating on the payload shape) — wait until the contract is firm

## Examples

**Plan §008 U10 → U10 followup (#574 → #575):**

PR #574 shipped `skill_resolver.py` with `resolve_skill(slug, folder_path, composed_tree, platform_catalog_manifest=None) -> ResolvedSkill | None` — a pure-function resolver that returns `None` instead of raising on miss. All path-walk, manifest-lookup, and precedence logic was live and tested. The seam: callers consuming `None` had to handle the missing case. PR #575 (the followup) tightened the resolver contract — `_normalize_folder_path`, `_build_path_index`, `_is_usable_local`, `_read_platform_content` all hardened with type guards, normalization fixes, and the `(usable, reason)` return tuple. The contract surface (function signature, return type, ResolvedSkill shape) was stable across both PRs; only the internals tightened.

**Plan §008 U9 inert → U9 spawn-live (#578 → #589):**

PR #578 shipped `delegate_to_workspace_tool.py`:

- `make_delegate_to_workspace_fn(... spawn_fn: Callable | None = None ...)` factory
- `_spawn_sub_agent_inert(resolved_context: dict) -> dict` returning `{"ok": False, "reason": "spawn not yet wired", "resolved_context": resolved_context}`
- Factory closure: `snapshot_spawn = spawn_fn or _spawn_sub_agent_inert`
- Production registration in `server.py` passed nothing → fell back to inert
- Tests passed inline `spawn_fn` closures to capture `resolved_context` and assert pre-spawn pipeline shape
- 33 tests covering path validation, composer fetch, AGENTS.md parse, skill resolution, error wrapping, factory snapshots — all live, all tested, no Bedrock involved

PR #589 (this PR):

- Deleted `_spawn_sub_agent_inert` (dead code per maintainability review — tests had moved to inline `spawn_fn` closures so the named inert fallback wasn't needed)
- Added `_make_live_spawn_fn(...)` building the real Bedrock `BedrockModel` + `Agent` spawn with usage accumulation
- Factory's `spawn_fn=None` now falls through to `_make_live_spawn_fn`'s closure
- Body-swap safety test: `TestLiveSpawnBodySwapSafety::test_zero_arg_spawn_fn_uses_live_default_and_returns_ok_true` builds the factory WITHOUT `spawn_fn=`, asserts `result["ok"] is True`, AND asserts `model_calls >= 1` AND `agent_calls >= 1` via counters on the strands stubs. A future hardcoded `{ok: True}` replacement of `_make_live_spawn_fn` would fail the call-count assertions.
- 11 new live-spawn tests + the body-swap safety test land alongside the body change

The `delegate_to_workspace(path: str, task: str) -> dict` external contract did not change between PRs. The `seam_fn` kwarg's contract (`(resolved_context: dict) -> dict`) did not change. Tests' explicit `spawn_fn=` injection continued to work — the existing 33 PR #578 tests passed unchanged in PR #589.

**Both PRs landed clean.** PR #578 was a focused review of the structural pipeline (validate → fetch → parse → resolve); PR #589 was a focused review of the Bedrock integration (BedrockModel construction, usage accumulation, sub-agent prompt composition).

**Activation Agent runtime scaffold (#613 follow-up):**

The Activation Agent applies the same pattern at a whole-runtime boundary. The new `packages/agentcore-activation/agent-container/container-sources/interview_runtime.py` exports `interview_fn = _interview_inert` behind a stable `/invocations` HTTP contract. The inert body returns a canonical `{message, currentLayer, status}` payload and can push through the same `/api/activation/notify` writeback route the live body will use later.

The live swap should change the `interview_fn` assignment/body only, leaving:

- `/ping` and `/invocations`
- the activation API writeback client
- `snapshot_at_entry()`
- the five-tool registration assertion
- the GraphQL/mobile session contract

The body-swap safety test for the live PR should build the server/runtime without injecting a seam, assert a Bedrock/Strands call actually occurs, and assert the response still satisfies the same inert payload shape.

## Related

- `feedback_ship_inert_pattern` (auto-memory) — original team-level capture of "ship inert; integrate later"
- `feedback_completion_callback_snapshot_pattern` (auto-memory) — load-bearing companion: factory snapshots `os.environ` reads at construction, the live spawn body never re-reads
- `docs/solutions/workflow-issues/workspace-defaults-md-byte-parity-needs-ts-test-2026-04-25.md` — companion doc capturing the pre-push verification gap that bit PR #589 specifically (different topic, same session)
- Plan §008 master: `docs/plans/2026-04-24-008-feat-fat-folder-sub-agents-and-agent-builder-plan.md`
- PRs that demonstrate the pattern: #574, #575 (skill_resolver inert→tighter), #578, #589 (delegate_to_workspace inert→live)
- The body-swap safety integration test: `packages/agentcore-strands/agent-container/test_delegate_to_workspace_tool.py::TestLiveSpawnBodySwapSafety`
