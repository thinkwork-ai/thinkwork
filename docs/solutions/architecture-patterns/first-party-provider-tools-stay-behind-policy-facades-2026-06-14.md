---
title: First-party provider tools should stay behind policy facades
date: 2026-06-14
category: docs/solutions/architecture-patterns
module: Context Engine / AgentCore Pi
problem_type: architecture_pattern
component: assistant
severity: medium
applies_when:
  - "A provider-backed capability becomes visible as a first-party agent tool"
  - "A premium substrate has raw infrastructure, storage, or admin APIs behind it"
  - "A model needs a clearer affordance than a generic multi-provider query tool"
  - "Initial retrieval can flood the model unless details are expanded deliberately"
tags:
  [
    context-engine,
    agentcore-pi,
    company-brain,
    mcp,
    policy-facade,
    tool-surface,
    progressive-disclosure,
  ]
---

# First-party provider tools should stay behind policy facades

## Context

THNK-23 exposed Company Brain to first-party Pi agents as a dedicated
`query_brain_context` tool. The tempting shortcut would have been to register a
raw Brain MCP server, couple runtime tool registration directly to Company Brain
plugin install state, or teach models to keep using generic `query_context`
provider filters.

The durable learning is the boundary that made the feature small and safe:
Company Brain became a model-visible first-party affordance, but the transport
remained the existing Context Engine policy facade. Pi registers and describes
the tool; `/mcp/context-engine` still owns provider selection, tenant policy,
provider-local status, provenance, and raw backend isolation.

Search mode was used for this compound pass. Related evidence came from Linear
THNK-23, PR #2468, the THNK-23 plan/status docs, Context Engine docs, related
THNK-6/THNK-20 planning, and existing solution docs on Context Engine adapter
verification and runtime tool parity.

The final deployed-agent verification also mattered. An earlier smoke only
proved the live Pi agent could call `query_brain_context`; the provider was
skipped because Company Brain was not installed for that tenant, so it did not
prove real Brain retrieval. The accepted smoke was `CHAT-1119`: the deployed Pi
agent called `query_brain_context`, the persisted result reported
`Company Brain: ok (1 hits, 111ms)`, the hit id was
`brain:entity:commitment:harlow-food-stores-onboarding-commitment`, and the
assistant displayed the Brain summary for the Harlow Food Stores onboarding
commitment.

## Guidance

When adding a provider-specific first-party agent tool, split the design into
three contracts:

1. **Model affordance:** expose the smallest tool name and schema that helps the
   model choose correctly. For THNK-23, `query_brain_context` made Company Brain
   discoverable for governed tenant-shared business/domain context without
   requiring the model to know provider-family filters.
2. **Policy transport:** keep the call routed through the established facade.
   For Company Brain, Pi forwards JSON-RPC `tools/call` to `/mcp/context-engine`
   with `params.name = "query_brain_context"`. It does not call Cognee,
   Neptune, S3, ontology admin APIs, or Brain storage directly.
3. **Provider eligibility:** let install/provisioning make the provider eligible
   behind the facade, not create a raw runtime transport. Company Brain plugin
   state affects whether the Brain provider can answer; existing
   `context_engine_enabled` runtime policy still controls whether Pi registers
   Context Engine tools.

For source-heavy providers, prefer progressive disclosure over dumping every
retrieved snippet into the first tool result. THNK-23 made initial Brain calls
return a concise indexed shortlist with stable ids/indexes, provenance/status
hints, and guidance for same-tool detail expansion. Follow-up calls replay the
query with selected `detailIds` or `detailIndexes` and expand only those hits.

Keep the verification matrix aligned with the boundary:

- facade/API tests prove provider-specific formatting, selector handling,
  provider status, and no raw backend leakage;
- extension tests prove model-visible registration, schema, validation, and
  JSON-RPC forwarding shape;
- runtime tests prove the tool appears in the first-party allowlist only when
  the existing runtime capability is enabled;
- deployed-agent smoke proves the model-visible tool returns real provider
  results, not only successful invocation metadata or provider-skipped
  diagnostics;
- docs explain tool selection and backend boundaries in the same PR.

## Why This Matters

Provider-specific first-party tools are useful because models choose from tool
names and descriptions, not architecture diagrams. But each new visible tool can
also become a second access path that bypasses policy, audit, provenance, and
operator diagnostics.

Keeping the provider behind the facade gives the model a sharper affordance
without widening the trust boundary. It also keeps failures legible: disabled
providers, missing capabilities, degraded substrate state, and no-hit results
remain provider-local statuses rather than auth bypasses or silent fallback to a
different source.

Progressive disclosure matters for the same reason. A raw source dump looks
helpful until it crowds out the model's reasoning context or teaches the model
to treat untrusted source material as instructions. A shortlist/detail pattern
lets the model inspect relevance first and request only the evidence it needs.

## When to Apply

- When a provider-specific name would materially improve model tool choice.
- When the provider has raw infrastructure or admin APIs that should remain
  internal.
- When plugin entitlement/provisioning should influence provider availability
  without directly registering runtime tools.
- When retrieved source content is large, untrusted, or better consumed through
  shortlist then selected-detail expansion.
- When adding a split tool beside a generic facade tool such as
  `query_context`.

## Examples

Good first-party provider exposure:

```text
Pi tool: query_brain_context
Forwarding: /mcp/context-engine tools/call name=query_brain_context
Provider boundary: Context Engine selects the brain family and reports statuses
Install coupling: Company Brain install makes Brain eligible behind Context Engine
Result shape: shortlist first, selected details by detailIds/detailIndexes
Live proof: CHAT-1119 returned Company Brain ok, 1 hit, 111ms
```

Poor first-party provider exposure:

```text
Pi tools:
- query_brain_context
- raw_cognee_search
- neptune_graph_query
- s3_brain_artifact_read

Plugin install directly registers all of them in the runtime.
The initial query returns every matching snippet body.
Verification stops after confirming the tool was invoked, even though the
provider returned only skipped/no-result diagnostics.
```

The poor version gives the model more knobs but less safety. It bypasses the
policy facade, exposes implementation details as product concepts, and makes it
harder to preserve provenance and provider-local diagnostics.

## Related

- [THNK-23 plan](../../plans/2026-06-14-005-feat-company-brain-first-party-tool-plan.md)
- [THNK-23 autopilot status](../../plans/autopilot/THNK-23-status.md)
- [Context Engine API docs](../../src/content/docs/api/context-engine.mdx)
- [Context Engine Company Brain reads plan](../../plans/2026-06-14-002-feat-context-engine-brain-reads-plan.md)
- [Context Engine adapters need operator-level verification](../best-practices/context-engine-adapters-operator-verification-2026-04-29.md)
- [Swapping agent runtimes requires a tool-parity audit and a shared tool-record contract](./runtime-swap-tool-parity-and-record-contract.md)
- [PR #2468: expose Company Brain context tool](https://github.com/thinkwork-ai/thinkwork/pull/2468)
