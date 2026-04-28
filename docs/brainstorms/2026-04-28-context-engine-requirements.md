---
date: 2026-04-28
topic: context-engine
status: ready-for-planning
related:
  - docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md
  - docs/brainstorms/2026-04-26-user-knowledge-reachability-and-knowledge-pack-requirements.md
  - docs/brainstorms/2026-04-27-hindsight-wiki-document-replication-requirements.md
  - docs/brainstorms/2026-04-26-pi-agent-runtime-parallel-substrate-requirements.md
---

# Context Engine

## Problem Frame

Thinkwork has several strong knowledge surfaces: Hindsight memory, compiled wiki pages, workspace files, MCP-backed customer systems, and Bedrock Knowledge Bases. The failure mode is not simply missing data. Users and agents wire tools together manually, fail to find answers that exist, or call the wrong search tool.

Context Engine is the shared product primitive for agentic enterprise search. It provides one provider-aware query surface for the mobile app, Strands agents, and Pi agents. It borrows Scout's product architecture -- context providers, provider status, provider-specific routing, normalized results, and optional write-capable providers -- while keeping Thinkwork's AWS-native, tenant-aware, memory-native architecture.

This reframes the wiki replication problem: Hindsight and wiki do not need to collapse into one store for v0. Both become Context Engine providers, and the router can consult each source during a search or agent turn.

---

## Actors

- A1. Mobile end user: searches personal and team context from the mobile app without starting a full agent conversation.
- A2. Strands agent: calls Context Engine as a built-in tool during normal agent turns.
- A3. Pi agent: calls the same Context Engine tool contract from the Pi runtime.
- A4. Tenant admin: decides which MCP tools are eligible for Context Engine and which are included in default search.
- A5. Context provider: any source that can answer a natural-language query with normalized, cited results.
- A6. Context router: the lightweight agentic planner that chooses providers, executes provider calls, merges results, and optionally synthesizes an answer.

---

## Key Flows

- F1. Mobile context query
  - **Trigger:** A mobile user opens Context Engine search and enters a query.
  - **Actors:** A1, A5, A6
  - **Steps:** The mobile UI shows pre-search provider chips with default-safe providers selected. The user may adjust sources, then runs the query. Context Engine routes across selected providers, returns ranked results with source labels, and lets the user filter by provider after search.
  - **Outcome:** The user sees one unified result set across memory, wiki, files, Bedrock KB, and eligible MCP sources without starting a full agent.
  - **Covered by:** R1, R2, R3, R4, R5, R10

- F2. Result detail and follow-up
  - **Trigger:** A mobile user taps a result.
  - **Actors:** A1
  - **Steps:** The app opens a source-detail sheet showing the original snippet, provenance, provider, scope, and supporting metadata. The sheet offers an "ask about this" action that starts an agentic follow-up with the result set attached as context.
  - **Outcome:** Search remains inspectable and citation-first, while deeper work can move into an agent turn.
  - **Covered by:** R6, R7

- F3. Agent turn uses Context Engine
  - **Trigger:** A Strands or Pi agent needs context during a turn.
  - **Actors:** A2 or A3, A5, A6
  - **Steps:** The agent calls `query_context` with a query, mode, scope, depth, and optional providers. Context Engine routes the query, returns either results or an answer with citations, and the agent uses those results in its response or next action.
  - **Outcome:** Agents stop choosing between `hindsight_recall`, wiki search, file reads, Bedrock KB lookup, and MCP-specific search tools for ordinary context lookup.
  - **Covered by:** R1, R2, R3, R8, R9, R13

- F4. Admin enables an MCP tool for Context Engine
  - **Trigger:** A tenant registers or updates an MCP server in Thinkwork.
  - **Actors:** A4, A5
  - **Steps:** Thinkwork discovers MCP tool metadata. Tools that self-declare read-only/search-safe are eligible for review. The admin approves specific tools for Context Engine and marks which approved tools join default search.
  - **Outcome:** LastMile and customer-specific MCPs can become enterprise search providers without allowing arbitrary MCP mutations through search.
  - **Covered by:** R11, R12, R15

---

## Requirements

**Shared query primitive**
- R1. Context Engine exposes one shared `query_context` primitive to mobile, Strands, and Pi.
- R2. `query_context` accepts at least: `query`, `mode`, `scope`, `depth`, and optional provider selection.
- R3. `mode` supports `results` and `answer`. `results` returns ranked source hits. `answer` returns a synthesized answer plus supporting hits. The default is `results`.
- R4. `scope` supports `personal`, `team`, and `auto`. `auto` is the default and may include personal and tenant/team-shared providers when permissioned.
- R5. `depth` supports `quick` and `deep`. `quick` is the default and uses a bounded single routing pass with tight timeouts. `deep` may perform multi-step provider follow-up before returning.

**Mobile product surface**
- R6. The mobile app exposes Context Engine as a user-facing search surface, not only as a hidden agent tool.
- R7. Mobile search supports pre-search provider chips. Default-selected sources are safe/core providers; users can opt additional providers in before running the search.
- R8. Mobile results can be filtered after search by provider family: Memory, Wiki, Files, Bedrock KB, MCP, and future provider families.
- R9. Tapping a result opens source detail first, with an "ask about this" action for agentic follow-up.

**Provider model**
- R10. v0 providers include Hindsight memory, Thinkwork wiki, workspace/filesystem search, AWS Bedrock Knowledge Bases, and approved read-only/search-safe MCP tools.
- R11. Providers return normalized results with source family, provider id, title, excerpt/snippet, score or rank, provenance/citation, scope, and provider-specific metadata.
- R12. Provider health/status is observable so unavailable sources degrade into status/errors instead of breaking the whole query.
- R13. MCP providers are approved at the individual tool level for v0. A tool must both self-declare read-only/search-safe and receive tenant-admin approval before it can participate in default search.
- R14. Custom PostgreSQL vector providers are deferred until after Bedrock KB, but the provider contract must not make pgvector-style providers awkward to add.

**Agent integration**
- R15. Strands agents receive `query_context` as a built-in tool.
- R16. Pi agents receive the same `query_context` contract; implementation details may differ, but observable behavior and result shape match Strands.
- R17. Existing specialized tools may remain available, but normal context lookup should route through `query_context` first unless the agent has a specific reason to use a specialized tool directly.

**Future action primitive**
- R18. v0 is read-only. The write/action side is named `act_on_context` and may exist as a stubbed or non-callable future primitive, but mobile search and `query_context` do not mutate source systems.
- R19. The future `act_on_context` model supports provider-declared action capability, admin approval, and explicit user or agent intent before any mutation. It is not part of default search.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R10.** Given a user has relevant facts in Hindsight and a related compiled wiki page, when mobile calls `query_context({ query: "what did we decide about X?", mode: "results" })`, then the response contains both memory and wiki hits in one result set with provider labels and provenance.

- AE2. **Covers R5.** Given a user runs the same query with `depth: "quick"` and then `depth: "deep"`, quick returns within the mobile-friendly timeout using one routing pass, while deep may inspect additional MCP/KB results before returning a more complete answer.

- AE3. **Covers R7, R13.** Given an MCP server has five tools, two self-declared read-only/search-safe and one admin-approved for default search, when the user opens mobile Context Engine, only the approved tool's provider chip is selected by default. The other safe tool can be opt-in if admin allowed it, and mutation tools are absent from search.

- AE4. **Covers R15, R16, R17.** Given a Strands agent and a Pi agent are each asked "what do we know about Acme's renewal?", both can call `query_context` and receive the same normalized result structure across Hindsight, wiki, Bedrock KB, and eligible MCP providers.

- AE5. **Covers R18, R19.** Given a CRM MCP exposes an `update_contact` tool, when a user runs Context Engine search, no mutation occurs. If a later agent workflow wants to update the CRM, that work must go through the future `act_on_context` action path with explicit intent and approval rules.

---

## Success Criteria

- A mobile user can search across Hindsight, wiki, workspace/files, Bedrock KB, and at least one approved MCP tool from a single Context Engine call.
- Agents in both Strands and Pi can use the same `query_context` contract during a turn.
- Wrong-tool failures drop in dogfood: fewer agent turns call Hindsight when the answer is in wiki, or call wiki when the answer is in Bedrock KB/MCP.
- Admins can safely make a LastMile/customer MCP tool part of default search without exposing mutation tools.
- Planning can proceed without re-deciding the product shape: provider model, query contract, mobile behavior, MCP approval, v0 provider list, and future action naming are settled.

---

## Scope Boundaries

### Deferred for later

- Custom PostgreSQL vector DB providers. The contract should anticipate them, but v0 ships Bedrock KB first.
- `act_on_context` as a live mutation primitive. v0 may reserve the name/stub, but no source-system mutation ships through Context Engine search.
- Web, Slack, Google Drive, GitHub, Gmail, and Calendar as first-party v0 providers unless they already arrive through approved MCP or Bedrock KB. Add after core providers prove the product.
- Advanced cross-provider learning loops, such as automatically tuning routing from clickthrough and agent outcomes.
- Full enterprise permission modeling beyond personal/team/auto if group/project scopes are not already ready.

### Outside this product's identity

- A single unified index that ingests every source into one backend as the primary product shape. Context Engine is provider-routed and live-source-aware.
- Replacing Hindsight, AgentCore managed memory, or the compiled wiki. They become providers, not casualties.
- A mobile-only search feature with a separate agent runtime implementation. Context Engine is one platform primitive shared by mobile, Strands, and Pi.
- An unrestricted MCP tool browser. Only approved, search-safe tools participate in Context Engine query by default.

---

## Key Decisions

- **Name is Context Engine.** This is a platform primitive, not just a mobile search screen.
- **Primary read API is `query_context`.** The name signals a provider-routed enterprise context question rather than a narrow search index.
- **Future write API is `act_on_context`.** This is broader and safer than `update_context`; many future operations are actions, not edits to context owned by Thinkwork.
- **Borrow Scout's product shape, not its exact implementation.** Scout's useful template is the ContextProvider registry, `query_`/`update_` split, status endpoints, MCP wrapper provider, and evals for wrong-tool routing. Thinkwork should implement the same product pattern in its AWS-native, tenant-aware architecture.
- **MCP approval is tool-level in v0.** Server-level approval is too coarse for default enterprise search.
- **Wiki replication into Hindsight is no longer a v0 product requirement.** A routed provider model lets the router consult both sources directly.
- **Quick/deep split is required.** Mobile needs fast answers; agents sometimes need slower investigation.

---

## Dependencies / Assumptions

- Hindsight, wiki, workspace files, and user-memory MCP primitives already exist in Thinkwork, but they are not yet unified as one Context Engine provider registry.
- Bedrock Knowledge Bases must be a real v0 provider, not only a future extension.
- Pi runtime work is still a parallel-substrate initiative; Context Engine planning must align the `query_context` contract with that runtime's tool model.
- Tenant/team scope remains an option in v0. Planning should map `team` to whatever tenant/team permission model is ready, without blocking `personal`.
- Scout inspiration was reviewed from `README.md`, `AGENTS.md`, `scout/contexts.py`, `scout/agent.py`, `scout/instructions.py`, `docs/MCP_CONNECT.md`, and eval files in the public `agno-agi/scout` repository.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R2-R5][Technical] Exact request/response schema for `query_context`, including provider selection syntax and streaming vs. non-streaming response.
- [Affects R5][Technical] Timeout budgets for quick and deep mode on mobile vs. agent turns.
- [Affects R10][Technical] Bedrock KB provider shape: tenant/team scoping, citation payload, and whether multiple KBs appear as one provider family or separate provider chips.
- [Affects R10-R12][Technical] Filesystem provider scope: workspace files only, user files, agent files, or all permissioned S3-backed files.
- [Affects R11][Technical] Ranking and dedupe strategy across heterogeneous scores from Hindsight, wiki FTS, Bedrock KB, MCP, and files.
- [Affects R13][Technical] How MCP tools self-declare read-only/search-safe metadata and how admin approval is stored.
- [Affects R15-R16][Technical] Whether Strands and Pi call a shared HTTP/API endpoint or use runtime-local provider clients for some sources.
- [Affects Success Criteria][Needs research] Evals and observability for wrong-tool reduction: fixtures should include expected providers, forbidden providers, provider failures, empty-result degradation, and prompt-injection-in-tool-output cases.

---

## Next Steps

-> /ce-plan for structured implementation planning.
