---
name: thinkwork-linear-dispatcher
description: Route ThinkWork Linear issues through Codex automation. Use when acting as the ThinkWork `linear-agent-dispatcher` heartbeat, when asked to inspect ThinkWork Linear automation state, or when deciding whether to launch/continue Codex workers for ThinkWork issues labeled Codex/LFG.
---

# ThinkWork Linear Dispatcher

Use this skill as the executable contract for the ThinkWork Linear dispatcher.
The dispatcher is a router, not an implementation worker. Do not make product
or documentation changes in the dispatcher thread except when explicitly asked
to update this skill or its runbook.

## Required References

Before routing issues, load these files from this skill folder:

1. `references/routing-contract.md` for label/status behavior, duplicate
   detection, ledgers, verification rebound, and cleanup rules.
2. `references/launch-prompts.md` before creating or repairing any Codex worker.

If either reference is unavailable, update the affected issue's rolling ledger
with the missing-skill-resource blocker and stop. Do not fall back to memory.

## Dispatcher Loop

1. Load Linear and thread-management tools. Use tool discovery if needed for
   Linear issue/comment tools and Codex thread tools such as `create_thread`,
   `read_thread`, `send_message_to_thread`, and `set_thread_title`.
2. Find active ThinkWork issues labeled `Codex`.
3. Ignore Backlog, Canceled, Duplicate, and Done, except for the `LFG` Done
   compounding gate.
4. Ignore issues with true blocker labels: `Needs User`, `Needs Credentials`,
   `Unsafe Ambiguity`, or `CI Failed`.
5. Read each candidate issue fully: status, labels, comments, documents,
   attachments, parent/child issues, blockers, dependencies, project, milestone,
   and recent worker evidence.
6. Locate or create the issue progress document. This document controls the
   loop.
   - Preferred title: `Progress: <feature title>`, where `<feature title>` is
     the suffix already used by `Requirements: ...` and `Plan: ...` documents
     on the issue.
   - Fallback title when no matching requirements/plan suffix exists:
     `Progress: <issue title>`.
   - Read the document before dispatch and use its `Active Work`, `Next Steps`,
     blockers, current branch/worktree/PR, and verification notes to decide what
     to continue or launch.
   - If the document is missing for a Codex issue that is beyond Todo, create it
     from the issue, requirements, plan, comments, and current Linear state
     before launching a worker.
7. Locate the rolling ledger comment marked `automation-ledger:<ISSUE_ID>`.
   Keep it short: current router state, active worker id/pendingWorktreeId,
   current PR/branch/worktree, blocker summary, and a link to the progress
   document. Update it in place when possible.
8. Locate worker handoff comments marked
   `dispatcher:<ISSUE_ID>:<PHASE>:Codex`.
9. Run the duplicate-worker gate below. Do this even when Linear comments do
   not mention a worker; missing handoff comments are not proof that no worker
   exists.
10. Route the issue according to `references/routing-contract.md`, with the
    progress document as the authoritative implementation loop state.

## Duplicate-Worker Gate

Before creating any worker, prove there is no existing active worker for the
same Linear issue and phase.

1. Validate each recorded `threadId` from Linear comments with `read_thread`.
   Stale or missing thread ids do not block redispatch, but active readable
   threads do.
2. Search Codex threads with `list_threads` using at least:
   - `<ISSUE_ID>`;
   - the issue title or meaningful title words;
   - known branch/worktree slugs from comments or git branches.
3. Read every matching thread that appears related. Treat active threads as
   active even if their title is missing the Linear issue prefix.
4. Inspect local worktrees with `git worktree list` when shell access is
   available. Branch names, paths, or detached worktrees containing the issue id
   or title slug count as evidence to investigate before launch.
5. Treat `pendingWorktreeId` values as pending setup only when recent, returned
   by `create_thread`, and not visibly failed. Failed pending worktrees do not
   block redispatch, but record the failed id before retrying.

Invariant: there may be at most one active implementation or repair worker for
an issue or child issue. If more than one active worker is found, do not launch
another worker. Pause or leave the dispatcher stopped if possible, update the
handoff comment and rolling ledger with the duplicate evidence, designate the
canonical worker only when the evidence is clear, and instruct the duplicate
worker to stop without committing, pushing, opening PRs, or updating Linear.
Preserve duplicate worktrees for forensic/recovery review unless Eric explicitly
authorizes deletion.

## Worker Creation Rules

When a route requires a Codex worker:

- call Codex `create_thread` in the `/Users/ericodom/Projects/thinkwork`
  project;
- use `environment: { type: "worktree" }`;
- omit `startingState` for new worktrees;
- never pass a made-up branch name as `startingState.branchName`;
- record exactly the returned `threadId` or `pendingWorktreeId`;
- title every worker chat with the Linear issue id prefix, such as
  `THNK-69: Implement Native Work Items`;
- call `set_thread_title` immediately when `create_thread` returns a real
  `threadId`;
- record the desired title in Linear when `create_thread` returns only a
  `pendingWorktreeId`, then set it after the real thread exists;
- update the rolling ledger and post/update a handoff comment with the stable
  marker, desired title, project, worktree mode, and returned id.
- update the progress document before launch with the selected phase/unit,
  expected worker title, returned `threadId` or `pendingWorktreeId`, branch or
  worktree expectations when known, and the exact stop condition.

Implementation and repair prompts must include a first-action goal instruction.
The worker must set a Codex thread goal with the goal tool or `/goal` before
changing code. The goal must name the issue, implementation scope, PR/artifact
landing expectation, Linear evidence to update, and terminal phase.

## Progress Document Discipline

Each automated issue uses one attached Linear document as the durable loop
controller. The document is named:

```text
Progress: <feature title>
```

Use the same `<feature title>` suffix as the attached `Requirements: ...` and
`Plan: ...` documents. If those documents are absent or do not share a suffix,
use the Linear issue title.

The progress document must include, and workers must keep current:

- current Linear state, labels, and automation mode;
- completed units with PRs, merge commits, CI results, local verification, and
  cleanup evidence;
- active work with branch, worktree, PR, worker thread id or pendingWorktreeId,
  current blocker, and exact next action;
- remaining plan units and dependencies;
- verification contract and latest pass/fail evidence;
- repair rebound evidence when `Verification Failed` is present.

Dispatcher rule: before creating or continuing any worker, read the progress
document and use `Active Work` plus `Next Steps` as the primary source for what
the next heartbeat should do. Linear status still gates which phase is allowed;
the progress document controls the unit-level loop inside that phase. If Linear
status/comments and the progress document disagree, pause launch, update the
rolling ledger with the mismatch, and reconcile by reading issue history,
threads, worktrees, and PRs before proceeding.

## Comment Discipline

Use one rolling ledger comment per issue/unit as the short router pointer. New
comments are reserved for:

- real worker handoffs;
- hard blockers;
- failed verification verdicts;
- final completion summaries.

Do not create noisy progress streams. Durable progress belongs in the
`Progress: ...` Linear document; the rolling comment should point to it and
summarize only the current dispatch state.

## Stop Conditions

Stop only for hard blockers:

- missing Linear/Codex/GitHub credentials or permissions;
- unavailable required tools after tool discovery;
- branch protection or CI requiring a human-only approval;
- destructive or production mutation action not already authorized;
- merge conflict or test failure that cannot be resolved safely from repo
  context;
- plan ambiguity where any reasonable choice risks building the wrong product
  or violating scope.

When stopped, update the progress document with the exact blocker, attempted
commands/tool calls, current worker/thread id if any, and the recommended next
action. Also update the rolling ledger with a short blocker summary and a link
to the progress document.
