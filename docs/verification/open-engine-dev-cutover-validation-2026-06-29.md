---
title: OpenEngine dev cutover validation
date: 2026-06-29
module: open-engine
problem_type: verification
tags:
  - open-engine
  - mcp
  - work-items
  - codex
  - automation
---

# OpenEngine Dev Cutover Validation

## Summary

The dev OpenEngine cutover path now uses ThinkWork Work Items through
`/mcp/open-engine` as the runtime queue for recurring Codex automation. Linear
is no longer the runtime queue for this dogfood path; it remains outside the
one-task runner's claim and completion flow.

## Validated Runner Path

The recurring runner follows the cutover safety contract:

1. Verify `/mcp/open-engine` access, tenant scope, agent identity, and queue
   visibility before polling.
2. Fetch standing context, the routing map, and the optional skill directory
   before inspecting or claiming task work.
3. Claim exactly one eligible Work Item for the configured `codex` queue.
4. Fetch the claimed Work Item context and task documents progressively.
5. Record agent comments, receipts, and status ledger evidence on the claimed
   Work Item.
6. Transition the Work Item into one final state, then stop without claiming a
   second item.

## Safety Confirmation

Completed, reviewed, blocked, held, failed, archived, waiting, scheduled, and
actively claimed Work Items are excluded from normal pickup. That keeps the
recurring runner from repeatedly picking up a Work Item after final state and
makes the claim boundary product-owned instead of prompt-only.

The expected evidence surface for each run is:

- a readable `AGENT CLAIMED` comment and receipt,
- one or more `AGENT STATUS` ledger updates,
- task-specific verification evidence,
- and a final `AGENT DONE`, `AGENT REVIEW`, `AGENT BLOCKED`,
  `AGENT HUMAN HOLD`, or `AGENT FAILED` receipt.

For this validation slice, the implementation change is intentionally limited
to this documentation note.
