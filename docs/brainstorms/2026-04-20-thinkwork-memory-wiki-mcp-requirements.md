---
name: ThinkWork Memory + Wiki MCP Server
description: Expose ThinkWork's memory (Hindsight/AgentCore) and wiki systems to external MCP clients (Claude Code, etc.) via a single multi-tenant MCP server
date: 2026-04-20
status: ready-for-planning
---

# ThinkWork Memory + Wiki MCP Server

## Problem

External AI agents (Claude Code, Cursor, IDE plugins) have rich context about the user's current code and conversation but no durable cross-session memory beyond local files. ThinkWork already has a production memory pipeline (`memory-retain` Lambda → Hindsight or AgentCore → async wiki compile) and a curated wiki surface (Postgres FTS + backlinks). Today that brain is invisible to any agent that isn't a ThinkWork agent.

A ThinkWork user working in Claude Code should be able to:
- Retain learnings, decisions, and facts into their ThinkWork agent's memory without switching context.
- Recall recent episodic memory from that agent when answering a new question.
- Search the compiled wiki to ground answers in the user's own curated knowledge.

The mechanism is a **single native MCP server** that ThinkWork hosts, which external agents connect to per-user over OAuth.

## Users and validation approach

- **v0 consumer:** a small set of invited ThinkWork users with stated use cases (starting with the author). "Productized" is not the v0 claim — it's the v1 goal, conditional on seeing at least one non-author user accumulate meaningful retain/recall volume over two weeks.
- **v1 consumer:** any ThinkWork user who has enabled the feature via mobile self-serve opt-in. User-driven, not admin-configured.
- **Success gating:** v1 features (below) do not ship until v0 adoption evidence is in hand. If v0 usage is author-only after 30 days, reconsider scope before expanding.

## Access model

- **Mobile self-serve opt-in.** The connect flow lives on mobile, never in admin.
- **Agent picker at connect time.** The user chooses one existing ThinkWork agent as the memory target for this MCP client. The mental model is "Claude Code augments my chosen ThinkWork agent's brain."
- **One MCP connection per user, per connected client.** v0 allows one active connection total; v1 may allow one per external client (Claude Code + Cursor, etc.). Cross-agent federation is out of scope.
- **External-origin provenance is preserved throughout the pipeline** (see Retain surface below).

### Inbound OAuth (greenfield)

This is net-new inbound-OAuth infrastructure. The existing mobile-side `apps/mobile/app/settings/mcp-servers.tsx` code is a client for outbound MCP servers (RFC 9728 discovery against third-party URLs) — it is the wrong direction and is not reusable beyond coincidental libraries. Requirements:

- Authorization server choice — either extend Cognito as the IdP with a thin DCR proxy, or stand up a dedicated issuer. Picked in planning; see open question 1.
- PKCE S256 required; no plain PKCE.
- Strict redirect URI allowlist; DCR client metadata validated at registration.
- Access token TTL ≤ 15 minutes; refresh token rotation on each use.
- Revocation propagation within one access-token TTL. Server-side revocation check on retain and memory_recall.
- Connection context (tenantId, userId, agentId, clientId) bound immutably at session establishment from verified token claims. No tool accepts these as caller input.
- Rate limiting enforced at the edge. v0 defaults: retain 30/min, memory_recall/wiki_search 60/min, per (userId, agentId). 429 with Retry-After on breach.

## Goals

1. Let external agents write facts/learnings/decisions into the connected ThinkWork agent's memory via a unified `retain` tool, reusing the existing `memory-retain` Lambda and wiki-compile pipeline with external-origin provenance preserved.
2. Let external agents read ThinkWork memory and wiki through intent-explicit tools — `memory_recall` vs. `wiki_search` — preserving the structured outputs each source produces.
3. Keep v0 a minimum read-and-retain surface that tests whether users actually use this. No auxiliary tools until that hypothesis is validated.

## Non-goals (v0 and v1)

- Direct wiki page create/update/delete from external agents. Wiki updates remain downstream of retain via async compile.
- `memory_forget` / deletion of retained memories from the MCP surface.
- Agent override per tool call. Users retarget by reconnecting.
- Cross-agent / cross-tenant federation, teams, or shared memory banks.
- stdio transport. Streamable-HTTP only. TLS 1.2+ required; plaintext HTTP rejected. (Server-side MCP is greenfield; SDK/runtime/deployment is a planning decision.)
- Exposing MCP server connection management to external agents (no meta-tools).
- Reflect. Adapter capabilities are uneven (`hindsight-adapter.capabilities.reflect=true`, `agentcore-adapter.capabilities.reflect=false`); `memory_recall` calls `recall` only.

## v0 tool surface (3 tools — minimum to validate hypothesis)

| Tool | Purpose | Backend |
|---|---|---|
| `retain` | Store a fact/learning/decision in the connected agent's memory | `memory-retain` Lambda (`packages/api/src/handlers/memory-retain.ts`, invoked via Lambda SDK — not an HTTP endpoint). Invocation type is **RequestResponse** so tool-call errors surface to Claude Code (aligns with the repo's "avoid fire-and-forget for user-driven writes" rule). Server wraps caller's `content` into a synthetic turn before invoking, tagging `source: "external-mcp"` and `clientId` in the turn envelope. |
| `memory_recall` | Semantic recall of prior episodes | `recall-service.ts` → adapter (Hindsight or AgentCore based on agent config). Returns scored `RecallResult[]`. Calls `recall` only — never `reflect`. |
| `wiki_search` | Postgres FTS over compiled wiki pages with alias boost | `wikiSearch` GraphQL resolver. |

All tools scope reads and writes to the connected `(tenantId, userId, agentId)` triple established at session start. Adapter and GraphQL resolvers MUST independently re-enforce tenantId filtering — MCP-edge scoping is defense-in-depth, not the sole line.

### `retain` surface detail

- **Input:** `{ content: string, kind?: "learning"|"decision"|"fact"|"note", tags?: string[], threadId?: string }`.
  - `kind` is advisory metadata for v0. If no downstream consumer branches on it by v1, drop it.
  - `tags` is free-form caller-annotated tags.
  - `threadId`, if supplied, MUST be validated server-side to belong to the connected `(userId, agentId)`. Unowned threadId → 403. If unsupplied, the server mints a stable synthetic thread: one virtual thread per (userId, agentId, clientId), never caller-controlled.
- **Response:** `{ ok: boolean, memoryId?: string, agentName: string, threadId: string, wikiCompilePending: boolean, error?: { code: string, message: string, reauthRequired?: boolean } }`. Tokens expired mid-call return `error.reauthRequired=true` so Claude Code can prompt re-auth.
- **Content safety:** before invoking the Lambda, `retain` passes `content` through a credential-redaction pass (at minimum: regex for common API key formats — OpenAI sk-, AWS AKIA, GitHub ghp_, generic JWT). v1 target: Bedrock Guardrails for broader classification. Redaction MUST be logged (count only, not content) so we can measure rate.
- **Mobile display rule (load-bearing UX invariant):** external-origin retains do NOT render in the agent's conversation view as user messages. They appear only in a distinct "External memories" panel in the mobile agent detail screen, tagged with the connected client's name ("via Claude Code") and timestamp. This preserves the conversation view as user-authored and prevents attribution confusion.
- **Wiki compile:** external-origin retains flow through the existing compile pipeline. The compiler MUST read the `source` tag and, for v0, either (a) include external retains in compile as-is, or (b) gate compile on a per-tenant flag. Planning decides which; default to (a) if the tenant already has `wiki_compile_enabled`.

### `memory_recall` surface detail

- **Input:** `{ query: string, limit?: number }` (default limit 10, hard cap 20).
- **Response:** `{ results: Array<{ score: number, snippet: string, memoryId: string, retainedAt: string, source?: "external-mcp" | null }> }`. Per-result size capped at 2KB to protect Claude Code's tool-result budget.
- **Scope invariant:** adapter MUST filter by `(tenantId, agentId)` server-side. The MCP edge passes the bound context; the adapter does not trust it.

### `wiki_search` surface detail

- **Input:** `{ query: string, limit?: number }` (default 10, hard cap 20).
- **Response:** same shape as today's `wikiSearch` resolver output — `{ hits: Array<{ pageId, slug, title, excerpt, score, matchedAlias?: string }> }`.
- **Scope invariant:** resolver's `assertCanReadWikiScope(ctx, tenantId, ownerId)` must succeed for the MCP-edge's synthesized `ctx.auth`. Planning must define how MCP-issued tokens present to `ctx.auth` — neither of the existing apikey/cognito paths fits.

## v1 additions (gated on v0 adoption evidence)

These ship only after at least one non-author user has real weekly usage of v0 for two weeks:

- `wiki_read(pageId | slug)` — full page with sections, aliases, links. Ships when a caller has demonstrated wiki_search hits would benefit from drill-down.
- `wiki_backlinks(pageId)` — one-hop backlink traversal. Ships only if a concrete agent workflow is documented that requires it (not "parity with mobile UI" as justification).
- `get_context()` — returns `{tenantId, agentId, agentName, activeThreadId?}`. Ships only after the active-thread heuristic is resolved (what "active" means, whether retain auto-binds). Until then, tools requiring context use the synthetic external thread exclusively.
- Per-user multi-connection support (one MCP connection per external client instead of one total).

## Success criteria

### Connection & Auth
- Mobile self-serve connect flow completes end-to-end for a user who has ≥1 existing agent. "Happy path connect" in usability testing (N=5) succeeds on first attempt for ≥4 users.
- Rate limit enforcement verified: exceeding retain 30/min returns 429 with Retry-After within one second.
- Token revocation propagates within one access-token TTL (≤15 minutes) — verified by revoke + retry test.

### Retain behavior
- Calling `retain` on a learning surfaces it in the mobile "External memories" panel for that agent within one turn. It does NOT appear in the conversation thread view.
- Wiki page compile triggers within usual latency; external-origin retains are flagged in the compile output.
- Credential-redaction catches all common API key formats in a regression fixture before persistence.
- `retain` with an unowned threadId returns 403.

### Recall / Search behavior
- `memory_recall` on a query about past ThinkWork memory returns ≥1 scored result for matching content; results include `source` tag when external-origin.
- `wiki_search` returns hits matching the existing resolver output shape.
- Cross-tenant test fixture: token for user A cannot retrieve user B's memory or wiki content (tested at both MCP edge and adapter/resolver layers).

### Adoption (v0 → v1 gate)
- At least one non-author ThinkWork user performs ≥5 retain or recall calls per week over two consecutive weeks. Measured via per-connection tool-call logs.

### Stability
- No regression in `memory-retain` Lambda latency or `/wiki` resolver latency for native ThinkWork agents.
- Zero new admin configuration surface.

## Open questions for planning

1. **Authorization server** — Cognito extension + DCR proxy, or dedicated issuer? Drives token signing, scope model, and how MCP-issued tokens present to `ctx.auth` in GraphQL.
2. **Deployment topology** — new Lambda (Function URL), co-located with graphql-http, or container (AgentCore Runtime / ECS)? Streamable-HTTP's SSE-like flushing interacts differently with each.
3. **Connection persistence schema** — new user-level connections table vs. inverted `agent_mcp_servers` pattern. Needs a design before implementation.
4. **Synthetic external thread provenance** — should the virtual thread (one per user×agent×clientId) become a real row in `threads`, or remain synthetic with memory records only? Affects activity timeline and mobile thread lists.
5. **Wiki-compile handling of external-origin retains** — include in compile by default, or gate behind a per-tenant flag? Default to include if tenant already has `wiki_compile_enabled`; confirm.
6. **Mobile UI: "External memories" panel** — where does it live in the agent detail screen? What's shown per row? How does a user revoke and delete at the connection level?
7. **Activity timeline attribution for external retains** — v0 minimum is the `source` tag; the UI surface is v1 polish.

## Out-of-scope follow-ups worth noting

- Multi-agent retain override (`list_agents` + agent parameter) — deferred unless real multi-project user need appears.
- `memory_forget` — intentionally deferred.
- Direct `wiki_upsert` — intentionally deferred; retain → compile is sufficient.
- Reflect support across adapters — deferred; skip until parity exists.
- stdio transport — deferred.
- Hindsight ↔ AgentCore backend migration for external-origin retains — assumed to follow the same path as native retains; verify in planning.
