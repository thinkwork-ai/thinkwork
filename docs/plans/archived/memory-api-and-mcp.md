# PRD: Memory API and MCP Surface

**Status:** Draft
**Owner:** Eric Odom
**Last updated:** 2026-04-13
**Depends on:** `.prds/memory-contract-and-runtime.md`, `.prds/harness-owned-memory-positioning.md`, `.prds/memory-docs-overhaul.md`

---

## 1. Summary

ThinkWork should expose memory through a **ThinkWork-owned Memory API** and an optional **ThinkWork Memory MCP surface**.

This is not about turning ThinkWork into a generic memory vendor.

It is about making the platform's memory contract:
- portable,
- inspectable,
- interoperable,
- and clearly owned by the ThinkWork harness rather than by any single backend such as AgentCore Memory or Hindsight.

**Core rule:**

**The Memory API is the canonical contract. MCP is the interoperability adapter. Backends are implementation details.**

Near-term implementation rule:

**API and MCP should resolve against normalized ThinkWork memory records from the canonical memory plane, not against whichever backend-specific memory path happens to exist in the runtime.**

That lets ThinkWork honestly say:
- your memory belongs to your deployment,
- your memory can survive backend changes,
- your memory can be accessed by other agents and systems through a stable contract,
- and your memory is not locked to one model provider or one memory engine.

---

## 2. Problem

Today ThinkWork has the beginnings of a unified memory plane, but not a clean portability story.

What exists now:
- runtime retention and recall behavior in the agent container,
- GraphQL queries for memory search, records, graph, and config,
- backend-specific runtime wiring for AgentCore and Hindsight,
- a visible Hindsight endpoint in settings.

What is missing:
- one stable ThinkWork-level Memory API,
- one stable identity and record model above the backends,
- one sanctioned way for external agents to consume ThinkWork memory,
- one strong product story for portability that does not rely on exposing backend URLs.

Without that, ThinkWork risks saying “memory is portable” while actually meaning “some backend internals are reachable.”

That is weak.

---

## 3. Goals

- Define a ThinkWork-owned Memory API above all backends.
- Define an MCP surface that exposes ThinkWork memory to external agents and automations.
- Make portability real at the harness layer, not just in docs language.
- Preserve ThinkWork's thread-first model and existing memory contract work.
- Keep backend choice and backend replacement possible without changing the external contract.
- Improve product/UI framing by replacing backend-first memory surfaces with contract-first ones.

---

## 4. Non-goals

- Do not expose raw backend APIs as the official product contract.
- Do not make MCP the internal runtime abstraction.
- Do not promise universal graph semantics if graph remains backend-specific.
- Do not build a broad public “memory app platform” unrelated to threads and work.
- Do not attempt full bidirectional migration across all conceivable backend engines in MVP.

---

## 5. Positioning

This PRD exists to support a stronger product truth:

**Threads are the record of work. Memory is the harness-owned context layer. The Memory API is how that memory becomes portable.**

That is much stronger than:
- “Hindsight is enabled”
- “AgentCore is always on”
- “here is the backend URL”

Backend-level facts still matter, but they should sit below the product contract.

---

## 6. Design principles

### 6.0 One product truth

If a memory can affect the agent durably, it should be representable through the ThinkWork Memory contract.

That means API/MCP, admin inspectability, export, and agent recall should converge on one normalized memory shape over time.


### 6.1 API first, MCP second

The Memory API is the source of truth for semantics.

The MCP surface should be implemented on top of that contract.

### 6.2 Harness-owned semantics

The API must reflect ThinkWork semantics, not backend verbs copied upward.

Examples:
- `recall` should mean ThinkWork recall, not “whatever Hindsight calls recall today”
- `inspect` should expose ThinkWork memory artifacts, not raw backend tables only
- `capabilities` should describe what this deployment can do, not what one backend theoretically supports

### 6.3 Stable IDs above backend IDs

Backend IDs must never become the primary product identifier.

ThinkWork should generate and own its own stable memory identifiers and preserve backend references as metadata.

### 6.4 Capability-driven exposure

Not every deployment will support every memory capability.

The API and MCP surfaces must report capabilities explicitly instead of pretending every backend behaves the same way.

### 6.5 Portability means exportable contract, not perfect backend parity

Portability does not mean every backend supports every feature identically.

It means:
- stable identifiers,
- exportable memory artifacts,
- stable read/write verbs,
- and clean degradation when one capability is absent.

### 6.6 Canonical memory plane, helper layers beneath it

The API/MCP contract should sit above a canonical memory plane.

Near-term recommendation:
- Hindsight acts as the first-class memory reference plane
- AgentCore Memory acts as an ingestion/extraction helper
- thread storage remains the source record, not the memory plane itself

This resolves the current ambiguity where thread history, AgentCore strategies, and Hindsight all partially overlap but do not present one clear product truth.

---

## 7. Canonical Memory API

## 7.0 Mission alignment

The purpose of this API is not just backend access. It is to make good on four user promises:
- continuity
- inspectability
- control
- portability

If an API shape does not help those promises, it is probably infrastructure leakage rather than product contract.


## 7.1 Top-level operations

Recommended API operations:

- `retain`
- `recall`
- `reflect`
- `compact`
- `inspect`
- `list`
- `capabilities`
- `export`
- `import` (later)

Suggested REST-shaped surface:

```txt
POST /v1/memory/retain
POST /v1/memory/recall
POST /v1/memory/reflect
POST /v1/memory/compact
GET  /v1/memory/records
GET  /v1/memory/records/:id
GET  /v1/memory/graph
GET  /v1/memory/capabilities
POST /v1/memory/export
POST /v1/memory/import
```

GraphQL equivalents are also fine. The contract matters more than transport.

## 7.2 Required request context

Every memory request should be scoped by explicit ThinkWork identities, not backend identities:

- `tenantId`
- `ownerType` (`agent`, later maybe `thread`, `user`, `tenant`)
- `ownerId` (ThinkWork UUID)
- optional `threadId`
- caller identity / auth context

The API should be able to derive backend keys internally.

---

## 8. Core resource model

## 8.1 Artifact types

The API should distinguish at least three memory artifact types:

### MemoryEvent
A retained source event from which memory may later be derived.

### MemoryUnit
A durable extracted memory artifact suitable for retrieval and inspection.

### RecallResult
A ranked retrieval result returned for a specific query or turn.

These must not be blurred together.

## 8.2 Stable ThinkWork resource shape

Suggested base shape:

```ts
type ThinkWorkMemoryRecord = {
  id: string
  tenantId: string
  ownerType: "agent"
  ownerId: string
  threadId?: string
  kind: "event" | "unit" | "reflection"
  source: "thread" | "explicit_tool" | "system" | "import"
  backendRefs: Array<{
    backend: "agentcore" | "hindsight" | string
    ref: string
  }>
  content: {
    text: string
    summary?: string
  }
  strategy?: "semantic" | "preferences" | "summarization" | "episodic" | "graph" | "custom"
  provenance?: {
    threadMessageIds?: string[]
    createdFromTurnIds?: string[]
    backend?: string
  }
  createdAt: string
  updatedAt?: string
  metadata?: Record<string, unknown>
}
```

This is the exported contract. Backend-native fields remain implementation detail unless explicitly mapped through.

---

## 9. Capabilities model

The API must report capabilities per deployment and, where needed, per owner/backend combination.

Suggested capabilities:

```ts
type MemoryCapabilities = {
  retain: boolean
  recall: boolean
  reflect: boolean
  compact: boolean
  inspectRecords: boolean
  inspectGraph: boolean
  export: boolean
  import: boolean
  delete: boolean
  archive: boolean
  backendSummary: Array<{
    backend: string
    enabled: boolean
    supports: string[]
  }>
}
```

Key rule:
- graph is a capability, not a universal assumption
- reflection is a capability, not a universal assumption

---

## 10. Endpoint semantics

## 10.1 `retain`

Purpose:
- record new memory input according to ThinkWork harness semantics

Should support:
- raw event retention
- explicit fact retention
- source metadata
- optional fanout to one or more configured backends

Should not require callers to know backend namespaces, bank IDs, or memory IDs.

## 10.2 `recall`

Purpose:
- retrieve memory relevant to a query or turn context

This should return normalized ThinkWork memory units from the canonical memory plane. It should not expose raw backend-native recall outputs as the primary contract.

Request should support:
- `query`
- `ownerId`
- optional `threadId`
- `limit`
- optional token budget or response budget
- optional filters by strategy or source

Response should include:
- ranked results
- provenance
- backend attribution where useful
- capability flags if some backends were unavailable

## 10.3 `inspect` / `list`

Purpose:
- browse stored memory artifacts for audit, debugging, and administration

This should expose:
- artifact type
- strategy
- timestamps
- provenance
- backend refs
- deletion/archive state

## 10.4 `reflect`

Purpose:
- trigger or request synthesis/compression of memory over time

This should remain optional and capability-gated.

## 10.5 `compact`

Purpose:
- trigger or apply harness-level compaction policy

Important:
- compaction is a ThinkWork behavior, not a backend behavior
- not every backend needs to know about compaction directly

## 10.6 `export`

Purpose:
- produce a portable snapshot of ThinkWork memory artifacts for migration, backup, or external use

The first export format can be JSONL or JSON bundle.

It should export ThinkWork contract artifacts, not raw vendor-native dumps by default.

---

## 11. MCP surface

## 11.1 Why MCP should exist

MCP gives ThinkWork a strong interoperability story:
- other agents can read/write ThinkWork memory
- customer automations can integrate with ThinkWork memory
- portability story becomes concrete in agent ecosystems
- ThinkWork memory becomes usable outside the native ThinkWork runtime without exposing raw backend systems

## 11.2 MCP tool set for MVP

These tools should resolve against the same normalized memory plane the API uses. MCP should not be a side door into backend-specific memory systems.

Recommended MVP tools:

- `memory_capabilities`
- `memory_recall`
- `memory_retain`
- `memory_list_records`
- `memory_inspect_record`
- `memory_export`

Deferred:
- `memory_reflect`
- `memory_compact`
- `memory_import`
- graph mutation tools

## 11.3 MCP design rules

- MCP tools should call the ThinkWork Memory API, not backend APIs directly.
- MCP tool schemas should use ThinkWork identities and filters.
- MCP tool responses should use ThinkWork resource shapes.
- Backend-specific details should appear only in metadata when genuinely useful.

## 11.4 Security and permissions

MCP memory tools are sensitive.

The permission model should support:
- read-only memory access
- explicit write permission for retain/import
- tenant-scoped access controls
- owner-scoped access controls
- audit logging of MCP calls

---

## 12. Auth and access model

The Memory API should be protected as a first-class system surface.

Recommended modes:
- ThinkWork user/session auth for product surfaces
- service token auth for internal runtime/services
- scoped token auth for external API consumers
- MCP auth following normal ThinkWork connector/tool auth patterns

Permissions should differentiate:
- can recall
- can inspect
- can export
- can retain
- can reflect
- can administer backend settings

---

## 13. Identity normalization

This is one of the most important implementation details.

Today:
- AgentCore leans on assistant UUID / actor ID
- Hindsight leans on bank ID / slug

The Memory API must normalize this.

Recommendation:
- canonical owner identity = ThinkWork agent UUID
- backend adapters map UUID to backend-native identities internally
- exports always use ThinkWork-owned IDs
- UI and MCP should never require users to know bank IDs or namespace conventions

---

## 14. Export and portability

## 14.1 What portability should mean

Portability should mean:
- a ThinkWork deployment can export its memory artifacts
- another ThinkWork deployment can later import them
- external agents can consume memory through API or MCP without binding to a backend
- backend replacement does not require changing client contracts

## 14.2 Export format

Suggested v1 export shape:

```ts
type MemoryExportBundle = {
  version: "v1"
  exportedAt: string
  tenantId: string
  owner: {
    type: "agent"
    id: string
  }
  capabilities: MemoryCapabilities
  records: ThinkWorkMemoryRecord[]
}
```

Optional later additions:
- graph edges in exported inspectability form
- backend-native attachments as a secondary optional bundle
- encryption/signing for enterprise exports

---

## 15. UI and product implications

The settings/UI story should change.

Instead of showing raw backend internals like a naked Hindsight hostname as if it is the user-facing memory surface, ThinkWork should show something closer to:

- **Memory backends:** Managed, Hindsight
- **Memory API:** Enabled
- **Memory MCP:** Enabled / Optional
- **Inspectability:** Records, Search, Graph
- **Export:** Available

If backend URLs are shown at all, they should live in an advanced diagnostics area.

---

## 16. Implementation plan

## Phase 1: Contract and types

- define canonical Memory API request/response types
- define stable ThinkWork memory record shape
- define capabilities model
- define export bundle shape
- define MCP tool schemas

## Phase 2: API facade

- implement Memory API facade over existing runtime/backend logic
- normalize owner IDs and backend refs
- add `capabilities` endpoint
- add `export` endpoint

## Phase 3: MCP adapter

- implement MCP server/tools over the Memory API
- add permission checks and audit logging
- expose read-first operations before write operations

## Phase 4: UI cleanup

- update settings and admin surfaces
- replace backend-first rows with Memory API / MCP / backend capability view
- move raw backend hostnames to advanced diagnostics

## Phase 5: Import and migration

- add import path if needed
- define migration semantics across deployments/backends
- document limitations explicitly

---

## 17. Risks

### 17.1 Overbuilding too early

This can spiral into a giant platform abstraction if not kept tight.

Mitigation:
- keep v1 narrow
- focus on recall/retain/inspect/export first
- do not build universal graph semantics yet

### 17.2 Backend mismatch leakage

Different backends will not support identical semantics.

Mitigation:
- capabilities model
- stable ThinkWork resource model
- clean degradation rules

### 17.3 MCP scope creep

It is easy to turn MCP into the whole memory runtime.

Mitigation:
- enforce the rule that MCP sits on top of the API
- do not let runtime internals depend on MCP

### 17.4 Identity drift

If slugs, bank IDs, and UUIDs leak together, portability gets messy fast.

Mitigation:
- normalize around ThinkWork-owned UUIDs immediately

---

## 18. Open questions

- Should the first canonical transport be GraphQL, REST, or both?
- Should export be JSON bundle, JSONL, or both?
- Should the first MCP release be read-only except for `memory_retain`?
- How much graph inspectability belongs in v1 if graph is still backend-specific?
- Should import land only after export is proven useful, or be designed up front?

---

## 19. Bottom line

A dedicated Memory API/MCP layer is the right move.

It gives ThinkWork a real portability story without lying.
It strengthens the harness-owned memory positioning.
It makes backend choice less central to the product story.
And it gives external agents and customer systems a clean way to interact with ThinkWork memory.

**The winning line is not “here is the Hindsight URL.”**

It is:

**“ThinkWork owns the memory contract. You can access it through API and MCP. The backend is your implementation choice, not your lock-in.”**
