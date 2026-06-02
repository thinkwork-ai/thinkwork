---
title: "Mobile Pi compatible host contract"
date: 2026-05-30
category: docs/solutions/architecture-patterns/
module: mobile-agent-runtime
problem_type: superseded_architecture_pattern
component: mobile
severity: historical
tags:
  - mobile
  - pi
  - agent-runtime
  - compatibility-contract
  - superseded
superseded_by: docs/plans/2026-06-02-001-refactor-agentcore-first-pi-execution-plan.md
---

# Mobile Pi Compatible Host Contract

## Superseded Status

This contract is superseded by the AgentCore-first Pi execution plan. It is kept
as historical context for the earlier Hermes-native mobile runtime work.

Current product guidance: the mobile app does not run Pi, `just-bash`, or an
agent harness loop on device. Mobile writes thread events, receives AppSync
progress, handles user review/notifications, and delegates agent execution to
AWS-managed AgentCore.

## Historical Context

The earlier contract captured a Pi-compatible mobile host shape because the
upstream Pi SDK could not be embedded in Expo/Hermes. It described extension
loading, event ordering, transcript shape, local bash, MCP proxy behavior, and
planned mobile lifecycle features.

That work helped identify the support burden of keeping mobile as a separate
runtime. The June 2026 refactor removed the local mobile harness and converged
desktop and mobile on the managed AgentCore path.

## Current Operational Guidance

- Use `apps/mobile/lib/agentcore-first-mobile.test.ts` as the guard that deleted
  local harness entrypoints stay removed.
- Add mobile work in client surfaces: chat, review, subscriptions, notifications,
  and user-scoped connection setup.
- Do not add hidden chat-screen plumbing or on-device model/tool execution.
