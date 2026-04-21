---
name: User-Scoped Memory + Wiki Migration
description: Collapse memory and wiki ownership from agent-scoped to user-scoped so that one user has one brain; delete the user-facing "agent" concept and reserve "subagent" for future specialists.
date: 2026-04-20
status: ready-for-planning
supersedes-parts-of:
  - docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md  # "agent picker at connect time" section and related scoping language
related:
  - docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md  # unaffected by owner change; benefits from one-brain-per-user framing
---

# User-Scoped Memory + Wiki Migration

## Problem

Memory and wiki in ThinkWork are scoped by agent (`owner_type: "agent"`, `owner_id → agents.id`). Every user has exactly one agent today, and there are no real multi-agent users. The agent-as-owner abstraction is speculative flexibility we have not redeemed, and it creates friction everywhere it shows up:

- **MCP exposure** forces an "agent picker at connect time" (see [docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md](./2026-04-20-thinkwork-memory-wiki-mcp-requirements.md)) and a "Claude Code augments my chosen ThinkWork agent's brain" mental model that does not match how users think about their own knowledge.
- **Mobile UX** renders an `AgentPicker` for a list that always has exactly one entry.
- **Compiler and adapters** (Hindsight bank IDs, AgentCore namespaces) key specialization assumptions off a dimension nobody varies.
- **Cross-agent reasoning** ("what did I learn last month" regardless of which agent captured it) is structurally impossible, and nothing in the current pipeline wants it to stay impossible.

Nothing is in production. No user has accumulated data worth preserving. The migration cost is one-shot.

## Decision

1. **Memory and wiki become user-scoped.** Owner is the user. One brain per user.
2. **The user-facing "agent" concept is removed.** No agent picker, no "my agent" UX. The user interacts with "ThinkWork."
3. **"Subagent" is reserved for a future concept.** If specialists-sharing-a-brain ever become useful (a coding subagent vs. a writing subagent pulling from the same user memory), introduce a fresh primitive then. Do not preserve `agents` as a vestigial persona table in anticipation.
4. **Internal system agents (memory-manager, eval runner, etc.) are unaffected.** They are infrastructure, not user primitives. Whether they remain rows in `agents` or move elsewhere is a planning decision, not a brainstorm decision.

## What changes

### Memory pipeline

- `MemoryOwnerRef.ownerType` collapses — owner is always the user. The `ownerType` discriminator can be dropped or retained as a single-valued literal; planning decides.
- `memory-retain` handler accepts `userId` (not `agentId`) and scopes the retain to `(tenantId, userId, threadId)`.
- `recall-service` scopes recall to `(tenantId, userId)`.
- **Strands runtime container** (`packages/agentcore-strands/agent-container/api_memory_client.py`) must flip its retain payload from `{tenantId, agentId, threadId, messages}` to `{tenantId, userId, threadId, messages}`, reading `USER_ID` from the container env that `server.py` already stashes. Container image rebuild and Lambda redeploy must be coordinated to avoid a skew window where the wire format does not match.
- **Hindsight adapter**: one bank per user. Bank naming changes from agent-slug-derived to user-derived (users have no `slug` column today; the bank-naming scheme is an open question — see below).
- **AgentCore adapter**: namespace prefix becomes user-derived (e.g. `user_${userId}`) instead of `assistant_${agentId}`.
- **Journal-import path** (`packages/api/src/lib/wiki/journal-import.ts`) and the `bootstrapJournalImport` GraphQL mutation flip from `agentId`/`ownerType: "agent"` to `userId`/user scope in the same cutover.
- Existing Hindsight banks and AgentCore namespaces are discarded on migration; see Migration sequence for ordering. No data preservation.

### Wiki schema

Owner semantics flip across the four wiki tables that carry `owner_id` directly: `wiki_pages`, `wiki_compile_jobs`, `wiki_compile_cursors`, `wiki_unresolved_mentions`. Related tables (`wiki_page_sections`, `wiki_page_aliases`, `wiki_page_links`, `wiki_section_sources`) inherit scope via `page_id` cascade and require no FK change.

- `owner_id` references `users.id` instead of `agents.id`. All composite indexes keyed on `(tenant_id, owner_id)` are recreated.
- Slug uniqueness tuple becomes `(tenant, user, type, slug)`.
- `wiki_compile_cursors` primary key becomes `(tenant_id, user_id)`.
- Existing rows are dropped as part of the migration (acceptable because nothing is in production; see Migration sequence below). For any dev/staging data that must be preserved during cutover, the user is derived via `agents.human_pair_id`; rows where `human_pair_id` is null are dropped.

### Compiler

- One compile job scope per `(tenant, user)`. The hierarchical aggregation work in [docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md](./2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md) is unaffected in mechanics and is in fact cleaner under user scope — one user's whole knowledge graph compiles as one graph, not fragmented across agents.
- `listRecordsUpdatedSince({ tenantId, ownerId: userId })` replaces the agent-scoped variant.

### GraphQL

- Every wiki and memory resolver that currently takes `agentId` and looks up the agents table flips to `userId`. Concretely this is everything under `packages/api/src/graphql/resolvers/wiki/` (`wikiSearch`, `wikiPage`, `wikiGraph`, `wikiBacklinks`, `compileWikiNow`, `bootstrapJournalImport`, etc.) and everything under `packages/api/src/graphql/resolvers/memory/` that touches retain/recall (`captureMobileMemory`, `deleteMobileMemoryCapture`, `mobileMemoryCaptures`, `mobileMemorySearch`, `mobileWikiSearch`, `memorySearch`, `memoryRecords`, `recentWikiPages`).
- The `ownerId` argument either becomes `userId` outright or stays as `ownerId` with documented user semantics — planning decides based on schema breakage tolerance. Either choice requires coordinated regeneration of `apps/mobile/lib/graphql-queries.ts`, `apps/admin/src/lib/graphql-queries.ts`, and `apps/cli/src/gql/graphql.ts` in the same PR; the "not externally consumed" claim does not apply to the in-repo clients.
- `assertCanReadWikiScope` is replaced with a composite check: `ctx.auth.tenantId == args.tenantId AND ctx.auth.principalId == args.userId`. Tenant match alone is insufficient — within a multi-user tenant it would allow any member to read any other member's wiki by supplying a valid `userId`. The exact check definition must be in the plan before the schema migration lands.
- MCP-issued tokens resolve to `(tenantId, userId)` in `ctx.auth`; agent resolution disappears from the auth path. **Prerequisite:** Cognito pre-token trigger that populates `userId` into access-token claims, OR a `resolveCallerUserId(ctx)` server-side fallback that maps Cognito `sub` → `users.id`, mirroring the existing `resolveCallerTenantId` pattern. Until one of these lands, MCP auth cannot rely on `ctx.auth.userId` being populated for Google-federated sessions.

### Mobile

- `AgentPicker` is removed from user-facing screens. Agent detail screen (if it survives as a config surface) is demoted to "ThinkWork settings" or similar.
- Memory and wiki views are user-scoped, not agent-scoped. The "External memories" panel referenced in the MCP requirements doc lives at the user level.
- Threads reparent to the user. A thread is `(tenant, user, thread)`, not `(tenant, agent, thread)`.

### Admin

- Agent management UI either disappears or narrows to internal-service inspection (memory-manager health, eval-runner status). It is no longer a place a user goes to configure "their agent."
- User-scoped memory and wiki admin surfaces (if any) replace the agent-scoped ones.

### MCP requirements doc (revision, not replacement)

The MCP requirements doc stays the authoritative source for OAuth topology, credential redaction, rate limiting, TLS/transport, and cross-tenant defense-in-depth (~70% of the plan's durable value is unaffected). These sections need revision after this migration:

- **Access model** — delete "Agent picker at connect time" and "one existing ThinkWork agent as the memory target." Connection binds to `(tenantId, userId, clientId)`.
- **Retain surface** — remove `agentId` from every tool-input/response shape and from the synthetic thread derivation (`uuidv5(namespace, userId:clientId)` synthetic thread, no agent).
- **v0 tool surface** — tools scope to `(tenantId, userId)` throughout; credential scrubbing applies to all string fields in the retain input (content AND each element of `tags[]`), not just content.
- **Mobile display rule** — "External memories" panel lives under the user, not under the agent.
- **Wiki-compile handling of external-origin retains** — resolved toward **opt-in, not opt-out**. Poisoning one user's whole brain via a bad external retain is a bigger blast radius than poisoning one agent's brain under the old scope. The old MCP doc's open question 5 ("include in compile by default, or gate") pre-resolves to "default-off; user flips per-client or per-tenant."
- **Open question 1 (authorization server)** — unchanged in substance, but token claims include `userId` not `agentId`.

**Sequencing constraint:** Do not ship MCP v0 against agent-scoped memory and then migrate external-origin retains during the refactor. Shipping MCP-first creates a forced data rewrite under live external-origin traffic; delaying MCP until after the user-scoped migration is strictly better. The MCP plan (`docs/plans/2026-04-20-008-feat-memory-wiki-mcp-server-plan.md`) must be paused past its schema units until this migration lands or explicitly scoped to land after.

## Migration sequence

Data lives in three places (Postgres wiki tables, Hindsight's `hindsight.memory_units` schema, AgentCore Memory as AWS-side namespaces). Discard ordering:

1. **Drop FKs** on the four wiki-owning tables that reference `agents.id` so subsequent truncations don't cascade unexpectedly.
2. **Truncate** `wiki_pages`, `wiki_compile_jobs`, `wiki_compile_cursors`, `wiki_unresolved_mentions` (sections/aliases/links/sources cascade via `page_id`).
3. **Wipe Hindsight** rows in `hindsight.memory_units` for the discarded bank IDs. Do not rely on local row removal alone — the external Hindsight service holds the data and must receive explicit deletion calls; local FK drop is insufficient.
4. **Delete AgentCore namespaces** via the Bedrock AgentCore SDK for each namespace being abandoned. These are cost-bearing resources; silent orphaning leaves live data queryable under the old namespace URIs.
5. **Swap schema** to user-scoped FKs and indexes; recreate constraints.
6. **Redeploy** memory-retain Lambda, GraphQL API, Strands container image, and mobile/admin clients as a coordinated rollout.

Partial-failure behavior must be documented: if step 3 or 4 fails, the migration is incomplete and rollback is a design decision (retry-only vs. restore agent-scoped FKs).

## Non-goals (v0)

- **Backward compatibility with agent-scoped data.** Migration drops existing wiki pages, compile jobs, cursors, unresolved mentions, and memory banks. Nothing is in production; this is acceptable.
- **Subagents / multi-persona per user.** Explicitly deferred. Do not pre-build the primitive.
- **Cross-user or cross-tenant memory federation.** Tenancy isolation stays strict.
- **Preserving `agents` table as a persona surface.** If it survives at all, it is for internal system agents only.
- **Reflect parity across adapters.** Unchanged from the MCP doc; still out of scope.
- **Migrating Hindsight/AgentCore data in place.** Drop and recreate is the expected path.

## Success criteria

### Schema and data
- All five wiki-owning tables have `owner_id` referencing `users.id`; no remaining FK to `agents.id` from memory/wiki paths.
- Slug uniqueness and compile cursor keys are per-user.
- Fresh deploy produces zero orphaned rows referencing removed agent owners.

### Memory pipeline
- `memory-retain` invoked with `{tenantId, userId, threadId, messages}` persists successfully and surfaces in recall scoped to that user.
- Hindsight bank per user is created on first retain; AgentCore namespace per user resolves on first retain.
- `recall-service` returns scored results filtered to `(tenantId, userId)` with cross-user leakage test passing.

### Wiki pipeline
- Compile job runs per `(tenant, user)` and produces user-owned pages.
- Hierarchical aggregation (Austin restaurants walkthrough) produces expected hub and leaf pages under a user's wiki, unchanged in behavior beyond the scope key.
- `wikiSearch` and `wikiPage` return only the authenticated user's pages; cross-user fixture returns 403 / empty.

### MCP surface
- MCP connect flow contains zero agent selection. User connects and begins retaining/recalling immediately.
- `retain`, `memory_recall`, `wiki_search` tool shapes contain no `agentId` in inputs or outputs.
- External-origin retains surface on the user's "External memories" panel, not under any agent detail screen.

### Mobile
- `AgentPicker` is removed from all user-reachable screens.
- Memory and wiki views render at the user level with no agent context.
- Threads query and display correctly when re-keyed to user scope; thread list on mobile shows only the authenticated user's threads with no cross-user leakage (test depends on the thread-reparenting scope decision below).
- Golden-path flow (retain on mobile → recall on mobile → retain via MCP → recall on mobile sees it) works end-to-end.

### No regressions
- Internal system agents (memory-manager, eval runner, etc.) continue to operate. Their mechanics are not affected by user-facing agent removal.
- Compounding memory aggregation behavior ([docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md](./2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md)) produces equivalent or better results under user scope.

## Open questions for planning

1. **`agents` table disposition.** Fully drop? Keep for internal system agents only? If kept, does `agents.user_id` exist at all, or is the table strictly for system services with no user link?
2. **`MemoryOwnerRef.ownerType` discriminator.** Drop entirely, or retain as a single-valued literal (`"user"`) for future subagent introduction?
3. **Thread reparenting.** Do existing thread records (if any) move from agent ownership to user ownership via migration, or are threads dropped along with memory data?
4. **GraphQL field naming.** Rename `ownerId` → `userId` across wiki resolvers (breaking, but the graph is not externally consumed yet), or keep `ownerId` with redocumented semantics?
5. **MCP token claims.** Does the inbound-OAuth access token encode `userId` directly, or does it encode a session that resolves to `userId` server-side? Interacts with the authorization server decision in the MCP requirements doc.
6. **Admin surface for memory/wiki.** Is there a user-scoped admin view of memory and wiki, or does admin stop at tenant-level observability? User feedback ("user opt-in over admin config") suggests the latter.
7. **Test fixture and seed data.** Existing seeds reference agents. Planning defines new user-scoped seeds and updates integration tests accordingly.
8. **Future subagent concept.** Not a v0 question, but worth noting: when subagents eventually ship, do they own a slice of the user's brain (own memory/wiki subset), or are they read-through specialists (same brain, different response style)? The answer affects whether today's schema needs a hidden `subagent_id` column reserved.
9. **Cross-context scoping primitive.** A user working in Claude Code on a work project will have retains that surface in their personal-life recall under one-brain-per-user. Some users will want a scoping primitive sooner than a full subagent concept — candidates: `tags[]` on retain (already in the shape, used for filter-at-recall), per-client synthetic thread isolation, an explicit "workspace" concept. Does v0 need a minimum scoping primitive (e.g., recall filters by `source` tag), or is one-brain-per-user acceptable until subagents ship? The MCP surface will surface this friction first.
10. **Hindsight bank naming.** Users have no `slug` column. Options: (a) `bank_id = user_${userId}` using the UUID directly (loses human-readable names, requires no schema change), (b) add `users.slug` with a backfill rule. Pick before the Hindsight adapter refactor.
11. **Internal-agent-generated writes.** If `memory-manager` or `eval-runner` (system agents, `agents.source='system'`) appear to write memory or wiki today, under user scope the ownership rule must be stated: (a) system agents never write to user memory/wiki; (b) they write on behalf of a named user passed in the invocation payload and reject when absent. `wiki_pages.owner_id NOT NULL` becomes unsatisfiable otherwise.
12. **User-to-tenant cardinality invariant.** Is `users.id` globally unique with a single `tenant_id` per user (each human has N brains if they exist in N tenants), or can one Cognito identity span tenants with one brain? "Tenancy isolation stays strict" doesn't have meaning without this.
13. **Thread reparenting scope.** Three options: (a) add `threads.user_id` + drop `threads.agent_id`; (b) keep `threads.agent_id` for system agents only, add `user_id`; (c) drop the `threads` table and let memory-retain mint synthetic threads. Scope-guardian's view: thread reparenting is piggyback work, push to a separate follow-up and accept temporary inconsistency (memory/wiki user-scoped, threads still agent-keyed).

## Out-of-scope follow-ups worth noting

- Renaming the inherited ThinkWork vs. maniflow runtime naming follow-ups ([ThinkWork supersedes maniflow](../../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_thinkwork_supersedes_maniflow.md)) are a separate migration; do not bundle.
- MCP requirements doc revision is a small follow-up edit, not a rewrite.
- Admin-connectors removal ([docs/brainstorms/2026-04-20-remove-admin-connectors-requirements.md](./2026-04-20-remove-admin-connectors-requirements.md)) is complementary but independent.
