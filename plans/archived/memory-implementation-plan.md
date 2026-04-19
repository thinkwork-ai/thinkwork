# PRD: Memory Implementation Plan

**Status:** Draft
**Owner:** Eric Odom
**Last updated:** 2026-04-13
**Depends on:**
- `.prds/harness-owned-memory-positioning.md`
- `.prds/memory-contract-and-runtime.md`
- `.prds/memory-api-and-mcp.md`
- `.prds/memory-canonical-plane-decision.md`

---

## 1. Summary

This PRD turns ThinkWork's memory direction into a concrete implementation plan.

The core implementation decision is:

- **Threads DB remains the canonical record of work and the source of short-term/session context**
- **ThinkWork defines one memory adapter contract above all engines**
- **Exactly one long-term memory engine is active per deployment for canonical recall**
- **ThinkWork ships both Hindsight and AgentCore memory adapters from the beginning**
- **Hosted ThinkWork uses Hindsight by default**
- **Self-hosted/serverless-friendly users may choose AgentCore Memory instead**

That gives ThinkWork:
- a clean product truth,
- a stable Memory API / MCP surface,
- a real open memory engine story,
- and a practical migration path away from the current overlap.

---

## 2. Problem

The current memory implementation is too muddy.

Today, ThinkWork memory behavior is spread across:
- thread history in Aurora,
- AgentCore auto-retention and strategy extraction,
- Hindsight recall and richer inspectability,
- duplicated explicit memory tools,
- and partially overlapping runtime paths.

This creates predictable problems:
- duplicate writes,
- unclear recall source of truth,
- hard-to-explain inspectability,
- weak portability,
- and too much backend leakage into product semantics.

The fix is not "pick one vendor forever."
The fix is:

**ThinkWork owns the contract. Engines implement it. One engine is active per deployment for canonical long-term recall.**

---

## 3. Goals

- Define the memory adapter contract ThinkWork owns.
- Ship both Hindsight and AgentCore memory adapters from the start.
- Make engine selection explicit and deployment-level.
- Keep short-term/session context on the thread DB path.
- Introduce normalized memory record types.
- Build a single recall service that returns those normalized records.
- Point API, export, admin inspectability, and later runtime recall at that same service.
- Provide a clean migration path from the current AgentCore/Hindsight overlap.

---

## 4. Non-goals

- Do not support multiple long-term engines as equal simultaneous recall sources in steady state.
- Do not make the thread DB itself the long-term memory engine.
- Do not expose raw backend payloads as the public memory contract.
- Do not build every possible memory engine immediately.
- Do not solve graph/reflection/import parity across engines in v1.

---

## 5. Product truth to preserve

ThinkWork should keep this model clean:

- **Threads store what happened**
- **Memory stores what should carry forward**
- **Document knowledge provides reference material**
- **The harness assembles context for the next turn**

That means:
- thread DB is the short-term/session source,
- the selected memory engine is the long-term memory plane,
- and ThinkWork owns the contract above both.

---

## 6. Target architecture

```txt
Aurora thread store
  - canonical work record
  - recent/session context
  - provenance source

ThinkWork Memory Layer
  - adapter contract
  - normalized types
  - retain / recall / inspect / export semantics
  - engine selection
  - Memory API / MCP surface

Selected long-term memory engine
  - hindsight adapter
  - agentcore adapter
  - future adapters (graphiti, cognee, etc.)
```

Key rule:

**Thread history is always read from the thread store. Long-term memory is always read from the selected engine through the ThinkWork adapter contract.**

---

## 7. Engine selection model

## 7.1 Deployment-level selection

Exactly one long-term memory engine should be active for canonical recall per deployment.

Initial supported values:
- `hindsight`
- `agentcore`

Future values:
- `graphiti`
- `cognee`
- others

## 7.2 Product defaults

- **Hosted ThinkWork:** default to `hindsight`
- **Self-hosted / serverless-friendly deployments:** may choose `agentcore`

## 7.3 Configuration shape

Suggested config:

```ts
type MemoryEngineType = "hindsight" | "agentcore"

type MemoryConfig = {
  enabled: boolean
  engine: MemoryEngineType
  sessionSource: "thread_db"
  apiEnabled: boolean
  mcpEnabled: boolean
  recall: {
    defaultLimit: number
    tokenBudget: number
  }
  retain: {
    autoRetainTurns: boolean
    explicitRememberEnabled: boolean
  }
  inspect: {
    graphEnabled: boolean
    exportEnabled: boolean
  }
}
```

Important rule:
- `sessionSource` should remain `thread_db` in v1
- do not let long-term engines masquerade as the short-term history source

---

## 8. Memory adapter interface

ThinkWork should define one adapter interface implemented by each engine.

Suggested shape:

```ts
type MemoryOwnerRef = {
  tenantId: string
  ownerType: "agent"
  ownerId: string
  threadId?: string
}

type RecallRequest = MemoryOwnerRef & {
  query: string
  limit?: number
  tokenBudget?: number
  strategies?: string[]
}

type RetainRequest = MemoryOwnerRef & {
  sourceType: "thread_turn" | "explicit_remember" | "connector_event" | "system_reflection" | "import"
  content: string
  role?: "user" | "assistant" | "system"
  metadata?: Record<string, unknown>
}

type InspectRequest = MemoryOwnerRef & {
  kinds?: string[]
  cursor?: string
  limit?: number
}

type ExportRequest = MemoryOwnerRef & {
  includeArchived?: boolean
}

type MemoryAdapter = {
  kind: "hindsight" | "agentcore" | string
  capabilities(): Promise<MemoryCapabilities>
  retain(request: RetainRequest): Promise<RetainResult>
  recall(request: RecallRequest): Promise<RecallResult[]>
  inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]>
  export(request: ExportRequest): Promise<MemoryExportBundle>
}
```

Optional later methods:
- `reflect`
- `compact`
- `forget` / archive / delete
- graph-specific inspection

---

## 9. Normalized types

## 9.1 Core record

```ts
type ThinkWorkMemoryRecord = {
  id: string
  tenantId: string
  ownerType: "agent"
  ownerId: string
  threadId?: string
  kind: "event" | "unit" | "reflection"
  sourceType: "thread_turn" | "explicit_remember" | "connector_event" | "system_reflection" | "import"
  strategy?: "semantic" | "preferences" | "summaries" | "episodes" | "graph" | "custom"
  status: "active" | "archived" | "deleted" | "superseded"
  content: {
    text: string
    summary?: string
  }
  provenance?: {
    threadMessageIds?: string[]
    turnIds?: string[]
    sourceEventIds?: string[]
  }
  backendRefs: Array<{
    backend: "hindsight" | "agentcore" | string
    ref: string
  }>
  createdAt: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}
```

## 9.2 Recall result

```ts
type RecallResult = {
  record: ThinkWorkMemoryRecord
  score: number
  whyRecalled?: string
  backend: string
}
```

## 9.3 Capabilities

```ts
type MemoryCapabilities = {
  retain: boolean
  recall: boolean
  inspectRecords: boolean
  inspectGraph: boolean
  export: boolean
  reflect: boolean
  compact: boolean
}
```

## 9.4 Export bundle

```ts
type MemoryExportBundle = {
  version: "v1"
  exportedAt: string
  engine: string
  owner: MemoryOwnerRef
  capabilities: MemoryCapabilities
  records: ThinkWorkMemoryRecord[]
}
```

Important rule:

**These are ThinkWork types, not backend-native types.**

---

## 10. Single recall service

ThinkWork should build one recall service used by all top-level consumers.

Suggested API:

```ts
type NormalizedRecallService = {
  recall(request: RecallRequest): Promise<RecallResult[]>
}
```

Responsibilities:
- resolve configured engine
- call the selected adapter
- normalize results into ThinkWork types
- enforce default limits / token budgets
- return one stable recall shape

This service becomes the canonical read path for:
- Memory API
- Memory MCP tools
- admin inspectability helpers
- export generation
- later runtime memory injection

It should not merge multiple engines in steady state.

---

## 11. Runtime context assembly direction

## 11.1 Short-term/session context

Keep this on the thread DB path.

Current reality already supports this:
- API handler loads recent thread messages from Aurora
- runtime passes them to Strands as `messages_history`

This should remain the default session-history path.

## 11.2 Long-term memory injection

The runtime should gradually move toward:
- calling the normalized recall service
- receiving normalized recall results
- formatting those into a bounded memory context block for the turn

That means long-term recall is no longer runtime-backend-specific.

## 11.3 Final steady-state rule

```txt
Short-term context -> Aurora thread messages
Long-term carry-forward -> selected memory engine through ThinkWork recall service
```

---

## 12. Adapter responsibilities

## 12.1 Hindsight adapter

Responsibilities:
- map ThinkWork owner refs to Hindsight bank/entity concepts
- normalize Hindsight memory units into ThinkWork records
- provide canonical recall / inspect / export behavior in hosted product
- support graph/reflection capabilities when available

Hosted default because:
- richer long-term memory plane
- stronger inspectability story
- better fit for future graph/reflection direction

## 12.2 AgentCore adapter

Responsibilities:
- map ThinkWork owner refs to AgentCore namespaces / actor/session IDs
- retain turns or explicit facts using AgentCore-supported APIs
- normalize extracted records into ThinkWork records
- support a serverless-first option for users who do not want Hindsight infra

Important constraint:
- AgentCore adapter may have weaker inspect/export/graph parity than Hindsight
- that must be surfaced through capabilities, not hidden

---

## 13. Migration notes for current overlap

Current overlap to clean up:
- thread history in Aurora
- AgentCore auto-retain after response
- Hindsight-backed `search_memories()` recall
- explicit `remember()` dual-writing AgentCore + Hindsight
- explicit `recall()` mixing backend paths

## 13.1 Migration principle

During migration, dual-write is acceptable.
Dual-read is not acceptable as a permanent product behavior.

So:
- temporary dual-write for safety or backfill is fine
- canonical recall path must still resolve through one selected engine

## 13.2 Migration phases

### Phase 1: Introduce contract and config
- add engine selection config
- add normalized types
- add adapter interface
- implement Hindsight adapter
- implement AgentCore adapter

### Phase 2: Introduce single recall service
- build normalized recall service
- point Memory API at it
- point admin inspectability at it
- point export at it

### Phase 3: Clarify explicit memory tools
- make `remember()` route through ThinkWork memory layer, not backend-specific custom logic
- make `recall()` route through normalized recall service
- stop duplicating backend recall behavior in tool code

### Phase 4: Runtime alignment
- keep thread history from Aurora
- replace backend-specific implicit recall path with normalized recall service
- make runtime memory injection use ThinkWork-formatted recall results

### Phase 5: Reduce overlap
- remove or isolate duplicate direct backend writes where no longer needed
- keep AgentCore auto-retain only if it materially helps the selected adapter path
- stop presenting overlapping backend truths to users/admins

## 13.3 Transitional rules

Until migration is complete:
- thread history still comes from Aurora
- Hindsight and AgentCore adapters may both exist in code
- only the configured engine should answer canonical recall requests
- admin/API/MCP should not expose merged backend-native payloads

---

## 14. API and MCP implications

The implementation plan assumes:
- Memory API sits above the recall service
- MCP sits above the Memory API or same normalized service layer

That means both surfaces automatically inherit:
- engine selection
- normalized records
- stable IDs
- capability reporting

They must not branch on backend-native response shapes.

---

## 15. Suggested file/module shape

Potential new modules:

```txt
packages/api/src/lib/memory/
  config.ts
  types.ts
  recall-service.ts
  adapter.ts
  adapters/
    hindsight-adapter.ts
    agentcore-adapter.ts
  export-service.ts
  inspect-service.ts
```

Potential runtime alignment areas:

```txt
packages/agentcore/agent-container/memory.py
packages/agentcore-strands/agent-container/memory_tools.py
packages/agentcore-strands/agent-container/server.py
packages/api/src/handlers/chat-agent-invoke.ts
```

---

## 16. Acceptance criteria

This plan is successful when:

1. ThinkWork can be configured with either `hindsight` or `agentcore` as the active long-term memory engine.
2. Thread/session context still comes from Aurora thread history.
3. There is one normalized `ThinkWorkMemoryRecord` type.
4. There is one recall service that returns normalized recall results.
5. Memory API and admin/export surfaces use that recall layer.
6. MCP uses that same normalized memory layer.
7. Runtime long-term recall can begin migrating toward that same service.
8. Users do not see multiple overlapping backend truths.

---

## 17. Open questions

- Should engine selection be tenant-level, deployment-level, or both? Recommendation: deployment-level first, tenant-level later only if necessary.
- Should AgentCore adapter inspect/export be intentionally limited in v1 if the underlying APIs are weaker? Recommendation: yes, expose capability differences honestly.
- Should we support temporary dual-write from runtime to both engines during migration? Recommendation: yes, but only with one canonical read engine.
- Should Hindsight graph features appear in UI only when engine=`hindsight` and `inspectGraph=true`? Recommendation: yes.

---

## 18. Bottom line

ThinkWork should not try to make two first-class long-term memory truths coexist.

It should:
- keep thread history in Aurora,
- ship both Hindsight and AgentCore adapters,
- select exactly one active long-term engine per deployment,
- and make the ThinkWork memory contract the stable layer above both.

That is the cleanest path to:
- an open memory engine story,
- hosted product defaults,
- self-hosted/serverless flexibility,
- and a Memory API / MCP surface that other agents can actually trust.
