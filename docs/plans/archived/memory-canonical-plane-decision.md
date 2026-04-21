# Decision Memo: Canonical Memory Plane

## Decision

ThinkWork should adopt the following memory direction:

- **Threads in the app database remain the canonical record of work**
- **ThinkWork defines one memory adapter contract above all engines**
- **Exactly one long-term memory engine is active per deployment for canonical recall**
- **ThinkWork ships both Hindsight and AgentCore memory adapters from the beginning**
- **Hosted ThinkWork uses Hindsight by default**
- **Self-hosted/serverless-friendly deployments may choose AgentCore Memory instead**
- **The ThinkWork Memory API and Memory MCP surface resolve against normalized ThinkWork memory records from the selected canonical engine**

## Why this decision is necessary

The current story is too muddy.

Right now, ThinkWork memory is effectively spread across three overlapping layers:
- thread history in the app database
- AgentCore Memory strategies and retention behavior
- Hindsight retrieval, graph, and richer inspectability surfaces

That overlap is survivable in code for a while, but it is weak as a product story and dangerous as a platform contract.

If ThinkWork lets multiple partially overlapping memory truths coexist indefinitely, the result is predictable:
- runtime behavior becomes harder to reason about
- inspectability becomes inconsistent
- export and portability become fake
- users cannot tell what the agent actually “knows” or where it came from

## Product truth this preserves

This decision preserves the cleanest model:

- **Threads store what happened**
- **Memory stores what should carry forward**
- **Document knowledge provides reference material**
- **The harness assembles context for the next turn**

That is the model users can understand and the team can build against.

The important refinement is that ThinkWork should be open to multiple long-term memory engines, but only one should be canonical per deployment.

## Why Hindsight should be the hosted default

If ThinkWork wants a serious hosted memory story, the platform needs a memory plane that can support:
- durable memory units
- retrieval and inspection
- export/import direction
- graph/reflection direction where supported
- stable record views outside the runtime loop

Hindsight is the strongest current fit for that role in the hosted product.

That does not mean the product should be marketed as “Hindsight-powered.”
It means Hindsight should be treated as the first hosted reference implementation behind the ThinkWork memory contract, while AgentCore remains a supported alternative adapter for deployments that want a serverless-first path.

## Why AgentCore should still be supported

AgentCore Memory is still valuable.

It gives ThinkWork:
- automatic event retention
- built-in extraction strategies
- managed runtime-side capture
- a serverless-friendly deployment path for users who do not want separate memory infrastructure

That makes it worth supporting as a first-class adapter.

However, AgentCore should still sit behind the ThinkWork memory contract rather than define the product semantics directly. In hosted Hindsight-first deployments, AgentCore may temporarily remain an ingestion helper during migration, but in the target architecture it is also a valid selected engine in its own right.

## What this means for the Memory API and MCP

The Memory API and Memory MCP surface should resolve against **normalized ThinkWork memory records** from the selected canonical engine.

They should not behave like:
- “sometimes AgentCore results”
- “sometimes Hindsight rows”
- “sometimes merged backend blobs”

They should behave like:
- one ThinkWork memory contract
- one stable identity model
- one recall shape
- one inspectability model
- backend refs preserved only as metadata

## What this means for the agent runtime

Near term:
- the runtime may still use AgentCore retention and helper flows internally
- Hindsight may still be populated through explicit writes, dual-writes, or orchestrated fanout
- some hosted deployments may temporarily use AgentCore as an ingestion helper even when Hindsight is the selected recall engine

Target direction:
- the runtime should consume the same normalized recall service the Memory API exposes
- hidden backend-specific parallel memory truth should shrink over time
- one selected engine should answer canonical long-term recall per deployment

If a memory can affect the agent durably, it should be representable through the ThinkWork Memory contract.

## What this does NOT mean

- It does not mean threads stop mattering. Threads remain the canonical record.
- It does not mean document knowledge becomes memory.
- It does not mean Hindsight should leak into the product as the public contract.
- It does not mean AgentCore should be removed.
- It does not mean every feature must be implemented immediately.

## Immediate implications

1. Update PRDs and docs to reflect the cleaner role split.
2. Build the Memory API around normalized ThinkWork records, not backend-native payloads.
3. Treat Hindsight-backed memory records as the primary inspect/export surface.
4. Keep AgentCore retention, but reposition it as ingestion/extraction infrastructure.
5. Move runtime recall toward the same normalized memory service over time.

## Bottom line

ThinkWork needs one product truth for memory.

This memo makes that truth explicit:

**Threads are the record. ThinkWork owns the memory contract. One selected engine answers long-term recall. Hindsight is the hosted default, and AgentCore is a supported serverless-friendly option.**
