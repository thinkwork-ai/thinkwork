# Memory Implementation Handoff Checklist

**Purpose:** Turn `.prds/memory-implementation-plan.md` into an execution-ready build checklist for coding agents.

**Source of truth:**
- `.prds/memory-implementation-plan.md`
- `.prds/memory-canonical-plane-decision.md`

---

## 1. Core implementation rules

These are non-negotiable:

- **Aurora thread messages remain the short-term/session context source**
- **Exactly one long-term memory engine is active per deployment**
- **Both adapters must exist from day one:** `hindsight`, `agentcore`
- **Hosted ThinkWork defaults to `hindsight`**
- **Self-hosted/serverless-friendly deployments may choose `agentcore`**
- **All top-level memory consumers must move toward one normalized recall path**
- **Do not expose merged backend-native memory truth to users**

---

## 2. Implementation milestones

### Milestone 1: Create the ThinkWork memory contract

Deliver:
- shared memory config type
- shared normalized memory types
- shared adapter interface

Target modules:

```txt
packages/api/src/lib/memory/config.ts
packages/api/src/lib/memory/types.ts
packages/api/src/lib/memory/adapter.ts
```

Checklist:
- [ ] Add `MemoryEngineType = "hindsight" | "agentcore"`
- [ ] Add `MemoryConfig` type with `engine`, `sessionSource`, recall/retain/inspect flags
- [ ] Add `MemoryOwnerRef`, `RecallRequest`, `RetainRequest`, `InspectRequest`, `ExportRequest`
- [ ] Add `ThinkWorkMemoryRecord`, `RecallResult`, `MemoryCapabilities`, `MemoryExportBundle`
- [ ] Add `MemoryAdapter` interface
- [ ] Add helper validation for invalid or missing engine config

Definition of done:
- one place in the codebase defines the canonical memory contract
- no adapter-specific types leak into shared interfaces

---

### Milestone 2: Implement both adapters

Deliver:
- Hindsight adapter
- AgentCore adapter

Target modules:

```txt
packages/api/src/lib/memory/adapters/hindsight-adapter.ts
packages/api/src/lib/memory/adapters/agentcore-adapter.ts
```

Checklist:
- [ ] Hindsight adapter maps ThinkWork owner refs to Hindsight concepts
- [ ] Hindsight adapter normalizes recall results into `ThinkWorkMemoryRecord`
- [ ] Hindsight adapter reports accurate capabilities
- [ ] AgentCore adapter maps ThinkWork owner refs to AgentCore actor/session/namespace model
- [ ] AgentCore adapter normalizes memory records into `ThinkWorkMemoryRecord`
- [ ] AgentCore adapter reports honest capability gaps if inspect/export/graph are weaker
- [ ] Both adapters implement the same interface cleanly

Definition of done:
- both adapters compile against the same contract
- either adapter can be selected without changing top-level callers

---

### Milestone 3: Build the single recall service

Deliver:
- one canonical read path for long-term memory

Target module:

```txt
packages/api/src/lib/memory/recall-service.ts
```

Checklist:
- [ ] Resolve configured engine
- [ ] Instantiate the selected adapter
- [ ] Call adapter recall
- [ ] Return normalized `RecallResult[]`
- [ ] Enforce default limit and token budget
- [ ] Keep service backend-agnostic above adapter boundary
- [ ] Make sure service does **not** merge Hindsight + AgentCore in steady state

Definition of done:
- there is one recall entry point other systems can depend on

---

### Milestone 4: Build inspect/export layer on top of the same contract

Deliver:
- inspect service
- export service

Target modules:

```txt
packages/api/src/lib/memory/inspect-service.ts
packages/api/src/lib/memory/export-service.ts
```

Checklist:
- [ ] Inspect returns normalized records only
- [ ] Export returns `MemoryExportBundle`
- [ ] Capability flags are surfaced cleanly
- [ ] No endpoint or helper returns raw backend-native blobs as the product contract

Definition of done:
- API/admin/export all sit above the same normalized memory layer

---

### Milestone 5: Point API and MCP at the normalized layer

Deliver:
- Memory API reads through normalized services
- MCP tools read through normalized services

Checklist:
- [ ] Find current API memory endpoints / handlers and route them through recall/inspect/export services
- [ ] Update MCP-facing memory tools to use normalized service layer
- [ ] Remove backend-specific response branching from API/MCP surfaces where practical
- [ ] Preserve engine capability differences through flags, not ad hoc shape changes

Definition of done:
- API and MCP behave like ThinkWork memory surfaces, not thin backend wrappers

---

### Milestone 6: Align explicit memory tools

Target areas:

```txt
packages/agentcore-strands/agent-container/memory_tools.py
packages/agentcore-strands/agent-container/server.py
```

Checklist:
- [ ] Audit current `remember()` logic for dual-write or backend-specific branching
- [ ] Audit current `recall()` logic for mixed Hindsight/AgentCore behavior
- [ ] Route `recall()` toward the normalized recall path, or a thin service bridge to it
- [ ] Route `remember()` through the selected engine contract where practical
- [ ] Stop exposing duplicated memory behavior through tool code

Definition of done:
- tool behavior matches the new product architecture instead of preserving old overlap

---

### Milestone 7: Start runtime recall migration

Target areas:

```txt
packages/api/src/handlers/chat-agent-invoke.ts
packages/agentcore/agent-container/memory.py
packages/agentcore-strands/agent-container/server.py
```

Checklist:
- [ ] Keep short-term/session history on Aurora `messages_history`
- [ ] Audit current long-term recall injection path
- [ ] Replace backend-specific recall path with normalized recall service input where feasible
- [ ] Format recalled memory into a bounded runtime context block
- [ ] Avoid changing short-term context semantics while migrating long-term recall

Definition of done:
- runtime short-term and long-term context paths are clearly separated

---

### Milestone 8: Clean up overlap

Checklist:
- [ ] Identify duplicate writes to Hindsight + AgentCore
- [ ] Keep temporary dual-write only where migration safety requires it
- [ ] Ensure canonical recall always comes from the configured engine only
- [ ] Remove or isolate dead overlap paths
- [ ] Make sure inspect/export/admin no longer imply two simultaneous truths

Definition of done:
- the code may still have migration scaffolding, but the product truth is singular and clear

---

## 3. Recommended implementation order

Do this in order:

1. shared config/types/interface
2. both adapters
3. recall service
4. inspect/export services
5. API/MCP integration
6. explicit memory tools cleanup
7. runtime recall migration
8. overlap reduction

Do **not** start by rewriting runtime memory assembly first. That’s how this gets messy again.

---

## 4. Files most likely involved

Primary new TS files:

```txt
packages/api/src/lib/memory/config.ts
packages/api/src/lib/memory/types.ts
packages/api/src/lib/memory/adapter.ts
packages/api/src/lib/memory/recall-service.ts
packages/api/src/lib/memory/inspect-service.ts
packages/api/src/lib/memory/export-service.ts
packages/api/src/lib/memory/adapters/hindsight-adapter.ts
packages/api/src/lib/memory/adapters/agentcore-adapter.ts
```

Existing files likely needing integration changes:

```txt
packages/api/src/handlers/chat-agent-invoke.ts
packages/agentcore/agent-container/memory.py
packages/agentcore-strands/agent-container/memory_tools.py
packages/agentcore-strands/agent-container/server.py
```

---

## 5. Guardrails for coding agents

- Do not make thread DB optional for short-term context.
- Do not implement multi-engine merged recall as a feature.
- Do not bake Hindsight-specific or AgentCore-specific fields into the shared types.
- Do not expose raw backend payloads as the stable ThinkWork API contract.
- Do not hide capability differences. Surface them explicitly.
- Do not rewrite everything in one giant PR if smaller sequenced PRs are possible.

---

## 6. Suggested PR breakdown

### PR 1
Shared contract + config + normalized types + adapter interface

### PR 2
Hindsight adapter + AgentCore adapter

### PR 3
Single recall service + inspect/export services

### PR 4
API/MCP integration

### PR 5
Explicit memory tools cleanup

### PR 6
Runtime recall migration + overlap reduction

---

## 7. Acceptance checklist for handoff review

- [ ] I can configure ThinkWork to use `hindsight` or `agentcore`
- [ ] Hosted default remains `hindsight`
- [ ] Session history still comes from Aurora threads
- [ ] Both adapters return normalized ThinkWork records
- [ ] There is one recall service
- [ ] API reads through the normalized layer
- [ ] MCP reads through the normalized layer
- [ ] Runtime recall is moving toward the normalized layer
- [ ] No user-facing surface implies two simultaneous long-term memory truths

---

## 8. One-sentence handoff summary

**Implement a ThinkWork-owned memory contract with two pluggable adapters, one active engine per deployment, Aurora-backed short-term context, and one normalized recall path shared by API, MCP, inspectability, export, and eventually runtime recall.**
