---
title: "Mobile Pi background handoff"
date: 2026-05-31
category: docs/solutions/architecture-patterns/
module: mobile-agent-runtime
problem_type: superseded_architecture_pattern
component: mobile
severity: historical
tags:
  - mobile
  - pi
  - background
  - superseded
superseded_by: docs/plans/2026-06-02-001-refactor-agentcore-first-pi-execution-plan.md
---

# Mobile Pi Background Handoff

## Superseded Status

This background handoff design is superseded. Mobile no longer starts a local Pi
turn that AgentCore later claims after a stale heartbeat. The mobile app now
submits thread work to the API and the agent turn runs in AWS-managed AgentCore
from the start.

## Historical Context

The original design attempted to keep one logical turn visible while iOS could
suspend a local Hermes host. It introduced a durable turn lease, checkpoints,
heartbeats, a stall monitor claim path, and managed fallback finalization.

That reduced duplicate-answer risk, but it still kept mobile as its own agent
runtime. The June 2026 AgentCore-first refactor removed the local mobile harness
and made mobile a client for managed execution.

## Current Operational Guidance

- Validate mobile managed turns through thread creation, AppSync progress, and
  AgentCore finalization.
- Do not revive local heartbeat/checkpoint ownership for mobile agent execution.
- Treat any old handoff rows as historical provenance only.
