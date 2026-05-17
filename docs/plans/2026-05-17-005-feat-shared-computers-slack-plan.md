---
title: "feat: Shared Computers Slack contract"
type: feat
status: active
date: 2026-05-17
origin: docs/brainstorms/2026-05-17-shared-computers-slack-requirements.md
supersedes: "Prior personal-Computer-shaped Slack invocation assumptions"
---

# feat: Shared Computers Slack contract

## Overview

Slack is an invocation surface for assigned shared Computers. It is not a personal assistant surface and it does not infer work from Computer ownership. A Slack request resolves the linked ThinkWork user, checks that user's assigned Computers, selects an explicit shared Computer target, then enqueues a task with both `computerId` and requester `userId`.

## Contract

- `/thinkwork finance <prompt>` targets Finance Computer if the linked user is assigned to it directly or through a Team.
- `@ThinkWork finance <prompt>` follows the same explicit target rule for app mentions and DMs.
- Message shortcuts and future App Home actions should present a picker when the user has multiple assigned Computers. Until the picker lands, those surfaces may only auto-route when the user has exactly one assigned Computer.
- Linked users with no assignments get assignment guidance and no task.
- Linked users naming an unassigned or unknown Computer get assigned-target guidance and no task.
- Public replies use ThinkWork branding and a footer that identifies the shared Computer plus requester, such as `Routed via @ThinkWork · Finance Computer · requested by Eric`.
- Slack thread context remains bounded to the invoked message/thread. The shared Computer does not gain ambient channel access.

## Implementation Notes

The current codebase already has Slack install, linking, signed ingress, thread mapping, task enqueueing, post-back, metrics, and dispatch. This plan narrows the routing contract so those mechanics stop depending on personal Computer ownership.

### Unit 1: Shared Computer Targeting Helper

- Add a Slack targeting helper under `packages/api/src/lib/slack/`.
- Resolve Slack user link to requester identity only.
- Load assigned Computers through direct user and Team assignments.
- Parse explicit target text from slash commands and app mentions.
- Return structured outcomes: resolved, unlinked, no assignments, missing target, unknown target, and missing prompt.
- Keep a single-assigned compatibility fallback for surfaces that do not yet have a picker, without using `owner_user_id`.

### Unit 2: Slack Handler Contract

- Update slash command routing to require `/thinkwork <computer> <prompt>`.
- Pass app mention/DM text into the targeting layer so `@ThinkWork finance ...` can resolve.
- Keep message shortcuts fail-closed unless exactly one assigned Computer is available.
- Preserve requester user id in `createdByUserId` and selected Computer id in task routing.
- Update usage and failure copy to teach shared Computer selection.

### Unit 3: Attribution and Docs

- Update Slack dispatch attribution to show shared Computer identity and requester attribution.
- Remove `<user>'s Computer` language from Slack docs and runbooks.
- Document the shared Computer Slack invocation model and data boundaries.

## Verification

- Focused API tests for targeting helper and Slack handlers.
- Focused Lambda tests for Slack dispatch attribution.
- Typecheck for API and Lambda packages.
- Docs build to catch broken links and product-language regressions.
- Grep sweep for Slack docs/code language that still teaches `<user>'s Computer` as the active model.

## Follow-Up

- Add a modal picker for ambiguous message shortcuts and app-home launches.
- Store a per-user, per-workspace default shared Computer only after users have a clear way to inspect and change it.
- Add live Slack smoke coverage for `/thinkwork finance ...` after the shared Computer assignment seed exists in dev.
