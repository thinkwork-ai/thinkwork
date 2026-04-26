---
date: 2026-04-26
topic: user-knowledge-reachability-and-knowledge-pack
status: ready-for-planning
related:
  - docs/plans/2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md  # prerequisite — user-scope refactor
  - docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md  # MCP server brainstorm; updated by R8 here
  - docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md  # paused MCP plan; this doc adds the knowledge-pack delivery requirement
---

# User-Knowledge Reachability + Per-User Knowledge Pack

## Problem Frame

Today, the user's accumulated knowledge (Hindsight episodic memory + compiled wiki) is reachable only from the root agent's normal chat path, and only via tool-call recall that the model has to remember to invoke. Three structural gaps make this brittle as the product expands across multi-agent, fat-folder delegation, and external MCP clients:

1. **Sub-agent reachability.** When the root agent calls `delegate_to_workspace`, the spawned sub-agent's tool list is built solely from its resolved skills (`packages/agentcore-strands/agent-container/container-sources/delegate_to_workspace_tool.py:276-314`). Hindsight, wiki, recall, and write_memory tools are not propagated. As fat-folder delegation becomes the dominant runtime path, this silently strips memory access from most sub-agent turns.
2. **External MCP reachability.** External clients (Claude Code, Cursor) have no path to user knowledge yet — the MCP server brainstorm exists but its plan is paused on the user-scope refactor.
3. **Discoverability + retrieval ceiling.** Even on the working root path, the model picks `hindsight_recall` first and rarely reaches `search_wiki`, so compiled wiki content is structurally underused. Wiki search itself is lexical-only Postgres FTS (`packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts:72,82` — verified using `search_tsv @@ plainto_tsquery` with GIN index and alias OR-match), narrower than Hindsight's multi-strategy retrieval.

Compounding the discoverability gap: smaller models do not reliably select the recall tool at all (server.py:937-940 documents Sonnet 4.6 picks correctly; Haiku 4.5 and Kimi K2.5 do not), so even on the working path the recall ceiling is model-dependent.

The product wants every agent context — root chat, delegated sub-agent, external MCP session — to start with a baseline of "what does this user know" already present, with tool-call recall as a sharper instrument on top. Today nothing provides that baseline.

---

## Actors

- A1. **Eric (and v1 invited users)** — primary v0/v1 consumer. Has a single user-scoped Hindsight bank + wiki post-refactor. Wants knowledge to surface regardless of which agent (or external client) is talking to him.
- A2. **Root agent (Marco etc.)** — the agent the user chats with directly. Today has Hindsight + wiki tools registered and (on Sonnet) calls them.
- A3. **Delegated sub-agent** — spawned via `delegate_to_workspace` from a fat-folder skill. Today has only its skill bodies as tools; no memory access.
- A4. **External MCP agent (Claude Code, Cursor)** — connects per-user via inbound OAuth (gated on the paused MCP plan). Should reach the same baseline as A2/A3.
- A5. **Wiki compiler** — the offline pipeline that distills retains into wiki pages. Today writes pages; will additionally render the per-user knowledge pack.

---

## Key Flows

- F1. **Cold-thread baseline ("first turn of a fresh conversation")**
  - **Trigger:** User starts a new thread on mobile/admin or a new MCP session in Claude Code.
  - **Actors:** A1, then A2/A3/A4 depending on entry point.
  - **Steps:**
    1. Runtime resolves the user's per-user knowledge pack from user-tier S3 (`tenants/{T}/users/{U}/knowledge-pack.md`).
    2. The pack is injected into the system prompt by the existing workspace-file loader (`server.py:_build_system_prompt`), alongside USER.md / IDENTITY.md.
    3. Agent's first response can reference baseline user knowledge without invoking a tool.
    4. For specific named entities not in the pack, the agent falls back to `hindsight_recall` / `search_wiki`.
  - **Outcome:** The agent gives a useful first answer that reflects what the user already knows, even when (a) the model is small and would not have called recall, (b) the path is a delegated sub-agent that doesn't have memory tools, or (c) the path is an external MCP agent.
  - **Covered by:** R4, R5, R6, R7

- F2. **Sub-agent recall ("agent delegates a task to a sub-agent that needs user context")**
  - **Trigger:** Root agent calls `delegate_to_workspace` with a fat-folder skill that needs to look something up.
  - **Actors:** A2, A3.
  - **Steps:**
    1. Sub-agent inherits the per-user knowledge pack via the workspace-file loader (same as F1).
    2. For specific lookups beyond the pack, sub-agent invokes `hindsight_recall` / `search_wiki` directly.
    3. Tools resolve against the user-scoped Hindsight bank and user-owned wiki, identical scoping to the root agent.
  - **Outcome:** Sub-agent has the same knowledge surface as the root agent.
  - **Covered by:** R1, R2, R3

---

## Requirements

**Reachability — every agent context can call the same memory + wiki tools (Approach A)**

- R1. Hindsight tools (`hindsight_recall`, `hindsight_reflect`, vendor `retain`) and wiki tools (`search_wiki`, `read_wiki_page`) are registered in every agent invocation path that does LLM work: root agent (already done at `server.py:1202,1220`), delegated sub-agents, and external MCP sessions.
- R2. `delegate_to_workspace_tool._build_sub_agent_tools` (or its v2) extends the sub-agent tool list to include the same Hindsight + wiki + managed-memory toolset the root agent gets, scoped to the same `(tenantId, userId)`. Skills remain in the list; memory tools are added, not substituted.
- R3. All memory + wiki tool registrations key scope on `userId` (per the post-2026-04-24-001 refactor). Bank IDs, wiki `owner_id`, and MCP-bound context all derive from the user, so the three paths see one coherent brain.
- R4 *(reachability — cross-cutting)*. Cross-tenant and cross-user-within-tenant isolation must hold across all three paths (root, sub-agent, MCP). The same isolation fixtures the user-scope refactor introduces apply here.

**Pre-injected knowledge pack — baseline context without a tool call (Approach D)**

- R5. The wiki compile pipeline produces a per-user knowledge pack rendered as a markdown file at user-tier S3: `tenants/{T}/users/{U}/knowledge-pack.md`. Output of one compile cycle, regenerated daily as part of the existing wiki compile cadence.
- R6. The Strands runtime workspace-file loader reads the knowledge pack alongside the existing workspace files (USER.md, IDENTITY.md, etc.) and injects it into the system prompt. The pack is loaded for root agents, delegated sub-agents (so sub-agents inherit user knowledge through the same workspace mechanism), and external MCP sessions.
- R7. The pack respects a fixed token budget chosen during planning. When the budget is exceeded, the compiler ranks content (planning decides ranking heuristic — probably page rank by backlinks + recency) and truncates rather than injecting an oversized pack.
- R8. External MCP sessions receive the equivalent baseline. Planning chooses the delivery mechanism (MCP server bundles the pack into its session prompt vs. exposes a `get_user_knowledge_pack` tool the external client fetches on connect — both are valid; pick one).
- R9. The pack is regenerated on the existing wiki compile cadence (daily by default). Activity-triggered re-compile (rebuild on retain for currently-active users) is out of scope for v1.
- R10. Failure mode: if the pack is missing, malformed, or older than a configurable threshold, the runtime logs a warning and continues without it. Tool-call recall remains available as the fallback.

**Wiki retrieval (limit acknowledged, not addressed here)**

- R11. Wiki search remains lexical Postgres FTS for v1. The knowledge pack mitigates this by pre-distilling the highest-rank wiki content at compile time, so the lexical FTS limit only affects the long tail of live tool-call queries. Upgrading wiki retrieval to semantic search is explicitly out of scope here and tracked as a separate future brainstorm.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a fat-folder skill that calls `delegate_to_workspace` to spawn a sub-agent, when that sub-agent is asked "What's the user's favorite restaurant in Paris?" with Hindsight populated, the sub-agent calls `hindsight_recall` (or relies on the pack) and returns "Le Jules Verne." Today this fails because `_build_sub_agent_tools` exposes only skill tools.
- AE2. **Covers R5, R6, R7.** Given a user with a populated wiki and Hindsight, when they start a fresh thread on mobile and ask a generic opening question ("what should I focus on today?"), the agent's first response references at least one specific item from the user's knowledge pack (a recent decision, a current project, a known preference) without having called any recall tool that turn.
- AE3. **Covers R8.** Given an external Claude Code session connected via MCP for the same user, when the user asks the same question as AE2, the response references the same baseline knowledge pack content. The mechanism (server-bundled vs. fetch-on-connect) is a planning-time decision; both must produce equivalent observable behavior.
- AE4. **Covers R10.** Given a freshly-provisioned user with no wiki content yet, when any of the three agent paths starts a thread, the system prompt loads cleanly without the pack and the agent can still answer using tool-call recall (which itself returns "no relevant memories found" gracefully).

---

## Success Criteria

- A delegated sub-agent successfully recalls a fact from Hindsight or returns a wiki page in a real test, end-to-end, on the deployed dev stack. (Today this fails by construction.)
- An agent's first response in a fresh thread references content from the user's knowledge pack without having invoked a recall tool that turn — verified for all three paths (root, sub-agent, MCP).
- Cross-tenant + cross-user-within-tenant isolation tests pass for every memory tool call across all three paths.
- For at least one non-author user (per the existing v0 → v1 gate in the MCP brainstorm): observed end-to-end use of MCP-side recall + knowledge-pack delivery over two consecutive weeks of real usage. (Same gate; this brainstorm tightens what "useful baseline" means in the gate.)
- Wiki content reaches the agent's response without the agent needing to call `search_wiki` for the most common queries — measurable as a drop in unrecovered "I don't know" responses for wiki-covered topics.

---

## Scope Boundaries

- **In scope:** Reachability fix in `_build_sub_agent_tools`; per-user knowledge pack rendered into user-tier S3 by the wiki compiler; workspace-file loader change to read it; equivalent delivery for external MCP; failure-mode + budget rules. All three paths use one user-scoped surface.
- **Out (deferred):** Runtime warm-up recall (the original "Approach B" — automatic recall on session start, results injected into context). The pre-injected pack covers the same goal at lower runtime cost; warm-up is only worth revisiting if pack staleness becomes an observed problem.
- **Out (deferred):** A unified `recall(hindsight + wiki + KB)` retrieval surface that ranks across all three sources. Solves the "model picks hindsight, never reaches wiki" problem at the API layer; bigger redesign than this brainstorm warrants.
- **Out (deferred):** Wiki retrieval-quality upgrade (lexical FTS → semantic search via Bedrock embeddings + OpenSearch / pgvector). The knowledge pack sidesteps the lexical limit for distilled content; live tool-call queries hit the lexical ceiling but are a smaller share of recall traffic. Separate brainstorm if needed.
- **Out:** Activity-triggered pack regeneration. Daily compile is the v1 cadence.
- **Out:** Per-agent knowledge pack variants. The pack is user-scoped, single per user, shared across all of the user's agents (consistent with the multi-agent capability-segmentation framing in plan 2026-04-24-001 — *tools* segment between agents, *information* does not).
- **Out:** Backwards compatibility with agent-scoped data. Inherited from the user-scope refactor; not re-litigated here.

---

## Key Decisions

- **Pre-injected pack via existing workspace-file mechanism, not runtime warm-up.** The workspace-file loader already runs on every turn, already merges system + workspace files into the prompt, and already works identically across root and sub-agent paths once the sub-agent loader is fixed. Reusing it costs less than a new runtime injection layer and has fewer failure modes.
- **Daily compile cadence, not per-turn or per-retain.** Pack regeneration runs in the same wiki compile cycle that already happens daily. Per-turn would be expensive and add latency; per-retain would couple the write path to a heavy compile. Daily staleness is acceptable for v1 because the long tail of fresh facts is still reachable via tool-call recall.
- **A and D ship together, not sequentially.** A's "fix sub-agent reachability" alone leaves the discoverability problem (model doesn't pick wiki). D's pack alone leaves sub-agent and MCP paths blind to anything outside the pack. Together they form a coherent baseline + sharp-instrument design across all three agent contexts.
- **Multi-agent users get one shared pack.** Per the 2026-04-24-001 framing, information aggregates across a user's agents. The pack is the same for all of them; tool segmentation is the only axis where the agents differ.
- **Wiki retrieval limit acknowledged, not fixed.** Lexical FTS is real but localised. The pack absorbs most of the impact; remaining gaps go in a future brainstorm rather than expanding scope here.

---

## Dependencies / Assumptions

- **Plan `docs/plans/2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md` must merge first.** Without user-scoped memory and wiki, "the user's knowledge pack" doesn't exist as a coherent thing — bank IDs, wiki `owner_id`, and MCP token claims would still key on agents.
- **Paused MCP plan `docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md` is the v1 home for R8.** When the MCP plan unpauses (its trigger is "user-scope refactor merged + 1 week regression monitoring"), the knowledge-pack delivery requirement folds into its scope. Until then, R1/R2/R5/R6/R7 ship without R8 and the MCP-side baseline lands when the MCP plan does.
- **Wiki compile pipeline can render the pack.** Assumed based on the existing pipeline structure (Lambda + GraphQL + Postgres). Planning should confirm by reading `packages/api/src/lib/wiki/compiler.ts` and `wiki-compile` Lambda to identify where the new pack-render step inserts.
- **Workspace-file loader can be extended without breaking existing files.** `server.py:_build_system_prompt` already supports adding files to its load list. Adding the pack should be a single addition to `CANONICAL_FILE_NAMES` (or equivalent) plus a graceful-missing branch.
- **Sub-agent tool registration is a recoverable v1 limitation, not a permanent design choice.** The comment in `delegate_to_workspace_tool.py:283-287` explicitly calls out "Full local-skill script execution is U11 / Phase D scope" — the sub-agent v1 is intentionally minimal. Extending the toolset is consistent with the original plan, not a fight against it.

---

## Outstanding Questions

### Resolve Before Planning

- *(none — direction is committed: A + D, pack via workspace-file loader, daily compile cadence, MCP delivery TBD in planning.)*

### Deferred to Planning

- [Affects R5, R6][Technical] **Pack content strategy.** Top-N wiki pages by rank? Wiki landing/index page only? Recent N retains as a "what's been on your mind lately" section? LLM-distilled meta-summary? Decision drives compiler complexity and pack quality.
- [Affects R7][Needs research] **Token budget.** Empirical question: at what pack size do we start to see model attention degrade or token cost dominate? Defaults likely 1-3k tokens; need to test.
- [Affects R6][Technical] **Workspace-file loader integration.** New file in `CANONICAL_FILE_NAMES` (e.g., `KNOWLEDGE_PACK.md`)? Merged into USER.md as a managed section? New named slot in the system-prompt assembler? The choice affects backwards-compat with users who have customized USER.md content.
- [Affects R8][User decision] **MCP delivery mechanism.** Server bundles the pack into the MCP session prompt (transparent to the external client) vs. exposes a `get_user_knowledge_pack` tool the external client fetches on connect (explicit; respects the client's prompt budget; lets the client decide whether to use it). Ergonomic and security implications differ.
- [Affects R5][Technical] **Compile signal: what triggers re-render?** Daily cron tied to existing wiki compile? On every retain that touches a high-rank page? On a threshold of N changes since last render? "Daily by default" is the cadence; the trigger mechanism is a planning detail.
- [Affects R10][Technical] **Staleness threshold for the warning log.** R10 says "older than a configurable threshold" — is that 25 hours (one daily cycle + buffer)? 7 days? The number drives ops alerting noise.
- [Affects R2][Technical] **Sub-agent toolset granularity.** Does the sub-agent get the FULL tool set (hindsight + wiki + recall + write_memory + others) or a curated subset? Probably full — capability segmentation is per-agent-template, not per-spawn — but planning should confirm against the security model in plan 2026-04-24-001.
- [Affects R5, R8][Technical] **Pack provenance + observability.** Does the pack carry a header with `compiled_at`, `wiki_version`, `pack_strategy_version` so that when an agent references stale content we can diagnose? Cheap to add; planning decides whether v1 needs it.
- [Affects R10][Technical] **Empty-pack rendering.** New users have no wiki content. Does the compiler skip writing a pack file (workspace loader handles missing gracefully), write a stub ("No accumulated knowledge yet"), or write nothing? Behavior should be deterministic so the loader knows what to expect.
- [Affects all][Needs research] **Measurement.** How do we observe whether the pack actually improves agent responses? Counter on `tool_call:hindsight_recall`/`search_wiki` rate per turn before/after? Eval pass over a fixture of "should-know-this-already" prompts? Knowing how we'll measure success drives whether we instrument from day one.

---

## Next Steps

`-> /ce-plan` for structured implementation planning. The user-scope refactor (plan 2026-04-24-001) is the prerequisite — this plan should sequence after that one merges, or land in a stack that depends on it.
