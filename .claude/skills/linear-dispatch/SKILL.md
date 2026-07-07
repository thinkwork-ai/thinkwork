---
name: linear-dispatch
description: Route ThinkWork Linear issues through Claude Code automation. Use as the Claude-lane dispatcher heartbeat (usually via /loop), when asked to inspect ThinkWork Claude-lane automation state, or when deciding whether to launch/continue local Claude workers for issues labeled Claude/LFG or issues in Verification.
---

# ThinkWork Linear Dispatcher — Claude Lane

Use this skill as the executable contract for the Claude-lane dispatcher. The
dispatcher is a router, not an implementation worker. Do not make product or
documentation changes in the dispatcher session except when explicitly asked
to update this skill or its runbook. Do not touch the main checkout's git
state; workers get their own worktrees.

One invocation of this skill is one heartbeat. Eric runs the loop with:

```text
claude --model sonnet     # dispatcher session runs on Sonnet — routing is mechanical
/loop linear-dispatch     # no interval: self-paced, see Heartbeat Pacing
```

from a dedicated Claude Code session at the repo root, with the Mac kept awake
(`caffeinate -dims` in a spare terminal). The `/loop` recurring task expires
after 7 days and must be restarted.

## Heartbeat Pacing

The loop is self-paced: at the end of every heartbeat, schedule the next
wakeup based on what the factory is actually waiting on — never a fixed
interval regardless of state. Pick the delay from this table (first matching
row wins) and say in the wakeup reason what you are watching:

| Factory state after this heartbeat                                                                             | Next heartbeat |
| -------------------------------------------------------------------------------------------------------------- | -------------- |
| Any live local worker, `waiting-on-deploy`, a pending phase transition, or a dead-worker relaunch you deferred | 240s           |
| Issues enrolled but all waiting on human gates (`Needs User`, Requirements/Plan Review without `LFG`)          | 1200s          |
| No candidate issues at all (nothing lane-labeled active, nothing in Verification)                              | 1800s          |

Do not pick 300s or other values between 270s and 1200s: the prompt cache
lives 5 minutes, so 240s keeps the dispatcher context warm while anything is
in flight, and once nothing can change for a while a heartbeat should be rare
enough to amortize the cold read. An idle factory must not poll every few
minutes.

## Model Policy

The dispatcher runs on Sonnet. Workers get an explicit `--model` per phase —
never inherit the session default:

Every worker also gets `--max-budget-usd` — a runaway backstop, not a target.
A worker killed by its budget shows the budget error in its log tail and is
handled by the normal dead-worker sweep (relaunch from the Progress document).
If the same phase hits its cap twice in a row, do not relaunch a third time:
record it as a blocker per the question protocol instead.

| Phase                   | `--model` | `--max-budget-usd` | Notes                                                               |
| ----------------------- | --------- | ------------------ | ------------------------------------------------------------------- |
| Brainstorm, Plan        | `fable`   | 25                 | Architect-as-orchestrator: delegate units to cheaper lanes (below). |
| Implement/Repair        | `fable`   | 100                | Same orchestration doctrine; largest phase.                         |
| Verify (dogfood), Debug | `opus`    | 50                 | Judgment-heavy; browser + evidence work.                            |
| Compound                | `sonnet`  | 10                 | Mechanical distillation.                                            |

Fable workers must act as architects, not typists: load the fable-advisor
orchestration doctrine and delegate mechanical implementation to subagent
lanes — `fable-advisor:codex-implementer` (GPT-5.5) as the default
implementation lane, `fable-advisor:implementer` with `model: "opus"` for
subtle/high-stakes units, Sonnet implementer last. The Fable session writes
specs, reviews diffs, and owns verification evidence; it consults
`fable-advisor:fable-advisor` at commitment boundaries.

## Required References

Before routing issues, load these shared files (source of truth for both
lanes):

1. `.agents/skills/thinkwork-linear-dispatcher/references/routing-contract.md`
   for lane rules, label/status behavior, goal handoffs, question protocol,
   duplicate detection, ledgers, verification rebound, and cleanup rules.
2. `.agents/skills/thinkwork-linear-dispatcher/references/launch-prompts.md`
   before launching any worker.

If either reference is unavailable, update the affected issue's rolling ledger
with the missing-skill-resource blocker and stop. Do not fall back to memory.

## Dispatcher Loop

0. Run `scripts/factory-status.sh` (one Bash call). It reports every recorded
   local worker (ALIVE/DEAD from pid sidecars, log size/age, log tail), the
   `auto-*` worktrees, and orphan logs. Use this snapshot as the local-worker
   evidence for the liveness sweep and the duplicate-worker gate below instead
   of ad-hoc `ps`/`ls`/`worktree list` reasoning.
1. Load Linear MCP tools (issues, comments, documents, labels).
2. Find active ThinkWork-team issues labeled `Claude`, plus **all issues in
   `Verification` status regardless of lane label** — Verification is owned by
   the Claude lane (see routing contract).
3. Skip issues labeled both `Codex` and `Claude`: apply the lane-conflict rule
   from the routing contract.
4. Ignore Backlog, Canceled, Duplicate, and Done, except for the `LFG` Done
   compounding gate (own lane label only).
5. Ignore issues with true blocker labels: `Needs User`, `Needs Credentials`,
   `Unsafe Ambiguity`, or `CI Failed`.
6. Read each candidate issue fully: status, labels, comments, documents,
   attachments, parent/child issues, blockers, dependencies, and recent worker
   evidence.
7. Locate or create the issue progress document (`Progress: <feature title>`,
   rules in the routing contract). Read it before dispatch; it controls the
   unit-level loop.
8. Locate the rolling ledger comment `automation-ledger:<ISSUE_ID>` and the
   newest `handoff:<ISSUE_ID>:<PHASE>` comment for the current phase. If the
   phase was entered without a handoff comment, synthesize one from the
   Progress document and issue history, post it, then proceed.
9. Run the duplicate-worker gate below.
10. Route per the routing contract. Launch markers use
    `dispatcher:<ISSUE_ID>:<PHASE>:Claude`.

Every heartbeat must leave each inspected issue in one observable router
state: `active-worker`, `pending-worker`, `waiting`, `blocked`, `launched`, or
`skipped-with-reason` (see routing contract). At most one new
implementation/repair worker per heartbeat; monitoring existing workers does
not consume the launch budget. Keep at most three local workers running
concurrently; skip further launches with
`skipped-with-reason: concurrency cap`.

## Worker Creation Rules

Claude workers are headless Claude Code runs in isolated worktrees.

When a route requires a worker:

1. Build the prompt from `launch-prompts.md`: fill placeholders, apply the
   Claude lane notes (use CE plugin skills; drop the Codex `/goal`
   instruction), and append the newest `handoff:<ISSUE_ID>:<PHASE>` comment
   verbatim under `Handoff from previous phase:`.
2. Write the prompt to `~/.thinkwork-factory/prompts/<ISSUE_ID>-<phase>-<ts>.md`
   (create directories as needed).
3. Create a fresh worktree off `origin/main`:

   ```bash
   git -C /Users/ericodom/Projects/thinkwork fetch origin main
   git -C /Users/ericodom/Projects/thinkwork worktree add \
     /Users/ericodom/Projects/thinkwork/.claude/worktrees/auto-<issue-slug>-<phase> \
     -b auto/<issue-slug>-<phase> origin/main
   ```

4. Launch the worker in the background, passing the phase's model and budget
   cap from the Model Policy table (never rely on the session default), and
   write the pid sidecar next to the log — `scripts/factory-status.sh` reads
   it on every later heartbeat:

   ```bash
   cd <worktree> && nohup claude -p "$(cat <prompt-file>)" \
     --model <phase-model> \
     --max-budget-usd <phase-budget> \
     --dangerously-skip-permissions \
     > ~/.thinkwork-factory/logs/<ISSUE_ID>-<phase>-<ts>.log 2>&1 &
   echo $! > ~/.thinkwork-factory/logs/<ISSUE_ID>-<phase>-<ts>.pid
   ```

5. Record the worker id as `pid:<PID> log:<log-path> worktree:<path>`.

Atomic launch rule: immediately after launch, and before inspecting another
issue, update in this order:

1. Progress document `Active Work` with the worker id and stop condition.
2. Rolling ledger `automation-ledger:<ISSUE_ID>`.
3. Launch comment `dispatcher:<ISSUE_ID>:<PHASE>:Claude` (worker id, prompt
   file, worktree, phase, expected stop).
4. Linear issue state when the phase transition requires it, such as
   `Ready to Work` -> `In Progress`.

If any Linear update fails after the process started, retry once, then record
`launch-recording-failed` with the pid wherever possible. Never launch a
second worker for the same issue in that heartbeat.

## Worker Liveness And Continuation

A Claude worker's durable state is the Progress document and handoff
comments, not the process. On each heartbeat, for each recorded worker id
(liveness comes from the step-0 `factory-status.sh` snapshot):

- ALIVE and the log growing → `active-worker`; do not launch.
- Process gone and the phase's exit evidence (merged PR, status move, posted
  handoff, verdict) is recorded in Linear → the phase completed; route the new
  status normally.
- Process gone, phase incomplete → treat as a dead worker: read the tail of
  the log for a blocker, record what happened in the ledger, and launch a
  fresh worker whose prompt starts from the Progress document and newest
  handoff comment. Do not try to resume the dead session.

## Duplicate-Worker Gate

Before creating any worker, prove there is no existing active worker for the
same issue and phase:

1. Cross-check every recorded `pid:` in Linear comments against the step-0
   `factory-status.sh` snapshot (ALIVE/DEAD state and log recency). A pid
   recorded in Linear but absent from the snapshot must still be checked with
   `ps -p` directly.
2. Scan the snapshot's worktree and orphan-log sections for the issue id or
   title slug.
3. For issues entering Verification from the Codex lane, validate recorded
   Codex `threadId`s are inactive (via Codex MCP `read_thread` when available;
   otherwise treat a recent unresolved Codex launch comment as active and
   wait).

Invariant: at most one active implementation or repair worker per issue or
child issue. On duplicates, follow the routing contract's duplicate-worker
incident handling: launch nothing, record all evidence, and stay paused until
Eric re-enables.

## Worktrees, PRs, And Cleanup

Workers own their cleanup: squash-merge when allowed, delete remote and local
branches, remove their completed worktree, per the routing contract. The
dispatcher may run a conservative janitor pass for stale `auto-*` worktrees
only when the worktree is clean, inactive, and tied to a merged or deleted
automation branch.

## Stop Conditions

Stop only for hard blockers (missing credentials/tools, human-only approvals,
unsafe ambiguity, unresolvable conflicts — full list in the routing contract).
When stopped, update the Progress document with the exact blocker, attempted
commands, worker id if any, and recommended next action, and update the
rolling ledger with a short blocker summary.
