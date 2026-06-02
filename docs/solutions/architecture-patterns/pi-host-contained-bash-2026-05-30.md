---
title: "Pi host-contained bash"
date: 2026-05-30
category: docs/solutions/architecture-patterns/
module: pi-runtime
problem_type: superseded_architecture_pattern
component: agent-runtime
severity: historical
tags:
  - pi
  - desktop
  - mobile
  - superseded
superseded_by: docs/plans/2026-06-02-001-refactor-agentcore-first-pi-execution-plan.md
---

# Pi Host-Contained Bash

## Superseded Status

This pattern is superseded by the AgentCore-first Pi execution plan. It is kept
as historical context for the short-lived local desktop/mobile sandbox design.

Current product guidance is simpler: ThinkWork agent execution runs in
AWS-managed AgentCore isolation; desktop and mobile are clients. Do not add new
desktop-local, mobile harness, or `just-bash` execution paths from this note.

## Historical Context

The original pattern tried to expose a model-visible `bash` tool while keeping
native host access bounded. Mobile used a Hermes-compatible `just-bash` path and
Desktop Local Pi used a host-owned custom `bash` tool inside `/workspace`.

That reduced accidental native shell exposure, but it still left ThinkWork with
two execution substrates to explain, test, and support. The June 2026
AgentCore-first refactor removed those local execution paths.

## Current Operational Guidance

- Use managed AgentCore Pi for agent execution and tool isolation.
- Treat old Desktop Pi/local sidecar rows as legacy provenance only.
- If local execution is reconsidered, start a new requirements document; do not
  revive this pattern behind a hidden flag.
