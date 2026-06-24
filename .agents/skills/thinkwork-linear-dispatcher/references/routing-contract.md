# ThinkWork Linear Routing Contract

## Labels

Use Linear status for phase and labels for routing/permissions:

| Label                 | Meaning                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Codex`               | Enrolls the issue in ThinkWork Codex automation.                                                                      |
| `LFG`                 | Authorizes the closed loop: implementation, automated verification, repair rebounds, Done, and selective compounding. |
| `Verification Failed` | Marks a Ready to Work issue as a repair pass seeded by failed verification evidence.                                  |
| Blocker labels        | `Needs User`, `Needs Credentials`, `Unsafe Ambiguity`, and `CI Failed` stop automation.                               |

Ignore the old `Human` label in the ThinkWork workflow. Do not recreate
Human-gated behavior.

## LFG Versus Ready To Work

`Ready to Work` is implementation approval. A `Codex` issue in Ready to Work
launches one implementation pass even when `LFG` is absent.

Without `LFG`, implementation moves the issue to Verification and stops for
human review. Do not launch automated verification, repair rebounds, Done, or
compounding for non-`LFG` issues.

With `LFG`, the dispatcher may continue across review gates, implementation,
verification, repair rebounds, Done, and selective compounding unless a true
hard blocker appears.

## Status Routing

Before applying the status table, read the attached progress document named
`Progress: <feature title>`. Use the same suffix as the issue's
`Requirements: ...` and `Plan: ...` documents when those exist; otherwise use
the issue title. The progress document controls unit-level continuity: current
active work, next steps, open PRs, branch/worktree names, worker ids, blockers,
verification evidence, and cleanup state.

If the progress document is missing for an issue that is beyond `Todo`, create
it before launching workers. If it conflicts with Linear status, comments,
threads, worktrees, or PR state, do not launch a worker until the mismatch is
reconciled and recorded.

| Status                            | Behavior                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Todo`                            | If labeled `Codex`, move to `Brainstorming`, update ledger, stop.                                                                                                                         |
| `Brainstorming`                   | Create/continue a `ce-brainstorm` worker. `LFG` may proceed to Planning after merged requirements artifact; non-`LFG` stops at Requirements Review.                                       |
| `Requirements Review`             | If `LFG`, move to Planning and stop. Otherwise wait.                                                                                                                                      |
| `Planning`                        | Create/continue a `ce-plan` worker. `LFG` moves to Ready to Work after merged plan artifact; non-`LFG` stops at Plan Review.                                                              |
| `Debug`                           | Create/continue a `ce-debug` worker. Debug diagnoses; it does not implement product fixes unless the issue is explicitly in implementation/repair scope.                                  |
| `Plan Review`                     | If `LFG`, move to Ready to Work and stop. Otherwise wait.                                                                                                                                 |
| `Ready to Work` / `Ready To Work` | If `Codex` and no blockers, create/continue implementation worker. Do not require `LFG`. If `Verification Failed` is present, create/continue repair worker from verifier evidence.       |
| `In Progress`                     | Validate recorded implementation worker. If none is valid or pending, create implementation/repair worker. Move to Verification only after implementation is merged and locally verified. |
| `Verification` / `Review`         | If non-`LFG`, wait for human review. If `LFG`, create/continue verification worker.                                                                                                       |
| `Done`                            | Do not implement or verify. Run selective `ce-compound` only for recently completed `LFG` CE-driven issues not already compounded.                                                        |

## Child Issues

Linear child issues are the canonical autonomous implementation unit.

During Planning, create/update child issues when work has multiple shippable
units. Each child needs objective, scope, dependencies, verification contract,
and inherited `Codex` plus `LFG` when present on the parent.

Before launching parent implementation, inspect child issues and active child
worker threads. Do not launch parent implementation if any child issue is in an
active workflow state or if a valid child worker is active. If a Ready to Work
parent has no child issues, launch the parent implementation itself using the
plan units.

The parent moves to In Progress when the first child starts, Verification when
all children are implemented, and Done only after all children pass verification.

Parent and child issues each get their own `Progress: ...` document when they
run independently. A parent progress document tracks aggregate child state and
points to child progress documents. A child progress document controls that
child's implementation/verification loop.

## Unit Checkpoint PRs

Each implementation unit in a plan is a checkpoint boundary. Use one PR per
unit by default. Group multiple units only when the plan explicitly requires
grouping or when the units cannot be safely shipped independently.

An implementation worker must not roll silently from one unit into the next.
Before beginning the next unit, the current unit must have:

- PR opened and merged, unless the plan explicitly marks the unit as docs-only,
  investigation-only, or otherwise not requiring a PR;
- required CI/checks passing or a recorded hard blocker;
- verification evidence matching that unit's plan-owned verification contract;
- branch, worktree, and local cleanup evidence when cleanup is allowed;
- Progress document updated with shipped state, merge commit, and exact next
  unit;
- rolling ledger updated as a short pointer to the Progress document.

After this checkpoint, the next worker round starts from fresh `origin/main` and
the Progress document's `Next Steps`, not from chat memory alone.

## Verification Rebound

Verification workers are judges, not mechanics. They must not fix product code.

If validation fails because behavior is wrong, incomplete, not wired, not
buildable, or not deployable, the verifier must:

1. post exact evidence and reproduction/proof;
2. add `Verification Failed`;
3. move the issue or child back to Ready to Work;
4. preserve `Codex` and `LFG`;
5. stop.

Repair workers start from failed verification evidence and implement the
smallest correct fix. Remove `Verification Failed` only after verification
passes.

Done requires merged implementation/artifact PRs plus the proof required by the
plan-owned verification contract. If the plan requires deployed proof, local
checks alone are not enough.

## Progress Document, Ledger, And Handoff Markers

Progress document title:

```text
Progress: <feature title>
```

The progress document is the durable loop ledger. It must be updated after each
worker launch, worker round, PR open, CI failure/repair, unit PR merge,
verification verdict, blocker, and cleanup. Its `Active Work` and `Next Steps`
sections drive the next dispatcher heartbeat.

Rolling ledger marker:

```text
automation-ledger:<ISSUE_ID>
```

Worker handoff marker:

```text
dispatcher:<ISSUE_ID>:<PHASE>:Codex
```

Handoff comments must include the desired title, real returned `threadId` or
`pendingWorktreeId`, target project, worktree mode, phase, and expected stop.

The rolling ledger comment is only a short router pointer: current status,
active worker/PR/worktree, blocker summary, and a link to the progress
document. Do not use the rolling comment as the durable progress log.

Before claiming a worker is active, validate `threadId` with `read_thread`.
Stale/fake ids such as `019efa74-2e86-7ba2-b707-ca67dd44ef01` must not block
dispatch.

## Duplicate Worker Incident Handling

Duplicate implementation workers are a stop-the-line automation failure.

The dispatcher must never infer "no active worker" solely from Linear comments.
Before launching implementation, repair, verification, or compounding, it must
also search Codex threads and local worktrees for the Linear issue id, title
slug, known branch names, and known pending worktree ids.

If duplicate active workers are found:

1. do not create any new worker;
2. pause or leave the dispatcher paused when possible;
3. update the handoff comment with all thread ids, titles, worktree paths,
   branches, and PRs;
4. designate the canonical worker only when the evidence is clear, preferring an
   existing PR/CI loop over uncommitted duplicate work;
5. instruct duplicate workers to stop immediately, not commit, not push, not
   open PRs, not update Linear, and preserve their worktrees;
6. preserve duplicate worktrees for forensic/recovery review unless Eric
   explicitly authorizes deletion;
7. keep the dispatcher paused until the duplicate guard has been fixed or Eric
   explicitly re-enables it.
