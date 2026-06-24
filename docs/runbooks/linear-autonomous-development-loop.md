---
title: "Linear autonomous development loop"
date: 2026-06-24
status: active
---

# Linear Autonomous Development Loop

This runbook defines the ThinkWork team's Linear-driven development loop for
Codex automation. The loop aligns Linear state with the Compound Engineering
workflow:

```text
ce-brainstorm -> ce-plan -> ce-work/autopilot -> verification -> ce-compound
```

The goal is a reliable autonomous path that is explicit about opt-in,
verification, cleanup, and human review.

## Dispatcher Skill

The executable dispatcher contract lives in the repo-local Codex skill:

```text
.agents/skills/thinkwork-linear-dispatcher/SKILL.md
```

The `linear-agent-dispatcher` heartbeat prompt should stay tiny and invoke that
skill every run. The skill owns the routing rules, tool sequence, worker launch
contract, and reusable launch prompt templates. This runbook explains the
workflow for humans; the skill is the automation source of truth.

When changing dispatcher behavior, update the skill and this runbook together.
Do not paste a large copy of the rules back into the automation prompt.

## Label Contract

Use status for phase, labels for routing and permissions:

| Label                 | Meaning                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------- |
| `Codex`               | Enrolls the issue in Codex dispatcher automation.                                       |
| `LFG`                 | Runs end-to-end autopilot across implementation, verification, repair, Done, compound.  |
| `Verification Failed` | Marks a Ready to Work issue as a repair pass seeded by failed verification evidence.    |
| Blocker labels        | `Needs User`, `Needs Credentials`, `Unsafe Ambiguity`, and `CI Failed` stop automation. |

`Ready to Work` is implementation approval. A `Codex` issue in Ready to Work
should launch the autopilot implementation prompt even when `LFG` is absent.
Without `LFG`, the agent works the implementation pass, moves the issue to
Verification, and stops for human review. With `LFG`, the agent owns the full
closed loop: implementation, verification, repair rebounds, Done, and selective
compounding.

The old `Human` label is retired from the ThinkWork workflow. If a `Human`
label still exists historically, the dispatcher must ignore it and must not
recreate old Human-gated behavior.

## Status Model

The dispatcher is a router, not an implementation worker. It uses Linear status
as the phase source of truth:

| Status                | Dispatcher behavior                                                            |
| --------------------- | ------------------------------------------------------------------------------ |
| `Todo`                | If labeled `Codex`, move to `Brainstorming` and stop.                          |
| `Brainstorming`       | Launch or continue a `ce-brainstorm` worker.                                   |
| `Requirements Review` | Wait unless `LFG` is present, then move to `Planning`.                         |
| `Planning`            | Launch or continue a `ce-plan` worker.                                         |
| `Plan Review`         | Wait unless `LFG` is present, then move to `Ready to Work`.                    |
| `Ready to Work`       | Launch implementation when `Codex` is present and no blocker labels exist.     |
| `In Progress`         | Continue active implementation or repair work.                                 |
| `Verification`        | Wait for human review unless `LFG` is present.                                 |
| `Done`                | Do not implement or verify. Run selective `ce-compound` for `LFG` completions. |

`Codex` without `LFG` may run one CE phase at a time and waits at Requirements
Review and Plan Review. If a human moves the issue to Ready to Work,
implementation is approved and should launch. After that implementation pass,
non-`LFG` work moves to Verification and stops. `Codex` plus `LFG` skips
Requirements Review and Plan Review, then continues through automated
verification, repair loops, Done, and compounding unless there is a true hard
blocker or unsafe ambiguity.

## Child Issues As Work Units

Linear child issues are the canonical autonomous implementation unit.

During Planning, the worker must create or update child issues when the work has
multiple shippable units. Each child issue must include:

- a clear unit objective;
- the required implementation scope;
- dependencies or ordering constraints;
- a plan-owned verification contract;
- inherited `Codex` and, when present on the parent, `LFG` labels.

The parent issue tracks aggregate progress. It moves to `In Progress` when the
first child starts, moves to `Verification` when all children are implemented,
and moves to `Done` only after all children pass verification.

Each independently running parent or child issue gets its own attached Linear
progress document. For parent/child trees, the parent progress document tracks
aggregate child state and links to child progress documents; each child progress
document controls that child's implementation and verification loop.

## Ready To Work Modes

`Ready to Work` has two modes:

1. First implementation pass: the issue has `Codex` and does not have
   `Verification Failed`.
2. Repair pass: the issue has `Codex` and `Verification Failed`.

A repair worker must start from the failed verification evidence and implement
the smallest correct fix. The `Verification Failed` label stays in place through
the repair pass and is removed only after verification passes.

## Verification Contract

The plan owns the definition of "correct and done." A verification worker must
grade the implementation against the plan-owned verification contract for the
active child issue or parent issue.

Verification workers are judges, not mechanics. They must not fix product code.
They must:

- inspect requirements, plan, PRs, comments, and existing evidence;
- actively produce missing end-to-end evidence when safe;
- prefer local dev server plus Browser for UI workflows;
- use sanctioned dev/test deploy, smoke, teardown, and cleanup paths when the
  plan requires deployed proof;
- record concrete pass/fail evidence in the rolling Linear ledger;
- move failed work back to `Ready to Work` with `Verification Failed` when the
  behavior is wrong, incomplete, not wired, or not deployable;
- add blocker labels only for true blockers such as missing credentials,
  unavailable context, unsafe ambiguity, CI failure, human-only approval, or an
  unauthorized destructive action.

Done requires merged implementation and artifact PRs plus the proof required by
the verification contract. If the plan requires deployed proof, local checks
alone are not enough.

## Progress Documents And Ledgers

Linear is the canonical progress ledger for autopilot work. Every `Codex` issue
that is beyond `Todo` should have an attached progress document named:

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
round, unit completion, PR open, CI failure/repair, PR merge, verification
verdict, blocker, and cleanup.

Use one rolling Linear automation ledger comment per issue or unit. The
dispatcher and workers should update that comment in place whenever possible,
but it is only a short router pointer: current phase, active worker or pending
worktree, active branch/worktree/PR, blocker summary, and a link to the progress
document. New comments are reserved for:

- worker handoffs;
- hard blockers;
- failed verification verdicts;
- final completion summaries.

Repo-local files such as `docs/plans/autopilot/<ISSUE>-status.md` may still be
used as supporting committed evidence, but they are not the dispatcher source of
truth. If a repo status file and the Linear progress document disagree, the
dispatcher must pause launch, inspect Linear history, worker threads, worktrees,
and PRs, then reconcile the Linear progress document before proceeding.

## Worker Launches

The dispatcher must create real Codex project threads. A Linear comment is not a
worker launch.

When launching a ThinkWork worker, the dispatcher must:

- call Codex `create_thread` in the `/Users/ericodom/Projects/thinkwork`
  project;
- use a worktree environment and omit `startingState` for new worktrees;
- record only the returned `threadId` or `pendingWorktreeId`;
- title every worker chat with the Linear issue id prefix, such as
  `THNK-69: Implement Native Work Items`;
- call `set_thread_title` immediately when `create_thread` returns a real
  `threadId`;
- record the desired title in Linear when `create_thread` returns only a
  `pendingWorktreeId`, then set the title after the real thread exists;
- include a Codex goal instruction in every implementation or repair prompt,
  and require the worker to set the thread goal before changing code;
- include the progress document URL/title in every launch prompt and require
  the worker to read it before selecting the next unit;
- update the progress document before launch with selected phase/unit, desired
  title, returned `threadId` or `pendingWorktreeId`, active branch/worktree when
  known, and expected stop condition;
- validate existing `threadId` values with `read_thread` before treating them
  as active;
- ignore stale handoff comments whose thread ids cannot be read;
- treat failed pending worktrees as failed launches and retry with corrected
  inputs while the issue remains eligible.

Do not pass a made-up branch name as `startingState.branchName` for a new
worker. Codex treats that value as an existing git ref, so worktree creation
fails if the ref does not already exist.

Implementation and repair prompts must include a first-action goal line. The
goal should name the Linear issue, the implementation scope, the expected PR or
artifact landing, the Linear ledger/status evidence to update, and the terminal
phase. For non-`LFG` issues, the goal ends at moving the issue to Verification
for human review. For `LFG` issues, the goal covers the closed loop through
verification, repair rebounds, Done, and selective compounding.

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
recommendation says there is durable learning to preserve.
