# The Factory

Linear-driven autonomous engineering for ThinkWork. A Linear issue enters at
`Todo` (or `Debug`) and — with two human gate approvals, or none under
autopilot — exits at `Done` with merged PRs, a browser-verified dogfood
report, and compounded learnings. This document is the system map: what each
piece does, which file owns which behavior, and where to start when improving
it.

Proven end to end on THINK-170 (2026-07-05): Debug → Brainstorm →
Requirements Review → Ready to Work → In Progress → Verification (dogfood
PASS) → Done → Compound, five merged PRs, fix live on dev.

## The one-paragraph mental model

**Linear is the program; dispatchers are the CPU; workers are function
calls.** Statuses encode phase, labels encode routing and permissions, and
every durable fact lives in Linear (a per-issue `Progress:` document, one
rolling ledger comment, and goal-based handoff comments). Dispatchers are
stateless routers that wake on a heartbeat, read Linear, and launch
short-lived workers; any worker can die at any moment and the system heals,
because the next heartbeat re-derives everything from Linear. Repo files are
the durable _artifacts_ (requirements, plans, findings, reports, learnings);
Linear is the durable _state_.

## Component map

| Piece                                     | Location                                                                    | Owns                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Routing contract** (shared, both lanes) | `.agents/skills/thinkwork-linear-dispatcher/references/routing-contract.md` | Lane rules, label semantics, status routing table, handoff-baton contract, question protocol, verification rebound/governor, ledger/marker formats, duplicate-worker handling |
| **Launch prompts** (shared, both lanes)   | `.agents/skills/thinkwork-linear-dispatcher/references/launch-prompts.md`   | Worker prompt templates per phase, handoff comment template, QA-brief rules, goal discipline, model/orchestration policy notes                                                |
| **Codex-lane dispatcher skill**           | `.agents/skills/thinkwork-linear-dispatcher/SKILL.md`                       | Codex heartbeat loop, Codex thread creation rules (`create_thread`, worktree envs, `/goal`), pendingWorktreeId handling                                                       |
| **Claude-lane dispatcher skill**          | `.claude/skills/linear-dispatch/SKILL.md`                                   | Claude heartbeat loop, local worker launches (headless `claude -p` in worktrees), model policy table, liveness/sweep rules, concurrency cap                                   |
| **Human runbook**                         | `docs/runbooks/linear-autonomous-development-loop.md`                       | Operator-facing explanation, startup/ops, agent-browser setup                                                                                                                 |
| **Startup script**                        | `scripts/factory-up.sh`                                                     | One-command Claude-lane bootstrap (preflight → caffeinate → Sonnet loop session)                                                                                              |
| **Codex heartbeat prompt**                | Codex app → Scheduled → "Linear Agent Dispatcher"                           | Tiny skill-invoking prompt only — all real rules live in the repo files above                                                                                                 |
| **Worker scratch**                        | `~/.thinkwork-factory/{prompts,logs}/`                                      | Machine-local, disposable; worker id = `pid + log path + worktree path`                                                                                                       |
| **Artifacts**                             | `docs/{brainstorms,plans,solutions,dogfood-reports}/`, `CONCEPTS.md`        | Requirements, plans, debug findings, verification reports, compounded learnings, vocabulary                                                                                   |

Rule of thumb when changing behavior: routing/status/label semantics →
routing contract; what a worker is told to do → launch prompts; how a worker
is physically launched or monitored → the lane SKILL.md; human explanation →
runbook. Update the shared references and the runbook together; never paste
rules into the Codex app prompt (it rots — the original giant prompt carried
two-week-stale incident state).

## Lanes

Two dispatchers execute the same contract:

- **Codex lane** — the "Linear Agent Dispatcher" scheduled task in the Codex
  app (every 5 min). Workers are Codex cloud threads in worktree
  environments.
- **Claude lane** — a local Claude Code session on Eric's Mac running
  `/loop 4m linear-dispatch` (started by `scripts/factory-up.sh`). Workers
  are headless `claude -p` runs in `.claude/worktrees/auto-*` worktrees.

`Codex` and `Claude` are **lane labels**: exactly one per automated issue
(both at once → `Needs User` lane conflict). Child issues inherit the
parent's lane label.

**Exception: `Verification` status is always Claude-lane**, regardless of
lane label — dogfood verification needs a real browser and operator auth
against deployed dev, which Codex cloud workers don't have. Codex implements;
Claude verifies.

## Labels

| Label                                                                 | Meaning                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Codex` / `Claude`                                                    | Lane label — enrolls the issue and picks the dispatcher                                                                                                     |
| `LFG`                                                                 | Autopilot: skips Requirements Review + Plan Review gates and authorizes the closed loop (implementation → verification → repair rebounds → Done → compound) |
| `Verification Failed`                                                 | Ready to Work is a repair pass seeded by verifier evidence; removed only when verification passes                                                           |
| `Needs User` / `Needs Credentials` / `Unsafe Ambiguity` / `CI Failed` | Blockers — automation stops until cleared. `LFG` does not override them                                                                                     |
| `Blocked: Auth`                                                       | Verification blocked on auth needed for the normal user flow                                                                                                |

## Lifecycle (status machine)

```text
Todo ── Eric: ce-ideate, add lane label
  └─ dispatcher moves → Brainstorming ── ce-brainstorm worker → requirements PR merged
       └─ Requirements Review (human gate; LFG skips) ── Eric approves
            └─ Planning ── ce-plan worker → plan PR + child issues
                 └─ Plan Review (human gate; LFG skips)
                      └─ Ready to Work ── implementation approval (no LFG needed)
                           └─ In Progress ── implementation worker → unit PRs merged
                                └─ Verification ── dogfood worker (Claude lane; LFG runs it, else human)
                                     ├─ PASS → Done ── compound worker (LFG only)
                                     └─ FAIL → Verification Failed + back to Ready to Work (repair pass)

Debug (alternate entry) ── ce-debug worker → findings PR
  └─ hands off to Brainstorming when the diagnosis reveals a product-framing
     question, or Ready to Work / Plan Review for mechanical fixes
```

The full routing table with per-status behavior is in the routing contract.

## State: where truth lives

Per automated issue, three Linear artifacts:

1. **`Progress: <feature title>` document** — the durable loop controller.
   Current state, active work (worker id, branch, PR, stop condition),
   completed units with evidence, next steps, verification contract,
   blockers. The dispatcher reads it before every route; a dead worker is
   resumed _from this document_, never from chat memory.
2. **`automation-ledger:<ISSUE>` comment** — one rolling comment, updated in
   place: current router state, active worker/PR, blocker summary, Progress
   link. A short pointer, not a log.
3. **`handoff:<ISSUE>:<NEXT_PHASE>` comments** — goal batons. Every phase
   transition posts one (Goal / Completed / Start here / Inputs / Open
   questions); the dispatcher embeds the newest baton verbatim in the next
   worker's prompt, and synthesizes one from the Progress doc when a human
   moved the status by hand. Handoffs _into Verification_ are QA briefs:
   entry URL, since-your-last-update, numbered click-level checklist with
   expected observable results, unit mapping, timing caveats.

Launch metadata gets its own `dispatcher:<ISSUE>:<PHASE>:<LANE>` comment.
Repo-side status files are supporting evidence only; on conflict, Linear
wins.

## Workers

Launched fresh per phase from `origin/main` worktrees; prompt = template from
`launch-prompts.md` + the newest handoff baton. Contract highlights:

- **Goal discipline**: the Goal paragraph is the run contract. Exactly two
  valid endings — terminal condition observably true (PRs _merged_, handoff
  posted, status moved, cleanup done) or a hard blocker recorded. CI waits
  MUST be blocking foreground (`gh pr checks --watch` + poll `mergedAt`);
  background watchers die with the process (learned three times on
  THINK-170). The dispatcher's dead-worker sweep completes phase exits when a
  worker dies anyway — safety net, not the plan.
- **Question protocol**: material questions → one comment @mentioning eric1
  with numbered questions and recommended answers, add `Needs User`, stop.
- **Model policy** (Claude lane; every launch passes explicit `--model`):
  dispatcher `sonnet`; brainstorm/plan/implement/repair `fable` acting as
  architect — delegating mechanical implementation to
  `fable-advisor:codex-implementer` (GPT-5.5, default) → `implementer`
  (opus) → sonnet, keeping all verification and Linear duties itself;
  verify/debug `opus`; compound `sonnet`.
- **Unit checkpoints**: one PR per plan unit; Progress updated at
  unit-selected / PR-opened / CI-change / unit-shipped; next unit starts from
  fresh `origin/main` and the Progress doc's Next Steps.

## Verification (dogfood doctrine)

The verifier is a judge, not a mechanic — it never fixes product code.
Diff-scoped, flow-first: map the complete user journeys the change touches
and follow each to its real end, driving **deployed dev** (continuous-CD from
main — the post-merge Deploy run must be green first) in a real browser via
`agent-browser`. Scenario matrix = QA-brief checklist (floor) + mapped flows
(ceiling), checkpointed into `docs/dogfood-reports/<date>-<ISSUE>-dogfood.md`
so a killed run resumes.

Two verdicts per scenario: **functional** (works end to end, data persists)
and **experiential** (as the feature's persona, hunt paper cuts — recorded,
not failing). Verified doctrine from run one: _an agent's write confirmation
is a claim, not evidence_ — pair every write scenario with a DB assertion on
post-deploy timestamps.

Failure classification (fix-loop governor): small/well-understood/low-risk →
`Verification Failed` rebound to Ready to Work with evidence + smallest
suggested fix (repair worker must add a red→green regression test);
large/risky/ambiguous → options + trade-offs + recommendation + `Needs User`;
unprovable by automation → `Blocked: Auth` / `Needs User` with exactly what a
human must check.

## Operations

- **Start Claude lane**: `scripts/factory-up.sh` in a terminal you keep open.
  Rerun weekly (loop expiry), after reboot, or when the terminal closes.
- **Codex lane**: keep the "Linear Agent Dispatcher" task Active in the Codex
  app. Its prompt stays tiny and skill-invoking.
- **Pause a lane**: close the dispatcher terminal / pause the Codex task.
  In-flight workers finish their phase; restarts resume from Linear.
- **agent-browser auth** (verification prerequisite): one-time headed sign-in
  to dev; details in the runbook. Verifiers can also self-recover via the
  Cognito OAuth refresh-token path.
- **Everyday driving**: write the issue in Todo (optionally `ce-ideate`), add
  a lane label. Answer `Needs User` questions in-thread and remove the label
  to resume. Approve at Requirements Review / Plan Review by moving the
  status. Add `LFG` when you trust the issue with the closed loop.

## Known sharp edges / improvement seams

- Headless workers historically exited "waiting on CI" on background
  watchers; goal discipline + blocking-foreground waits fixed it, and the
  dispatcher sweep covers relapses. An alternative design — workers end at
  "PR opened + auto-merge armed" and the dispatcher owns all merge-detection
  and phase exits — was considered and parked.
- The dispatcher janitor must check worker liveness _immediately_ before
  removing worktrees (a live worker once had its worktree swept from under
  it; it survived, but don't).
- Debug → Brainstorming routing worked well on THINK-170 but isn't yet in the
  routing table (contract says Ready to Work / Plan Review).
- Skipping Planning collapses implementation scope to whatever the
  requirements spec tightly (THINK-170 shipped R0 only this way — deliberate,
  but a plan-less Ready to Work always narrows to the best-specified unit).
- Linear writes are attributed to Eric's account (MCP auth); a dedicated
  automation identity would make agent activity distinguishable.
- The Claude lane dies with the Mac; a cloud/routine variant exists as a
  design option if local-only becomes limiting (loses deployed-dev browser
  verification).

## Origin

Designed 2026-07-05 (dual-lane extension of the earlier Codex-only loop),
QA doctrine adapted from Kieran Klaassen's "Closing the Verification Loop."
Vocabulary: see CONCEPTS.md — Delivery Loop cluster (Handoff Baton, Dogfood
Verification, Paper Cut).
