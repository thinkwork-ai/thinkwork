---
title: Activation runtime narrow tool surface and privacy invariant
date: 2026-04-26
category: docs/solutions/best-practices/
module: agentcore-activation
problem_type: best_practice
component: agent_runtime
severity: medium
applies_when:
  - Building a focused agent runtime whose job is narrower than the full Strands harness
  - Tool output can route user-private material to multiple storage targets
  - A privacy invariant must hold even if the model asks for the wrong target
tags: [activation, agent-runtime, privacy, narrow-tools, expected-tools]
---

# Activation runtime narrow tool surface and privacy invariant

The Activation Agent should not inherit the full chat runtime's tool belt. Its job is a focused operating-model interview, so the runtime uses an explicit five-tool allowlist:

- `propose_layer_summary`
- `mark_layer_complete`
- `propose_bundle_entry`
- `read_prior_layer`
- `dismiss_recommendation`

`server.py` asserts that this exact set is registered at boot. If a Docker COPY change, refactor, or dependency issue drops a tool, the container fails loudly instead of silently running with partial capability.

The friction layer has a special privacy invariant: friction entries can seed user-private memory, but never wiki. Enforce that invariant twice:

- Tool layer: `propose_bundle_entry(layer="friction", target="wiki", ...)` raises immediately.
- Resolver layer: `applyActivationBundle` rejects any friction approval targeting wiki before inserting outbox rows.

This defense-in-depth matters because the model prompt, UI, and resolver all evolve independently. The runtime should guide the model toward the right target, but the durable write path must still refuse the wrong one.
