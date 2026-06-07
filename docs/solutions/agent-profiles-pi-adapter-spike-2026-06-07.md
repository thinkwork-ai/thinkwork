---
title: "Agent Profiles should compile into a constrained Pi child-session adapter"
date: 2026-06-07
category: architecture-patterns
module: agentcore-pi
problem_type: architecture_decision
component: assistant
severity: high
tags:
  - agent-profiles
  - pi-subagents
  - model-stacking
  - agentcore-pi
  - mcp
---

# Agent Profiles should compile into a constrained Pi child-session adapter

## Context

The Agent Profiles plan replaces `TOOLS.md` model switching with parent-agent
delegation to focused Pi child sessions. The external `pi-subagents` package is
the right mental model, but it is intentionally broad: it exposes a generic
`subagent` tool, slash commands, chains, parallel runs, background runs, TUI
clarification, custom agent file discovery, user/project overrides, and optional
MCP adapters.

ThinkWork's managed AgentCore runtime needs a narrower enterprise contract:
profile configuration is tenant policy, model approvals are enforced by
ThinkWork, MCP calls use ThinkWork's handle-shaped auth and scrubbers, and
Activity/Traces need deterministic profile-run evidence.

## Spike Findings

- `pi-subagents@0.28.0` is MIT licensed and depends on
  `@earendil-works/pi-tui`, `jiti`, and `typebox`, with Pi packages as peers.
- The package page documents child Pi sessions, builtin agents, per-run and
  persistent model overrides, foreground timeout semantics, background status
  handling, custom markdown agent discovery, settings-level `agentOverrides`,
  and child-safety defaults such as no nested `subagent` tool unless explicitly
  granted.
- Direct package install is not the v1 production path because the generic
  control surface would expose more behavior than the managed product currently
  supports.
- ThinkWork already has the important local primitives:
  - `runAgentLoop` can open a Pi session with explicit model, tools, skills, and
    extension factories.
  - `buildMcpTools` preserves tenant/user scoped MCP credentials through opaque
    handles and applies response scrubbing.
  - `McpToolRegistry` already records discovered per-server operations after
    whitelist filtering.
  - Tool invocation records already have a persisted UI contract that Activity
    relies on.

## Decision

Implement Agent Profiles through a ThinkWork-owned adapter first:

1. Resolve tenant profile config in API/runtime config.
2. Compile the profile into a bounded child-session request.
3. Validate model and fallback model approvals before launch.
4. Reject prompt-supplied overrides for model, tools, skills, MCP, extensions,
   context, output paths, timeout, or token/cost limits.
5. Compile MCP server grants into per-operation allowlists from the existing
   registry.
6. Launch the child session through a constrained
   `delegate_to_agent_profile({ profileSlug, task })` path.
7. Return first-class `agent_profile_runs` evidence with sanitized child tool
   invocation details.

The raw generic `subagent` tool, background mode, status/resume polling, output
files, chains, parallel fanout, and nested delegation remain out of v1 managed
runtime scope.

## Current Proof

`packages/agentcore-pi/agent-container/src/agent-profile-adapter.ts` is the
U0 contract proof. It does not alter production invocation behavior yet. The
focused tests prove:

- explicit child model selection over parent composer model;
- fallback model approval;
- prompt override rejection;
- built-in tool and skill validation;
- MCP server grants compiling into operation allowlists;
- completed, timed-out, interrupted, and resource-limit profile evidence;
- child tool telemetry redaction before persistence.

## Follow-Up For U1-U4

- Keep the database/API schema aligned to the adapter fields, not raw
  `pi-subagents` frontmatter.
- Reuse ThinkWork MCP bridge by default. Adopt `pi-mcp-adapter` only after it
  proves equivalent handle auth, scrubbing, and record-shape behavior.
- If generated markdown agents are needed, write them into an isolated generated
  runtime directory and reject user/project discovered agents as policy inputs.
- When U4 launches real child sessions, use this adapter contract as the
  validation boundary and map its request into Pi session options or package
  `agentOverrides`.
