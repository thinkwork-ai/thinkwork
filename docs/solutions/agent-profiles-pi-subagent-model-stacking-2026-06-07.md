---
title: "Agent Profiles are the model-stacking boundary"
date: 2026-06-07
status: active
category: architecture-patterns
module: agentcore-pi
problem_type: architecture_decision
component: assistant
severity: high
supersedes:
  - docs/solutions/model-stacking-tools-md-routing-2026-06-06.md
tags:
  - agent-profiles
  - pi-subagents
  - model-stacking
  - activity
  - traces
---

# Agent Profiles are the model-stacking boundary

## Context

The first model-stacking design routed individual tools through different
models. That was the wrong product boundary. A raw tool or MCP operation is an
implementation detail inside a Pi agent loop; it is not a separately assigned
worker with its own model, scope, time budget, cost story, and handoff.

ThinkWork now models stacking through **Agent Profiles**. A parent turn keeps
the composer-selected model. When the parent needs a specialized subtask, it
delegates to a profile such as Research, Coding, or Analyst. That profile runs
as a bounded Pi child session inside the same AgentCore turn, with its own
model, instructions, tool/MCP/skill access, and execution limits. The child
returns a concise handoff summary to the parent, and ThinkWork persists
first-class profile evidence.

## Decision

Use Agent Profiles as the supported customer-facing model-stacking primitive:

- parent model: selected in the composer or default Agent settings;
- profile model: configured on the Agent Profile;
- profile availability: global by default, optionally restricted to Spaces;
- capability bundle: profile-owned tools, MCP servers, skills, context, and
  execution controls;
- execution: foreground Pi child session through ThinkWork's constrained
  `delegate_to_agent_profile` adapter;
- observability: `agent_profile_runs` in turn usage, `pi_agent_profile` cost
  rows, nested Activity steps, and `profile:<slug>` Trace lanes.

The raw generic `subagent` tool, background child runs, profile chaining,
output files, and separate AgentCore instances remain deferred.

## Evidence Contract

A successful delegated profile run should provide these records:

- runtime response: `agent_profile_runs[]` with `profileSlug`, `profileName`,
  `model`, `status`, token counts, duration, cost when available,
  `handoffSummary`, child `toolInvocations`, and `laneKey`;
- finalize persistence: `thread_turns.usage_json.agent_profile_runs`;
- cost accounting: a profile LLM cost row with `source = "pi_agent_profile"`,
  `parent_request_id`, `profile_run_id`, `profile_slug`, `profile_name`, and
  `lane_key`;
- Activity UI: nested profile row showing profile name, model, tokens, cost,
  duration, status, and expandable handoff/child tools;
- Trace UI: parent lane plus profile lane, using explicit `laneKey` metadata
  rather than prompt heuristics.

Raw child tools such as `web_search`, `web_extract`, or MCP operations remain
inspectable under the profile run, but they are not the model-stacking unit.

## Demo Path

Use the runbook in `docs/verification/agent-profiles-e2e.md`:

1. Configure Research with a cheaper approved model.
2. Ask the parent agent a research task or use `/agent research <task>`.
3. Confirm the parent delegates to Research and summarizes its handoff.
4. Confirm Settings -> Activity shows a nested Research profile cost.
5. Confirm Traces show a `profile:research` lane.
6. Confirm raw `web_search` / `web_extract` child calls remain inspectable
   under Research.

## Guardrails

- Do not revive `TOOLS.md` as the model-stacking surface.
- Do not expose raw `pi-subagents` package behavior directly in managed
  runtime.
- Do not let prompt text override profile model, tools, MCP, skills, output
  paths, runtime limits, or token/cost limits.
- Do not double-count parent and profile costs; keep parent LLM, profile child
  LLM, and external tool costs as separate rows with clear metadata.
- Do not persist credentials or bearer tokens in profile tool metadata.
