---
title: AgentCore Harness retirement certification must follow durable runtime evidence
date: 2026-07-19
module: packages/api
problem_type: architecture-pattern
tags:
  - agentcore
  - pi
  - runtime-routing
  - evaluations
  - memory
  - hitl
  - cutover
---

# AgentCore Harness retirement certification must follow durable runtime evidence

## Problem

A successful Harness answer is not enough evidence to retire Pi. During the
parallel proof, an AgentCore turn successfully asked a structured user question
but the answer wakeup resumed on Pi because routing re-read mutable agent
defaults. The UI still showed a normal continuation, making the cross-runtime
boundary easy to miss. Memory had a similar proof risk: model/tool text could
mention memory without establishing that the canonical retain ledger completed.

The Eval Profile also needs to pin runtime alongside model and judge. Otherwise
an evaluation label can appear comparable while executing a different harness.

## Pattern

Pin and certify execution at every asynchronous boundary:

1. The question-answer mutation reads `runtime_type` from the exact asking
   `thread_turn` and writes it into the wakeup payload.
2. The wakeup processor treats that field as authoritative for
   `question_answer`; it does not consult changed defaults.
3. Completed memory-enabled Harness turns invoke the existing canonical
   `memory-retain` pipeline with an idempotency key derived from the turn id.
4. The retirement command accepts exact `thread@turn` evidence and verifies
   canonical joins: asking question → answered card → wakeup → AgentCore resume,
   and turn → retained `brain.retain_attempts` row.
5. Eval Profiles pin `runtimeType` in their immutable snapshot so Pi and
   AgentCore comparison runs are explicit and reproducible.

Tool mentions, assistant prose, thread-level artifacts, and a settings label
are supporting evidence only. They do not replace exact turn, execution-event,
cost, participant-session, credential-owner, retain-ledger, or evaluation rows.

## Infrastructure drift lesson

The Gateway reconciler had the `ask_user_question` operation in source, but its
Terraform change trigger had not advanced. Terraform therefore reported no
work and the live target silently omitted the tool. The capability contract now
changes when the expected surface changes, and reconciliation reads the live
OpenAPI target back and fails unless every required `operationId` is present.

This is the same “declared is not deployed” failure class as a cancelled
Terraform/IAM apply. Every cutover gate must inspect live resources and execute
the user path after deployment.

Immutable endpoint publication has a second control-plane boundary: AgentCore
counts the service-managed `DEFAULT` endpoint toward the Harness endpoint
quota. Publishing a new immutable endpoint before reclaiming an older managed
endpoint can therefore fail even when the Harness version itself is ready. The
safe order is to retain the newest immutable rollback endpoint, reclaim only
older managed endpoints (including a failed publication attempt), create and
wait for the new endpoint, and only then advance the Terraform-attested SSM
profile. A failed publication must leave the prior profile and Pi selection
unchanged.

## Operational consequence

Any mixed-runtime thread is a certification failure, even if both turns
succeeded. Fixing the route does not cleanse the window: deploy the fix, prove a
new question/resume chain, and reset the entire 24-hour soak. Pi remains
provisioned and selectable until a clean window passes and rollback is
rehearsed.

See `docs/runbooks/agentcore-harness-cutover.md` for the operational sequence.
