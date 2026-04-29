---
title: Context Engine adapters need operator-level verification
date: 2026-04-29
category: docs/solutions/best-practices
module: Context Engine
problem_type: best_practice
component: documentation
severity: medium
applies_when:
  - "A platform feature routes one agent tool across multiple backing providers"
  - "Provider behavior differs by source, scope, or runtime configuration"
  - "Raw provider tools remain available for diagnostics but should not be the normal user-facing path"
tags: [context-engine, admin, adapters, hindsight, workspace, mcp, verification]
---

# Context Engine adapters need operator-level verification

## Context

Context Engine started as a shared `query_context` primitive across mobile, Strands, Pi, and external MCP clients. The first implementation made the service callable, but dogfooding exposed a product and debugging gap: operators could not easily see which providers participated, why a provider returned no hits, whether Hindsight was using `recall` or `reflect`, or whether Workspace Files were scoped to the right agent.

The confusing failure mode was especially visible in mobile and agent tests. Hindsight could appear as both a raw tool and a Context Engine source, Wiki search could be conflated with memory search, and Workspace Files returned zero hits until the test passed an agent target. Provider-level status existed in the service contract, but operators needed a first-class Admin surface to exercise it.

## Guidance

Treat Context Engine as the operator-facing abstraction and show backing systems as adapters inside that abstraction.

The Admin verification surface should let an operator choose:

- participating adapters, such as Hindsight Memory, Compounding Wiki, Workspace Files, Bedrock Knowledge Bases, and approved MCP context tools;
- the agent/workspace target when a provider depends on agent scope;
- adapter-specific strategy, starting with Hindsight `recall` vs `reflect`;
- the query to execute against the same backend path used by runtimes.

The result view should show provider status beside hits. Each provider needs its own hit count, latency, skipped/degraded state, and reason. The top-hit list should make source family obvious, but the full structured result should also be inspectable for debugging.

Avoid presenting raw provider tools as normal peers when the product path is Context Engine. Raw Hindsight tools can remain available for diagnostics, but agent template and runtime configuration should guide normal memory lookup through `query_context` or split Context Engine tools such as `query_memory_context`.

Keep source-specific inspection views. Memory, Wiki, Knowledge Bases, and Workspace Files still have useful native views and operational workflows. The unifying Admin page should organize those views under Knowledge while keeping Context Engine routing configuration separate from raw source browsing.

## Why This Matters

Provider-routed search fails differently than a single index. A no-hit result might mean the provider has no data, the wrong agent target was selected, a provider was skipped by configuration, Hindsight reranking timed out, Bedrock KBs are not enabled, or the model chose a raw tool instead of the intended Context Engine tool.

Without provider-local verification, teams tend to debug at the wrong layer. In this session, the same user-facing query returned Hindsight and Wiki hits while Workspace Files returned zero hits until the Admin test harness passed Marco's agent id. Once scoped correctly, Workspace Files found `USER.md` and reported the searched file count.

Session history also reinforced two boundaries:

- Mobile Wiki search had already been fixed to use compiled-wiki FTS rather than Hindsight semantic recall. Do not replace that dedicated fast path with Context Engine unless a true mobile Context Search product is being built. (session history)
- Pi initially fetched memory through raw `hindsight_reflect` instead of the split Context Engine memory tool. Tool descriptions and runtime registration should bias normal memory lookup toward `query_memory_context`, leaving raw Hindsight for diagnostics. (session history)

## When to Apply

- When adding a new Context Engine provider.
- When changing provider selection, provider options, or runtime tool injection.
- When debugging no-hit, slow-hit, wrong-provider, or wrong-tool behavior.
- When designing Admin UI for source systems that are both inspectable directly and routable through Context Engine.

## Examples

Good operator test harness:

```text
Test query
Adapters: Hindsight Memory, Compounding Wiki, Workspace Files
Agent target: Marco
Hindsight strategy: reflect
Query: favorite restaurant in Paris

Provider status:
- Hindsight Memory: ok, 1 hit, 4.3s
- Compounding Wiki: ok, 3 hits, 38ms
- Workspace Files: ok, 1 hit, searched 24/26 files in agent workspace
```

Poor operator test harness:

```text
Query: favorite restaurant in Paris
Result: 4 hits
```

The poor version hides whether Workspace Files participated, whether Hindsight used `recall` or `reflect`, and whether a zero-hit provider was actually searched.

Good agent/template presentation:

```text
Built-in tool: Context Engine
Enabled adapters: Hindsight Memory, Wiki, Workspace Files
Hindsight strategy: reflect
```

Poor agent/template presentation:

```text
Built-in tools:
- Context Engine
- Hindsight
- Wiki
```

The poor version makes adapters look like competing peer tools and increases the chance that the model calls raw Hindsight when the desired behavior is provider-routed Context Engine lookup.

## Related

- [Context Engine API docs](../../src/content/docs/api/context-engine.mdx)
- [Admin Knowledge docs](../../src/content/docs/applications/admin/knowledge.mdx)
- [Context Engine requirements](../../brainstorms/2026-04-28-context-engine-requirements.md)
- [Admin Knowledge Center plan](../../plans/2026-04-29-001-feat-admin-memory-knowledge-center-plan.md)
- [Mobile wiki search TSV tokenization](../logic-errors/mobile-wiki-search-tsv-tokenization-2026-04-27.md)
