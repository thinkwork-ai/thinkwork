---
title: "Mobile Pi compatible host contract"
date: 2026-05-30
category: docs/solutions/architecture-patterns/
module: mobile-agent-runtime
problem_type: architecture_pattern
component: mobile
severity: medium
tags:
  - mobile
  - pi
  - agent-runtime
  - compatibility-contract
  - extensions
---

# Mobile Pi Compatible Host Contract

## Context

ThinkWork mobile cannot run the upstream Pi SDK on iOS today. The durable reason
is recorded in
`docs/solutions/spikes/2026-05-29-mobile-embedded-node-pi-spike.md`: the
upstream SDK load path requires Node >=22.19 and currently pulls native Node
addons that are not viable inside the Expo/Hermes iOS app.

That does not mean mobile should become a separate agent architecture. The right
near-term pattern is a **Pi-compatible host**: keep the public shape, events,
tool transcript, extension model, and workspace philosophy close enough that
desktop, AgentCore, and mobile can share platform capabilities without semantic
drift.

## Pattern

Put the mobile compatibility surface in a code artifact, not only in prose.

The U1 contract lives in:

`apps/mobile/lib/agent/compat/pi-contract.ts`

It records:

- The mobile host identity (`thinkwork-mobile-hermes`).
- The explicit upstream SDK embedding boundary.
- The session, tool, model-provider, and extension API shape mobile commits to.
- The event and transcript golden sequence for a model-tool-model turn.
- Which Pi-compatible features are implemented now.
- Which features are deferred to later implementation units.

The contract tests live beside it:

`apps/mobile/lib/agent/compat/pi-contract.test.ts`

Those tests do two jobs:

- Lock in behavior that exists today: extension loading, prompt-hook chaining,
  tool event order, transcript shape, and pre-model abort.
- Keep planned gaps explicit: shared extension adapter, shared system prompt,
  workspace-backed built-ins, bounded MCP, full lifecycle dispatch, durable
  session transcript, compaction, and follow-up/steering.

## Guidance

When adding mobile agent capabilities, first decide whether the capability is:

- **Portable ThinkWork extension behavior.** Put it in `packages/pi-extensions`
  and load it through a mobile adapter.
- **Mobile host behavior.** Keep it in `apps/mobile/lib/agent`, but model it as
  an extension or provider so it remains visible to the loop and testable
  through the contract.
- **Upstream Pi SDK behavior that mobile cannot support yet.** Mark it
  `deferred` or `out_of_scope` in the contract with an owner unit or revisit
  condition.

Do not add hidden chat-screen plumbing for agent powers. If the model can use a
capability, the capability should have a tool or extension shape, activity
events, and contract coverage.

## Why This Matters

Mobile already has a real Hermes-native loop, Bedrock provider, MCP proxy path,
local bash, workspace context, image input, and thread persistence. Without a
contract, the easy path is to keep adding mobile-only behavior until it no
longer matches Desktop Local Pi or AgentCore Pi.

The contract gives later units a stable baseline:

- U2 adapts shared `ThinkworkExtension` definitions into mobile.
- U3 aligns system-prompt and workspace context composition.
- U4 and U5 make workspace-backed built-ins and bash real.
- U6 bounds MCP behind an `mcp` proxy tool.
- U7 fills lifecycle dispatch, durable transcript, abort/follow-up/steering, and
  compaction.
- U8 models mobile-native capabilities as extensions.

## Verification

Use the focused contract suite when touching mobile agent runtime surfaces:

```bash
pnpm --filter @thinkwork/mobile test -- lib/agent/compat/pi-contract.test.ts
```

Use the broader U1 verification before merging contract changes:

```bash
pnpm --filter @thinkwork/mobile test -- lib/agent/compat/pi-contract.test.ts lib/agent/session.test.ts lib/agent/loop.test.ts
```
