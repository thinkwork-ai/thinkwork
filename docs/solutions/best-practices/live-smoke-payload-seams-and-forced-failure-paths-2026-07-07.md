# Live-smoking payload seams and forced failure paths on dev (THINK-155 U6 techniques)

**Date:** 2026-07-07
**Context:** THINK-155's emission slice shipped an inert `documentId` payload seam (no config surface sets it) plus failure-path semantics that needed live proof on dev. These techniques generalize to any ship-inert payload field or agent-driven failure-path test.

## Injecting an inert payload field for a live test

`thread_turns.context_snapshot` spreads the entire wakeup payload (wakeup-processor stamps it at turn insert), and turn-scoped readers (e.g. document emission) resolve from it. To exercise a payload field no production path sets yet:

1. Trigger the run (`triggerAgentLoopRun`).
2. Poll `agent_loop_iterations.thread_turn_id` (stamped at dispatch) every ~2s.
3. As soon as the turn exists:
   `UPDATE thread_turns SET context_snapshot = jsonb_set(context_snapshot, '{agentLoop,documentId}', '"<value>"') WHERE id = '<turnId>';`

The race window is generous: the wakeup poller runs on a ~60s cadence and the agent needs 30s+ of LLM latency before its first tool call reads the snapshot. Worked 4/4 times in the THINK-155 smoke.

## Forcing agent-driven failure paths — model compliance limits

- Models **routinely fail a plate content contract on emit attempt 1** and self-correct from the diagnostics (observed on every smoke run, Kimi K2.5). Any per-attempt failure detector will fire on ultimately-successful runs — design detection at turn end ("turn finished without a successful finalize"), and expect noise if you don't.
- "Emit exactly once with deliberately-wrong content and do not retry" style instructions are **unreliable** — the model re-emitted up to 3× against explicit instructions, and truncated verbatim digest bodies it was told to reproduce exactly. To force a *specific* gate deterministically, prefer a structural cause the model can't accidentally fix: for the space-authorization gate, set the automation's `run_as_user_id` to a tenant member who is not a member of the target space (found via `tenant_members` ⋈ `space_members`), rather than trusting the model to keep a bogus argument.
- Sequencing matters when forcing a specific gate: emission gates run in order (bound-target → plate registry → compile → DocSpector → space authz). A test aimed at a late gate must pass every earlier gate, so give the agent content that compiles cleanly.

## Misc dev-smoke gotchas (2026-07-07 state)

- `saveAgentLoop` still requires `goalSpec.objective` even though `target_spec` is the dispatch authority — pass both.
- User budget enforcement (#3495) can silently skip run-as wakeups ("over budget" in wakeup-processor logs); check `budget_policies` (scope=user) vs month-to-date `cost_events` when scheduled runs sit queued.
- Manual-trigger smoke automations: disable via `saveAgentLoop enabled:false` when done; each `triggerAgentLoopRun` needs a fresh `idempotencyKey`.
