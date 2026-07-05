---
title: "Linear autonomous development loop"
date: 2026-07-05
status: active
---

# Linear Autonomous Development Loop

This runbook defines the ThinkWork team's Linear-driven development loop for
agent automation. Two dispatcher lanes — Codex and Claude Code — drive the same
Compound Engineering workflow:

```text
ce-ideate (human) -> ce-brainstorm -> ce-plan -> ce-work/autopilot
  -> dogfood verification -> ce-compound
```

The goal is a reliable autonomous path that is explicit about opt-in,
verification, cleanup, and human review.

## Dispatcher Skills

The executable dispatcher contracts live in two lane skills that share one
routing contract:

```text
.agents/skills/thinkwork-linear-dispatcher/SKILL.md      # Codex lane
.claude/skills/linear-dispatch/SKILL.md                  # Claude lane
.agents/skills/thinkwork-linear-dispatcher/references/   # shared routing contract + launch prompts
```

The Codex `linear-agent-dispatcher` heartbeat prompt should stay tiny and
invoke the Codex skill every run. The Claude lane runs as a `/loop` in a
dedicated local Claude Code session (see Operations below). The shared
references own the routing rules, handoff contract, and launch prompt
templates. This runbook explains the workflow for humans; the skills are the
automation source of truth.

When changing dispatcher behavior, update the shared references, the affected
lane skill, and this runbook together. Do not paste a large copy of the rules
back into the automation prompt.

## Label Contract

Use status for phase, labels for routing and permissions:

| Label                 | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `Codex`               | Lane label: routes the issue to the Codex dispatcher.                                   |
| `Claude`              | Lane label: routes the issue to the Claude Code dispatcher.                             |
| `LFG`                 | Runs end-to-end autopilot across implementation, verification, repair, Done, compound.  |
| `Verification Failed` | Marks a Ready to Work issue as a repair pass seeded by failed verification evidence.    |
| Blocker labels        | `Needs User`, `Needs Credentials`, `Unsafe Ambiguity`, and `CI Failed` stop automation. |
| `Blocked: Auth`       | Verification is blocked on auth needed to complete the normal user/admin flow.          |

An automated issue carries exactly one lane label; both at once is a lane
conflict that halts routing with `Needs User`. Child issues inherit the
parent's lane label and `LFG`.

`Ready to Work` is implementation approval. A lane-labeled issue in Ready to
Work launches the autopilot implementation prompt even when `LFG` is absent.
Without `LFG`, the agent works the implementation pass, moves the issue to
Verification, and stops for human review. With `LFG`, the agent owns the full
closed loop: implementation, verification, repair rebounds, Done, and selective
compounding.

The old `Human` label is retired from the ThinkWork workflow. If a `Human`
label still exists historically, the dispatchers must ignore it and must not
recreate old Human-gated behavior.

## Status Model

Dispatchers are routers, not implementation workers. Linear status is the
phase source of truth:

| Status                | Dispatcher behavior                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Todo`                | Human phase: Eric fleshes out the issue (usually `ce-ideate`), then adds one lane label. The lane dispatcher moves it to `Brainstorming` and stops. |
| `Brainstorming`       | Launch or continue a `ce-brainstorm` worker.                                                                                                        |
| `Requirements Review` | Wait unless `LFG` is present, then move to `Planning`.                                                                                              |
| `Planning`            | Launch or continue a `ce-plan` worker.                                                                                                              |
| `Plan Review`         | Wait unless `LFG` is present, then move to `Ready to Work`.                                                                                         |
| `Ready to Work`       | Launch implementation when lane-labeled and no blocker labels exist.                                                                                |
| `In Progress`         | Continue active implementation or repair work.                                                                                                      |
| `Verification`        | **Claude lane only, both lane labels.** Wait for human review unless `LFG`, then launch a dogfood verification worker.                              |
| `Done`                | Do not implement or verify. Run selective `ce-compound` for `LFG` completions.                                                                      |

A lane label without `LFG` runs one CE phase at a time and waits at
Requirements Review and Plan Review. If a human moves the issue to Ready to
Work, implementation is approved and should launch. After that implementation
pass, non-`LFG` work moves to Verification and stops. A lane label plus `LFG`
skips Requirements Review and Plan Review, then continues through automated
verification, repair loops, Done, and compounding unless there is a true hard
blocker or unsafe ambiguity.

Verification always runs on the Claude lane — it drives a real browser with
operator auth against the deployed dev stack, which Codex cloud workers
cannot do. Codex implements; the Claude lane verifies.

## Goal-Based Handoff Comments

Every phase transition posts a baton: a `handoff:<ISSUE_ID>:<NEXT_PHASE>`
comment containing a one-sentence goal for the next worker, what the finished
phase shipped (with links), exact start-here actions, required inputs, and
carried-forward open questions. The dispatcher includes the newest handoff
comment verbatim in the next worker's launch prompt, and synthesizes one from
the Progress document when a human moved the status without one. The template
lives in the shared `launch-prompts.md`.

Handoffs into Verification are QA briefs: entry-point URL on deployed dev,
"since your last update" summary, merged PRs and Deploy run link, a numbered
click-level QA checklist with the expected observable result for each step,
unit mapping, and timing caveats. The verifier seeds its scenario matrix from
that checklist — it is the floor, not the ceiling.

## Questions During A Phase

When a material question blocks a worker (product scope, destructive choices,
ambiguity that risks wrong work), it posts one comment @mentioning eric1 with
numbered questions and a recommended answer for each, adds `Needs User`, and
stops. Answer in the thread, remove the label, and the next heartbeat resumes
the phase. `LFG` does not override `Needs User`. Trivial reversible choices
are made autonomously and recorded in the Progress document.

## Child Issues As Work Units

Linear child issues are the canonical autonomous implementation unit.

During Planning, the worker must create or update child issues when the work has
multiple shippable units. Each child issue must include:

- a clear unit objective;
- the required implementation scope;
- dependencies or ordering constraints;
- a plan-owned verification contract naming the complete user flows that prove
  the unit works;
- the parent's inherited lane label and, when present, `LFG`.

The parent issue tracks aggregate progress. It moves to `In Progress` when the
first child starts, moves to `Verification` when all children are implemented,
and moves to `Done` only after all children pass verification.

Each independently running parent or child issue gets its own attached Linear
progress document. For parent/child trees, the parent progress document tracks
aggregate child state and links to child progress documents; each child progress
document controls that child's implementation and verification loop.

## Unit Checkpoint PRs

Each implementation unit in a plan is a checkpoint boundary. The default is one
checkpoint PR per unit. Group units only when the plan explicitly says they are
tightly coupled or when splitting would create unsafe intermediate behavior.

Before a worker begins a unit, it updates the Progress document with the unit
id/name, scope, dependencies, verification contract, selected worker, branch,
worktree, and expected stop condition. When the PR opens, the worker records
the PR URL, commit range, commands run, remaining verification, and risks. When
CI fails or verification changes, the worker records the evidence, fix, and
rerun state.

After a unit ships, the worker updates the Progress document with the merged PR,
merge commit, passing CI, required local or deployed proof, cleanup evidence,
and the next unit candidate. The rolling ledger is then updated as a short
pointer to the Progress document.

Only after that checkpoint should the worker continue. Continuing means
syncing from `origin/main`, compacting/checkpointing context, and starting the
next unit from the Progress document's `Next Steps`, not from chat memory alone.

## Ready To Work Modes

`Ready to Work` has two modes:

1. First implementation pass: the issue is lane-labeled and does not have
   `Verification Failed`.
2. Repair pass: the issue is lane-labeled and has `Verification Failed`.

A repair worker must start from the failed verification evidence (verdict
comment plus dogfood report) and implement the smallest correct fix, including
a regression test that is red before and green after the fix. The
`Verification Failed` label stays in place through the repair pass and is
removed only after verification passes.

## Verification Contract (Dogfood)

The plan owns the definition of "correct and done." Verification is a dogfood
run against the deployed dev stack — dev is continuous-CD from `main`, so the
verifier first confirms the post-merge Deploy workflow run is green.

Verification workers are judges, not mechanics. They must not fix product
code. They must:

- scope to the diff: enumerate what the merged PRs changed, never re-test the
  whole app;
- map the complete user flows the change participates in and follow each flow
  to its real end (a reply feature is proven when the recipient's click lands
  on the right thread, not when the form submits);
- build a scenario matrix from the plan-owned verification contract plus the
  mapped flows, checkpointed in the report file so a killed run can resume;
- drive the deployed dev stack through each scenario in a real browser
  (agent-browser / Chrome), capturing URLs, screenshots, console/network
  errors, and persisted-data checks;
- record two verdicts per scenario: functional (works end to end) and
  experiential (as the feature's persona, hunt paper cuts — friction too small
  to fail a test but real enough to degrade the experience; paper cuts don't
  fail verification, they become report entries and follow-up issues);
- classify every failure with the fix-loop governor: small/well-understood/
  low-risk → `Verification Failed` rebound to Ready to Work with exact
  evidence and the smallest suggested fix; large/risky/ambiguous → options,
  trade-offs, and a recommendation with `Needs User`; unprovable-by-automation
  (external email delivery, third-party OAuth, broken auth) → `Blocked: Auth`
  or `Needs User` with exactly what a human must check;
- write the durable report to `docs/dogfood-reports/<date>-<ISSUE>-dogfood.md`
  and merge it via a docs-only PR, linked from the Progress document.

Done requires merged implementation and artifact PRs, the proof required by
the verification contract, and the merged dogfood report with an empty (or
explicitly handed-off) "Decisions for a human" section. If the plan requires
deployed proof, local checks alone are not enough.

## Progress Documents And Ledgers

Linear is the canonical progress ledger for autopilot work. Every lane-labeled
issue that is beyond `Todo` should have an attached progress document named:

```text
Progress: <feature title>
```

Use the same `<feature title>` suffix as the attached
`Requirements: <feature title>` and `Plan: <feature title>` documents. If those
documents are absent or do not share a suffix, use the issue title.

The progress document controls the loop. The dispatcher reads it before each
heartbeat route and uses its `Active Work`, `Next Steps`, blocker notes, worker
ids, current PR, branch/worktree, verification evidence, and cleanup state to
decide whether to continue, repair, verify, or launch the next worker. Linear
status still gates which phase is allowed; the progress document controls the
unit-level continuity inside that phase.

Workers and verifiers update the progress document after every meaningful
round, unit selection, PR open, CI failure/repair, unit PR merge, verification
verdict, blocker, and cleanup. Unit completion is the strongest checkpoint:
Progress must include shipped evidence and the next unit before the worker
continues.

Use one rolling Linear automation ledger comment per issue or unit
(`automation-ledger:<ISSUE_ID>`). The dispatcher and workers should update
that comment in place whenever possible, but it is only a short router
pointer: current phase, active worker or pending worktree, active
branch/worktree/PR, blocker summary, and a link to the progress document. New
comments are reserved for:

- goal handoffs and worker launches;
- hard blockers and questions for Eric;
- failed verification verdicts;
- final completion summaries.

Repo-local files such as `docs/plans/autopilot/<ISSUE>-status.md` may still be
used as supporting committed evidence, but they are not the dispatcher source of
truth. If a repo status file and the Linear progress document disagree, the
dispatcher must pause launch, inspect Linear history, worker threads, worktrees,
and PRs, then reconcile the Linear progress document before proceeding.

## Worker Launches

A Linear comment is not a worker launch; dispatchers must create real workers.

- **Codex lane**: Codex project threads in the
  `/Users/ericodom/Projects/thinkwork` project with worktree environments,
  titled with the issue id, with a first-action `/goal`. Full rules in
  `.agents/skills/thinkwork-linear-dispatcher/SKILL.md`.
- **Claude lane**: local headless `claude -p` runs in fresh worktrees under
  `.claude/worktrees/auto-*`, logs and prompt files under
  `~/.thinkwork-factory/`, recorded as `pid:<PID> log:<path> worktree:<path>`.
  Full rules in `.claude/skills/linear-dispatch/SKILL.md`.

Launches are atomic: after a worker is created, the dispatcher immediately
records the returned worker id in the Progress document, rolling ledger, and
`dispatcher:<ISSUE_ID>:<PHASE>:<LANE>` launch comment, then moves the issue
state when required. Every launch prompt embeds the newest
`handoff:<ISSUE_ID>:<PHASE>` comment. Each inspected issue ends a heartbeat in
one observable router state: active worker, pending worker, waiting, blocked,
launched, or skipped with reason. A dispatcher may create at most one new
implementation/repair worker per heartbeat.

## Worktrees, PRs, And Cleanup

All repo work must happen in isolated worktrees from fresh `origin/main`.

For Ready to Work implementation, workers may squash-merge implementation PRs
after required checks pass, then delete remote branches, delete local branches,
remove completed worktrees, and sync from `origin/main` before moving the issue
to Verification. Without `LFG`, the automation stops there for human review.
With `LFG`, later heartbeats continue through verification, repair rebounds,
Done, and selective compounding.

Each worker must clean up its own completed worktree and branch. The dispatcher
may also run a conservative janitor pass for stale automation worktrees, but
only when the worktree is clean, inactive, and tied to a merged or deleted
automation branch.

## Compound Gate

After an issue reaches `Done`, run selective `ce-compound` for completed
CE-driven work that has not already been compounded. Run the recommendation
step, accept the recommendation automatically, and create docs only when the
recommendation says there is durable learning to preserve. The compound worker
also mines the dogfood report for durable paper-cut patterns.

## Operations

**Codex lane**: the `linear-agent-dispatcher` heartbeat agent in the Codex app
invokes the Codex skill on its schedule. No local process is required.

**Claude lane**: run a dedicated Claude Code session at the repo root on
Eric's Mac:

```bash
caffeinate -dims   # separate terminal, keeps the Mac awake
claude             # then inside the session:
/loop 4m linear-dispatch
```

Notes:

- `/loop` recurring tasks expire after ~7 days; restart the loop weekly.
- The dispatcher session never edits the repo; workers run headless in their
  own worktrees with logs in `~/.thinkwork-factory/logs/`.
- To pause the lane, stop the loop; in-flight workers finish their current
  phase and stop at the next gate.
- Both lanes tolerate restarts: all durable state lives in Linear (Progress
  document + handoff comments), so a fresh dispatcher resumes from Linear.

### Agent Browser Setup (verification prerequisite)

Verification workers drive the deployed dev stack with the `agent-browser`
CLI (a Rust binary controlling a real browser; workers invoke it via the
`agent-browser` skill). One-time setup on the machine running the Claude
lane:

1. Confirm the binary: `agent-browser --version` (installed via Homebrew at
   `/opt/homebrew/bin/agent-browser`; state lives in `~/.agent-browser/`).
2. Seed an authenticated session for deployed dev: open the dev web app in a
   headed run (`agent-browser open <dev-web-url> --headed`), complete the
   Google/Cognito sign-in once, and confirm the app loads signed in. The
   session persists in the agent-browser profile, so later headless
   verification runs start authenticated.
3. Re-run the headed sign-in whenever verification starts failing with
   `Blocked: Auth` — expired Cognito refresh tokens are the usual cause.

Flows that require accounts or grants the profile does not have (other
tenants, third-party OAuth consents, real email delivery) stay human-verified
per the fix-loop governor.
