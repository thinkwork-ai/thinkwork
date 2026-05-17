---
title: "Shared Computers Slack invocation requirements"
type: brainstorm
status: accepted
date: 2026-05-17
origin: docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md
---

# Shared Computers Slack invocation requirements

## Problem

The first Slack workspace app proved the mechanics: workspace install, user linking, signed ingress, task enqueueing, and post-back. It still carried a personal-Computer shape in several user-facing seams: Slack users linked to one Computer through ownership, slash commands did not name a target, and attribution taught users to expect `<user>'s Computer`.

Shared Computers need a different Slack contract. Slack should be a front door to assigned managed Computers such as Finance Computer, Sales Computer, or Admin Computer. The invoking Slack user supplies requester identity, credentials, and personal memory context for that request; the selected Computer remains the shared capability that acts.

## Actors

- A1. Slack requester: a linked ThinkWork user invoking a Computer from Slack.
- A2. Shared Computer: an assigned tenant-managed capability.
- A3. Tenant operator: installs Slack and assigns Computers to users or Teams.
- A4. Slack participant: reads public replies and needs clear attribution.
- A5. Runtime/audit layer: records selected Computer and requester as separate identities.

## Requirements

- R1. Slack task routing must target an assigned shared Computer, not a personal or owner-derived Computer.
- R2. A linked Slack user with no assigned Computers must fail closed with assignment guidance.
- R3. A linked Slack user with multiple assigned Computers must select or name the target before work is enqueued.
- R4. `/thinkwork <computer> <prompt>` must resolve the Computer by assigned slug/name shorthand, such as `finance` for Finance Computer.
- R5. Ambiguous invocations must return guidance or a picker instead of guessing.
- R6. Message shortcuts and App Home flows may use a picker of assigned Computers; until a picker is implemented, they may proceed only when the requester has exactly one assigned Computer.
- R7. Slack app mentions and DMs must accept explicit target text such as `@ThinkWork finance summarize this`.
- R8. Every Slack task must carry selected Computer id and requester user id as separate fields.
- R9. Public Slack replies must identify the shared Computer and requester, for example `Finance Computer · requested by Eric`.
- R10. Slack thread context must be limited to the invoked message/thread and must not grant ambient channel reading.
- R11. Slack user linking is identity binding only; it must not bind a Slack user to a personal Computer.
- R12. Requester memory and personal OAuth credentials must resolve from the requester user, never from the Computer owner.

## Acceptance Examples

- AE1. Given Eric is assigned Finance Computer and Sales Computer, when he runs `/thinkwork finance analyze Q3`, then Slack enqueues work for Finance Computer with Eric as requester.
- AE2. Given Eric is linked but not assigned to any Computer, when he runs `/thinkwork finance analyze Q3`, then no task is created and Slack tells him to ask an admin for access.
- AE3. Given Eric is assigned Finance Computer but not Admin Computer, when he runs `/thinkwork admin export users`, then no task is created and Slack lists assigned alternatives.
- AE4. Given Eric uses a message shortcut and has exactly one assigned Computer, when he invokes ThinkWork, then the task routes to that shared Computer with Eric as requester.
- AE5. Given Eric invokes Finance Computer in a public thread, when the answer posts, then the footer identifies Finance Computer and says Eric requested it.
- AE6. Given a Slack thread has unrelated channel history, when ThinkWork receives an invocation, then the task includes only the explicitly invoked thread/message context.

## Non-Goals

- Automatic Computer selection across all assigned Computers.
- Reintroducing personal Computers as a fallback for Slack.
- Passive ingestion of whole-channel history.
- Slack Connect or external shared-channel semantics.
