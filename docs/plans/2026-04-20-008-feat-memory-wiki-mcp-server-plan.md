---
title: "feat: Memory + Wiki MCP Server for External Agents"
type: feat
status: active
date: 2026-04-20
origin: docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md
---

# feat: Memory + Wiki MCP Server for External Agents

## Overview

Build a native MCP server that ThinkWork hosts, allowing external MCP clients (Claude Code, Cursor, etc.) to retain and recall against a ThinkWork user's chosen agent, and search their compiled wiki — per-user via OAuth 2.1. v0 ships three tools: `retain`, `memory_recall`, `wiki_search`. v1 additions are gated on an adoption metric.

This is greenfield on the server side — the repo has rich MCP *client* infrastructure but no inbound MCP server. A new dedicated OAuth 2.1 issuer (AgentCore Identity, federated to Cognito) fronts the MCP resource server; the inbound MCP Lambda validates bearer tokens, enforces per-user rate limits, runs credential redaction on retained content, and routes through the existing `memory-retain` Lambda, `recall-service`, and `wikiSearch` resolver without modifying their user-facing behavior.

## Problem Frame

External agents (Claude Code et al.) have rich contextual awareness of a user's current code/conversation but no durable cross-session memory beyond local files. ThinkWork already has the memory + wiki pipeline users want — it's invisible to anything that isn't a ThinkWork agent. A user on mobile should be able to opt in, pick an existing agent, and start retaining from their IDE. See `docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md`.

## Requirements Trace

- **R1.** v0 exposes three tools — `retain`, `memory_recall`, `wiki_search` — over streamable-HTTP with per-user OAuth (see origin: Users and validation approach; v0 tool surface).
- **R2.** External-origin retains carry a `source: "external-mcp"` provenance tag through the entire pipeline (memory-retain → Hindsight/AgentCore → wiki compile → mobile UI) (origin: v0 tool surface, `retain` surface detail).
- **R3.** Inbound OAuth 2.1 is spec-compliant: PKCE S256, RFC 8707 audience-bound tokens, RFC 9728 Protected Resource Metadata, DCR (or CIMD) for client onboarding, ≤15 min access token TTL, refresh rotation (origin: Inbound OAuth).
- **R4.** External-origin retains render only in a new "External memories" panel on mobile — never as user messages in the conversation view — tagged with the connected client's name (origin: Mobile display rule).
- **R5.** `retain` passes content through a credential-redaction pass (common API key regex bank) before invoking `memory-retain`. Redactions are counted for observability; content is never logged (origin: Content safety).
- **R6.** Caller-supplied `threadId` is validated against the connected `(userId, agentId)`; unowned → 403. When unsupplied, the server mints a server-minted synthetic thread per `(userId, agentId, clientId)` — never caller-controlled (origin: `retain` surface detail).
- **R7.** Tenant scoping is defense-in-depth: MCP edge enforces bound context, memory adapters independently re-enforce `(tenantId, agentId)`, and wiki resolvers independently re-enforce `(tenantId, userId)` (origin: All tools scope…).
- **R8.** Rate limiting is enforced at the edge: retain 30/min, recall/search 60/min per `(userId, agentId)`, 429 with `Retry-After` on breach (origin: Inbound OAuth).
- **R9.** `memory-retain` is invoked **RequestResponse** (not fire-and-forget) so tool-call errors surface to the caller (origin: `retain` surface detail; aligns with the repo's "avoid fire-and-forget for user-driven writes" rule).
- **R10.** `memory_recall` calls `recall` only — never `reflect` — given adapter capability disparity. Per-result size capped at 2 KB (origin: `memory_recall` surface detail).
- **R11.** `wiki_search` response shape matches the existing `wikiSearch` resolver output verbatim (origin: `wiki_search` surface detail).
- **R12.** TLS 1.2+ required; plaintext HTTP rejected (origin: Non-goals — transport).
- **R13.** Mobile self-serve connect flow: user picks an existing agent at connect time; no admin configuration (origin: Access model).
- **R14.** v1 features (`wiki_read`, `wiki_backlinks`, `get_context`, per-client multi-connection) ship only after ≥1 non-author user does ≥5 tool calls per week for 2 weeks (origin: Success criteria — Adoption).
- **R15.** Verified cross-tenant fixture: token for user A cannot retrieve user B's memory or wiki content — tested at both MCP edge and adapter/resolver layers (origin: Success criteria — Cross-tenant test).

## Scope Boundaries

- **No wiki write tools** in this plan (`wiki_upsert`, page create/update, annotation). Wiki updates remain downstream of retain via async compile.
- **No `memory_forget`** — intentionally deferred.
- **No per-call agent override** — users retarget by reconnecting, not per-invocation.
- **No cross-agent / cross-tenant federation**, teams, or shared memory banks.
- **No stdio transport** — streamable-HTTP only.
- **No meta-tools** for listing other MCP servers.
- **No reflect support** — adapter parity is uneven; skip until both adapters expose it.

### Deferred to Separate Tasks

- **v1 read tools (`wiki_read`, `wiki_backlinks`, `get_context`)** — separate plan once adoption gate passes. Schema/transport established by this plan supports their addition without refactor.
- **Per-client multi-connection** — separate plan. v0 allows one active inbound MCP connection per user total.
- **Activity timeline UI attribution for external retains** — v0 stores the `source` tag; UI surface is a follow-up mobile/admin plan.
- **Bedrock Guardrails redaction upgrade** — v0 ships regex-based credential scrubber; Guardrails is a v1 enhancement.
- **Hindsight ↔ AgentCore backend migration for external-origin retains** — assumed to follow native-retain path; verify and formalize as separate plan if migration happens.

## Context & Research

### Relevant Code and Patterns

- **Memory pipeline**: `packages/api/src/handlers/memory-retain.ts` (internal-only Lambda, IAM-invoked), `packages/api/src/lib/memory/index.ts` (`getMemoryServices` memoized factory), `packages/api/src/lib/memory/adapter.ts` (adapter contract), `packages/api/src/lib/memory/recall-service.ts` (token-budget trimming + limits already implemented), `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` + `agentcore-adapter.ts`.
- **Wiki resolvers**: `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts`, `packages/api/src/graphql/resolvers/wiki/auth.ts` (`assertCanReadWikiScope` with `apikey` + `cognito` auth branches — MCP needs a third path or synthesized `ctx.auth`).
- **Existing OAuth pattern to mirror (but invert — we're now the AS/RS, not the client)**: `packages/api/src/handlers/skills.ts:332-600` (outbound RFC 9728 / 8414 / 7591 flow for the mobile MCP-connect UI).
- **Cognito JWT verification**: `packages/api/src/lib/cognito-auth.ts` via `aws-jwt-verify`. Pattern to copy for validating tokens from the dedicated issuer (swap issuer + JWKS URL).
- **Lambda conventions**: all handlers in `packages/api/src/handlers/*.ts`; wiring in `scripts/build-lambdas.sh` + `terraform/modules/app/lambda-api/handlers.tf`; env via `local.common_env`; cross-Lambda invoke allow-list in `terraform/modules/app/lambda-api/main.tf:417`; memory-retain ARN already published at SSM `/thinkwork/{stage}/memory-retain-fn-arn`.
- **No existing rate-limit middleware** anywhere in the repo — this plan introduces it.
- **Only existing redaction helper**: `packages/api/src/handlers/webhooks.ts:53-72` `redactHeaders()` — whitelist-style, not applicable to body-content scrubbing; we factor a new shared redaction lib.
- **Drizzle schema convention**: one file per domain in `packages/database-pg/src/schema/*.ts`, barrel export from `schema/index.ts` (e.g., `mcp-servers.ts` is the outbound sibling).
- **Mobile settings pattern**: `apps/mobile/app/settings/mcp-servers.tsx` (outbound), to be joined by a new inbound-connected-clients screen.

### Institutional Learnings

Zero matches in `docs/solutions/` — this is greenfield for institutional knowledge. Capture learnings back into `docs/solutions/` as the server ships. Auto-memory items that directly prevent foreseeable mistakes:

- **Avoid fire-and-forget Lambda invokes for user-driven writes** — `retain` MUST be RequestResponse.
- **`ctx.auth.tenantId` is null for Google-federated users** — defense-in-depth tenant scoping must use `resolveCallerTenantId(ctx)` fallback until a pre-token tenantId trigger lands.
- **pnpm only** inside the workspace; never npm.
- **Deploy via PR → main** (never direct `aws lambda update-function-code`).
- **Read diagnostic logs literally** — token/code length diagnostics matter.

### External References

- [MCP Authorization Spec (2025-06-18+)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) — target server behavior.
- [MCP Auth Spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) — DCR dropped to MAY; CIMD preferred path.
- [RFC 9728 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728), [RFC 8707 Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707), [RFC 7591 DCR](https://datatracker.ietf.org/doc/html/rfc7591).
- [`@modelcontextprotocol/sdk` TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) — pin `^1.29.0`; avoid v2 until stable.
- [AWS Lambda Response Streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html) — Function URLs only; NOT needed for stateless streamable-HTTP tool calls.
- [AWS Bedrock AgentCore Identity — DCR reference](https://jonathanpenny.com/blog/oauth-dcr-aws-bedrock-agentcore/), [agentcore-dcr shim](https://github.com/stache-ai/agentcore-dcr).
- [Drizzle ORM migrations](https://orm.drizzle.team/docs/migrations) — switch from `db:push` to `generate+migrate` for these tables.

## Key Technical Decisions

- **Authorization server: AWS Bedrock AgentCore Identity** as the dedicated OAuth 2.1 issuer, federated to Cognito for user identity. Rationale: spec-compliant DCR + RFC 8707 out of the box; AWS-resident (keeps the stack inside AWS — same account boundary as existing AgentCore Memory + Evals infra); avoids stretching Cognito with two load-bearing Lambda shims (`aud` rewrite + DCR proxy); audit trail is cleaner for public MCP. Federation glue and tenantId-claim-propagation are the acceptable carrying cost. WorkOS is a contingency only if AgentCore Identity DCR is region-blocked or unavailable at build time. (Chosen by user; see origin open question 1.)
- **Transport: stateless streamable-HTTP behind HTTP API Gateway** (the repo's existing deployment pattern). Stateless avoids session state in Lambda; every request carries Bearer. No Function URL response streaming — unnecessary for short request/response tool calls, and Function URL + VPC does not stream (would break RDS access).
- **Resource server: new Lambda handler** `packages/api/src/handlers/mcp-server.ts` using `@modelcontextprotocol/sdk` v1.x. Tools call existing backends directly: `retain` invokes `memory-retain` Lambda RequestResponse; `memory_recall` calls `getMemoryServices()` + `createRecallService`; `wiki_search` imports the resolver function and calls it with a synthesized `ctx` object.
- **Auth context propagation via synthesized GraphQL ctx**: since `assertCanReadWikiScope` expects `ctx.auth` matching the `AuthResult` interface (`packages/api/src/lib/cognito-auth.ts`: `{ principalId, tenantId, email, authType }`), the MCP handler synthesizes `{ principalId: <Cognito sub>, tenantId, email: null, authType: "cognito" }`. `principalId` MUST be the user's Cognito sub (not AgentCore Identity's internal subject) so `resolveCallerTenantId(ctx)` fallback resolves correctly for Google-federated users. No new auth branch in the resolver — we adapt at the MCP edge.
- **Rate limiting: two-layer.** Lambda authorizer (REQUEST type) enforces a **per-user floor** (e.g., 90/min across all tools) using DynamoDB counters — authorizer runs on every call (no cache of allow-decisions) so revocation and rate changes take effect immediately. **Per-tool buckets** (`retain` 30/min, read 60/min) are enforced inside the MCP handler after tool dispatch name is known — API Gateway v2 REQUEST authorizers do not receive the JSON-RPC body, so the tool name is unavailable at authorize-time. IP-level floor via WAF rule attached to the API stage if WAF is already provisioned; otherwise deferred.
- **Credential redaction: regex-based scrubber** in v0, in a new shared lib `packages/api/src/lib/redaction/`. Handles OpenAI `sk-`, AWS `AKIA`/secret-key patterns, GitHub `ghp_`/`ghs_`, generic JWT, Slack `xox[bpaors]-`, Anthropic `sk-ant-`, and PEM blocks. Redaction counts logged as CloudWatch metric; original content never logged. Bedrock Guardrails upgrade is v1.
- **Provenance: `source` field on the retain payload envelope**, propagated through memory-retain → adapter → wiki compile. Existing envelope accepts a `metadata` field; extend its shape non-breakingly.
- **Synthetic thread: stays synthetic (no row in `threads`)** in v0. One virtual thread per `(userId, agentId, clientId)`. Identifier is `uuidv5(namespace, userId + ':' + agentId + ':' + clientId)` — deterministic UUIDv5 with a server-held namespace. Never expose raw component UUIDs to the caller; response returns only the UUIDv5 handle so external clients do not learn the user's or agent's internal UUIDs. If v1 needs visibility in the existing thread surfaces, promote to a real row; the UUIDv5 is already a valid UUID.
- **Connection persistence: new Drizzle table `inbound_mcp_connections`** (one row per user, bound to an agent at connect time, revocable). Distinct from existing `user_mcp_tokens` (outbound) by table, not by flag — keeps outbound/inbound schemas independent.
- **Migration path: switch the new tables to `drizzle-kit generate` + reviewable SQL**, leaving existing `db:push` workflow intact for other tables. This plan is the trigger to switch for auth-adjacent tables.
- **Wiki compile gating**: external-origin retains flow through the existing pipeline unchanged if the tenant already has `wiki_compile_enabled=true`. No new per-tenant toggle in v0. The `source` tag is preserved so v1 can add a toggle without data backfill.
- **TLS enforcement**: handled at API Gateway level (managed ACM cert on the stage). Plaintext rejected by default; explicit HSTS header on PRM response.

## Open Questions

### Resolved During Planning

- **Auth server choice** — resolved to dedicated issuer (user-selected).
- **Transport** — stateless streamable-HTTP on HTTP API Gateway; Function URL response streaming not needed.
- **Connection persistence schema** — new Drizzle table, `inbound_mcp_connections`, not a flag on existing tables.
- **Synthetic thread provenance** — stay synthetic (no `threads` row) in v0.
- **Wiki compile gating** — default-on if tenant already enabled; no new toggle.
- **MCP SDK version pin** — `@modelcontextprotocol/sdk` `^1.29.0`.

### Deferred to Implementation

- **AgentCore Identity region + DCR support verification** — confirm at Unit 1 kickoff that our AWS region supports AgentCore Identity with DCR enabled. WorkOS is contingency only if blocked.
- **Tenant claim propagation** — whether tenantId is on the Cognito ID token (federated user), injected by the issuer, or resolved via a post-auth DB lookup. Implementation will wire the simplest path that satisfies defense-in-depth.
- **Exact DynamoDB table design** for rate counters (partition key shape, sliding-window vs fixed-window) — pick during Unit 5.
- **WAF rule presence** on the API Gateway stage today — check at Unit 10; if WAF is absent, defer the IP-floor layer and rely on authorizer counters.
- **Mobile "Connect Claude Code" launch mechanism** — deep link vs. web-redirected flow. Depends on external clients' OAuth initiation conventions; probe empirically at Unit 13.
- **Exact `memory-retain` turn envelope fields** — the plan assumes `metadata` is extensible; verify during Unit 4 before serializing.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Request flow (retain example):**

```
Claude Code --[POST /mcp  (Bearer aud=mcp.thinkwork...)]-->
  API Gateway --> Lambda authorizer
                     |
            checks JWT (iss, aud, exp, sub)
            checks + increments DynamoDB rate counter
                     |
            allow (injects userId, agentId, tenantId, clientId into request context)
                     v
  MCP Lambda (packages/api/src/handlers/mcp-server.ts)
    StreamableHTTPServerTransport.handleRequest()
      -> tool dispatch: 'retain'
        -> credential redaction (regex scrub content)
        -> build synthetic turn envelope { source: 'external-mcp', clientId, threadId, tagged content }
        -> validate threadId ownership (DB lookup, 403 on mismatch)
        -> InvokeCommand memory-retain, InvocationType=RequestResponse
        -> receive ok + memoryId
        -> return { ok, memoryId, agentName, threadId, wikiCompilePending: true }
```

**Read flow (memory_recall):**

```
Lambda authorizer -> MCP handler
  -> tool: 'memory_recall'
    -> getMemoryServices() (memoized per container)
    -> createRecallService({ adapter, limit })
    -> recallService.recall({ tenantId, agentId, query })
    -> clamp per-result size to 2KB
    -> return { results: [...] }
```

**OAuth topology:**

```
+--------------+                 +----------------------+
| Claude Code  |--1. discover--> | MCP Lambda           |
|              |<--PRM doc------ | /.well-known/...     |
|              |                 +----------------------+
|              |--2. register--> +----------------------+
|              |                 | AS (AgentCore ID)    |
|              |<--authorize---- |                      |
|              |--3. /authorize->|                      |
|              |<--redirect----- |                      |
| (user on     |--user authN---> |                      |<--federate-- Cognito + Google
|  mobile web) |--consent------> |                      |
|              |--4. code------->| /token (PKCE verify) |
|              |<--access tok--- |                      |
|              |  (aud=mcp...,   |                      |
|              |   tenantId)     |                      |
|              |                 +----------------------+
|              |
|              |--5. MCP calls-->+----------------------+
|              |  Bearer to      | MCP Lambda (RS)      |
|              |  mcp URL        |   verifies aud       |
|              |                 |   enforces rate lim  |
|              |                 |   dispatches tool    |
+--------------+                 +----------------------+
```

## Implementation Units

### Phase A — Foundation (land before the MCP handler)

- [ ] **Unit 1: AgentCore Identity — provision and federate**

**Goal:** Stand up AWS Bedrock AgentCore Identity as the OAuth 2.1 issuer, federated to the existing Cognito user pool. Issue JWTs with `aud=<MCP canonical URI>` when the MCP client requests `resource=<MCP canonical URI>`. Support DCR (RFC 7591). WorkOS is a contingency only if AgentCore Identity lacks DCR in our region at build time.

**Requirements:** R3, R13.

**Dependencies:** none.

**Files:**
- Create: `terraform/modules/foundation/agentcore-identity/main.tf`.
- Modify: `terraform/modules/foundation/cognito/main.tf` — wire federation (issuer consumes Cognito as IdP).
- Modify: `terraform/examples/greenfield/main.tf` — add the module instance.
- Create: `docs/runbooks/mcp-oauth-server.md` — operator runbook.

**Approach:**
- Confirm AgentCore Identity region + DCR support on build kickoff. If blocked, switch to WorkOS (contingency only).
- Issuer exposes `/.well-known/oauth-authorization-server` (RFC 8414) and accepts RFC 8707 `resource` parameter.
- Federation: AgentCore Identity's IdP configured as Cognito; Cognito continues to handle user authN (email + Google OAuth).
- Tenant claim: surface `tenantId` as a custom claim on the access token. Primary path: post-authN hook on AgentCore Identity that reads `users.tenant_id` via RDS Data API by `sub` (Cognito sub → users.id mapping). **Validate Aurora Data API is enabled on our cluster during Unit 1 kickoff**; if disabled or unavailable from AgentCore managed compute, fall back to authorizer-side tenantId resolution (mirror the existing `resolveCallerTenantId(ctx)` pattern via a VPC-attached Lambda) — tokens ship without `tenantId` claim and authorizer resolves by `sub`.
- Configure access token TTL to 15 minutes (900s) and refresh-token rotation on each use at issuer level (satisfies R3).
- Test with a scripted MCP client that does DCR + `authorization_code` + PKCE S256 + `resource` indicator.

**Patterns to follow:** existing Cognito provisioning in `terraform/modules/foundation/cognito/main.tf`.

**Test scenarios:**
- Happy path: DCR POST to `/register` returns `client_id` + `registration_access_token`; `/authorize` with valid PKCE + `resource` returns code; `/token` returns JWT with `aud=<MCP URI>` and custom `tenantId` claim.
- Error path: `/authorize` with `resource` missing or not matching allowed MCP URIs → error `invalid_target`.
- Error path: PKCE verifier mismatch → error `invalid_grant`.
- Edge case: expired registration_access_token cannot re-register the same client.
- Integration: JWT `iss` + JWKS endpoint reachable from the MCP Lambda's VPC (or public Internet egress path).

**Verification:**
- End-to-end scripted client can DCR, authorize, and receive a JWT with correct `aud` + `tenantId`.
- PRM doc hosted by MCP Lambda (Unit 6) points at this issuer and clients complete the handshake.

---

- [ ] **Unit 2: Drizzle schema — inbound MCP connections + rate counters**

**Goal:** Add DB tables for inbound MCP connections and (optionally) rate counters, and switch these tables to `drizzle-kit generate+migrate`.

**Requirements:** R13, R6, R8 (rate counters table).

**Dependencies:** Unit 1 unblocks issuer but schema does not depend on issuer.

**Files:**
- Create: `packages/database-pg/src/schema/mcp-inbound.ts` — `inboundMcpConnections` table; optionally `inboundMcpRateCounters` if DynamoDB is not chosen.
- Modify: `packages/database-pg/src/schema/index.ts` — re-export.
- Create: `packages/database-pg/drizzle/<timestamp>_inbound_mcp_connections.sql` — generated migration.
- Modify: `scripts/db-push.sh` — document that auth-adjacent tables use generate+migrate; keep `push` for other schemas.

**Approach:**
- `inboundMcpConnections`: `id UUID PK`, `tenant_id UUID FK tenants`, `user_id UUID FK users`, `agent_id UUID FK agents`, `client_id TEXT` (issuer's DCR-registered client id), `display_name TEXT` (user-supplied or client-metadata-derived), `created_at TIMESTAMPTZ`, `last_used_at TIMESTAMPTZ`, `revoked_at TIMESTAMPTZ NULL`. Unique index on `(user_id)` for v0 (one active connection per user; `revoked_at IS NULL`). Indexes on `(tenant_id, agent_id)` for wiki-compile joins and on `(client_id)` for authorizer lookups.
- Rate counters: DynamoDB is the chosen backend (see Unit 5 approach). No Postgres rate-counter table is added.
- Switch to `drizzle-kit generate`; produce reviewable SQL. Migration is idempotent. **Note on hybrid workflow:** `drizzle-kit push` and `generate+migrate` in the same schema config can conflict. Resolve by moving inbound auth tables to a dedicated drizzle config + sub-schema, OR committing fully to `generate+migrate` across the repo. Pick at Unit 2 kickoff; recommended: dedicated sub-config for auth tables.

**Patterns to follow:** `packages/database-pg/src/schema/mcp-servers.ts` (sibling outbound table structure).

**Test scenarios:**
- Happy path: insert connection for user A; unique index prevents a second active connection for user A.
- Happy path: revoke (`revoked_at = now()`) allows a new active connection for user A.
- Edge case: FK cascade — deleting the bound agent sets revoked_at (or rejects, depending on chosen FK rule; prefer RESTRICT + application-level cleanup for now).

**Verification:**
- Migration applies cleanly on dev DB; rollback script verified.
- Drizzle schema exports importable from `packages/api` without cycle.

---

- [ ] **Unit 3: Credential redaction library**

**Goal:** Shared scrubber used by the `retain` tool (and available to any future handler that persists user-supplied text).

**Requirements:** R5.

**Dependencies:** none.

**Files:**
- Create: `packages/api/src/lib/redaction/credential-scrubber.ts`.
- Create: `packages/api/src/lib/redaction/index.ts` — barrel export.
- Create: `packages/api/src/lib/redaction/credential-scrubber.test.ts`.

**Approach:**
- Regex bank for common credentials: OpenAI `sk-[A-Za-z0-9]{20,}`, Anthropic `sk-ant-[A-Za-z0-9\-_]{20,}`, AWS `AKIA[0-9A-Z]{16}` + adjacent secret-key pattern, GitHub `ghp_|ghs_|gho_|ghu_` + token body, generic JWT (three dot-separated base64url segments with `eyJ` prefix), Slack `xox[bpaors]-[A-Za-z0-9\-]{10,}`, PEM `-----BEGIN [A-Z ]+-----`-framed blocks.
- Function signature: `scrub(input: string) → { text: string, redactions: Record<string, number> }`. Replaces matches with `[REDACTED:<kind>]`. Never log `input` or `text` — only the `redactions` count.
- Expose an allow-list override for known-safe strings (off by default).

**Execution note:** Test-first — write the regex fixtures first, watch them fail, implement.

**Patterns to follow:** none local. Mirror lightweight testable Node libs elsewhere in `packages/api/src/lib/`.

**Test scenarios:**
- Happy path: input with one OpenAI key → scrubbed text, `{ openai: 1 }`.
- Happy path: input with multiple credentials of mixed kinds → all redacted, counts by kind correct.
- Edge case: empty string → empty, no redactions.
- Edge case: input with near-miss patterns (e.g., `sk-notakey`) → unchanged.
- Edge case: Unicode content mixed with ASCII key → key redacted, Unicode preserved.
- Edge case: very long content (>100KB) — function returns in linear time; fixture asserts runtime under 50ms.
- Error path: non-string input → throws `TypeError` (defense-in-depth).

**Verification:**
- Vitest suite passes with 100% of the regex-bank kinds covered.
- Regression fixture of at least 8 credential types (one per kind in the bank) lives in the test file for future kind-additions.

---

- [ ] **Unit 4: Retain envelope provenance (`source: "external-mcp"`) plumbing**

**Goal:** Extend the retain payload envelope to carry `source` + `clientId` through `memory-retain` → adapters → wiki compile unchanged behavior, changed surface only.

**Requirements:** R2.

**Dependencies:** none.

**Files:**
- Verify (no code change expected): `packages/api/src/handlers/memory-retain.ts` already forwards `event.metadata` to `adapter.retainTurn()`. Both `hindsight-adapter.ts` and `agentcore-adapter.ts` already spread `req.metadata` into their metadata sinks. Confirm empirically and add a characterization test.
- Modify: `packages/api/src/lib/memory/types.ts` — document `source` and `clientId` as reserved keys within `RetainTurnRequest.metadata`; add a runtime assertion that callers don't collide with reserved keys.
- Modify: `packages/api/src/lib/wiki/enqueue.ts` — no code change in v0 (compile still fires on every retain gated by `wiki_compile_enabled`). Add a comment pointing at the future branch point for source-based gating.
- Verify (downstream wiki-compile consumer): the wiki-compile Lambda (external to this repo or in a sibling package — confirm location at Unit 4 kickoff) receives the `source` tag via the memory record metadata. For v0, no branching; v1 may add a gate.

**Approach:**
- Keep existing behavior identical for native callers; `source === undefined` means "not external".
- Add assertions that `metadata` does not collide with reserved keys.
- Do not change the wire format for existing callers (strands runtime, chat-agent-invoke).

**Execution note:** Characterization first — add a test that captures current retain envelope shape before modifying.

**Patterns to follow:** existing `metadata` pass-through in chat-agent-invoke retain calls.

**Test scenarios:**
- Characterization (pre-change): existing retain call with no `source` metadata still works identically; shape unchanged.
- Happy path: retain with `metadata.source = "external-mcp"` is persisted on Hindsight record.
- Happy path: same on AgentCore adapter.
- Edge case: `metadata` is `null` or missing — default to omit.
- Integration: end-to-end with a real Hindsight bank fixture (if available in test env) — tag round-trips through recall.

**Verification:**
- Unit tests on adapter pass-through.
- Existing Vitest suite still green.
- Manual spot-check against a dev Hindsight instance confirms tag visibility.

---

- [ ] **Unit 5: Rate limit Lambda authorizer + DynamoDB counter table**

**Goal:** Lambda authorizer in REQUEST mode that validates the Bearer JWT, increments a per-user DynamoDB counter, and denies with `429` on breach. Attaches tool-bucket context (`retain` vs `read`) on the authorizer policy.

**Requirements:** R8, R3 (JWT validation), R7 (binds context).

**Dependencies:** Unit 1 (issuer — need JWKS URL and canonical `aud`).

**Files:**
- Create: `packages/api/src/handlers/mcp-authorizer.ts` — Lambda authorizer handler.
- Create: `packages/api/src/lib/mcp-server/jwt-verifier.ts` — shared verifier using `aws-jwt-verify` pointed at dedicated issuer's JWKS.
- Create: `terraform/modules/app/lambda-api/mcp-authorizer.tf` — DynamoDB table `inbound_mcp_rate_counters`, authorizer Lambda, API Gateway authorizer wiring, `resultTtlInSeconds = 0` (no authorizer cache).
- Modify: `scripts/build-lambdas.sh` — add `mcp-authorizer`.

**Approach:**
- JWT verifier via `aws-jwt-verify`: validate `iss`, `aud == <MCP canonical URI>`, `exp`, **`nbf`** (not-before), **`token_use: access`** (reject ID tokens with a distinct `WWW-Authenticate` error_description so Claude Code doesn't enter a re-auth loop), `sub` present. Configure `clockTolerance ≤ 30s`. Fetch JWKS with module-scoped cache.
- Extract `sub`, `tenantId`, `clientId` claims; look up `inboundMcpConnections` row by `(client_id, user_id, revoked_at IS NULL)` via RDS Data API — reject if none. **If `tenantId` claim is absent** (fallback mode when the post-authN hook is unavailable — see Unit 1), resolve via `users.id = sub` lookup during this authorizer call; authorizer MUST reject if neither path yields a tenantId.
- DynamoDB rate counter (per-user floor only, enforced here): partition key `userId`, sort key `minute-timestamp`. `UpdateItem` with `ADD count 1` conditional on `count < 90`. TTL on each row = 120s (auto-cleanup).
- **Per-tool bucket limits (retain 30/min, read 60/min) are NOT enforced here** — the authorizer cannot see the JSON-RPC body, so the tool name is unknown at authorize-time. Bucket enforcement moves into the MCP handler (Unit 6) before tool dispatch.
- **No authorizer cache** (`resultTtlInSeconds=0`). Every call re-validates the JWT + re-reads `inboundMcpConnections`. Revocation takes effect on the next call. Trades ~50-100ms per-call for instant revocation — acceptable for a pilot; revisit at v1 if scale requires caching.
- Return `context` dict with `userId` (Cognito sub), `tenantId`, `agentId`, `clientId` for the downstream MCP Lambda. MCP handler reads these ONLY from `event.requestContext.authorizer.lambda` — never from request headers.
- On revoked / not-found connection → 401; on rate-floor exceeded → 429 with `Retry-After`; on JWT validation failure → 401 with `WWW-Authenticate: Bearer resource_metadata="<PRM URL>"` and error_description naming the specific check that failed.

**Patterns to follow:** `packages/api/src/lib/cognito-auth.ts` for JWT verifier style; new file for DynamoDB atomic increment.

**Test scenarios:**
- Happy path: valid JWT, under limit → allow + context.
- Happy path: valid JWT, over retain limit, read call → allow (different bucket).
- Error path: JWT with wrong `aud` → 401.
- Error path: JWT for revoked connection → 401.
- Edge case: clock skew — token `exp` 30 seconds in the future still valid within skew tolerance.
- Edge case: rate window boundary — calls straddling minute boundary counted correctly.
- Integration: authorizer + API Gateway + MCP Lambda → end-to-end 200 for valid + 429 for exceeded.

**Verification:**
- Scripted load test: 31 retain calls in under a minute → first 30 succeed, 31st is 429 with Retry-After.
- Cross-tenant test: JWT with tenantId A cannot pass authorizer against a resource expecting B (authorizer injects tenantId, resource validates).

---

### Phase B — MCP Server

- [ ] **Unit 6: MCP server handler — SDK wiring, PRM endpoint, tool dispatch skeleton**

**Goal:** Land the MCP Lambda with `@modelcontextprotocol/sdk` stateless streamable-HTTP transport, the PRM endpoint, and a tool-dispatch skeleton. Tools themselves stubbed; Units 7-9 fill them in.

**Requirements:** R1, R3, R7, R12.

**Dependencies:** Unit 1 (issuer URL), Unit 5 (authorizer injected context).

**Files:**
- Create: `packages/api/src/handlers/mcp-server.ts` — Lambda handler adapting API Gateway event → MCP SDK transport.
- Create: `packages/api/src/handlers/mcp-oauth-prm.ts` — serves `/.well-known/oauth-protected-resource`.
- Create: `packages/api/src/lib/mcp-server/server.ts` — MCP server factory (`registerTool` wiring).
- Create: `packages/api/src/lib/mcp-server/context.ts` — build connection context from authorizer-injected headers.
- Create: `packages/api/src/lib/mcp-server/ctx-adapter.ts` — synthesizes a GraphQL-ctx-shaped object for `assertCanReadWikiScope`.
- Create: `packages/api/src/handlers/mcp-server.test.ts` — handler-level tests using mocked authorizer context.
- Modify: `scripts/build-lambdas.sh` — add `mcp-server` + `mcp-oauth-prm`.
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — add both Lambdas + routes (`POST /mcp`, `GET /.well-known/oauth-protected-resource`) + authorizer attachment for `/mcp`.
- Modify: `terraform/modules/app/lambda-api/main.tf` — add `memory-retain` to mcp-server's cross-invoke allow-list (new entry).
- Add: package.json dependency `@modelcontextprotocol/sdk` pinned **exactly** to `1.29.0` (no caret). Minor-version bumps have historically introduced transport-API breaks; manual bump procedure is: update pin, run Unit 14 e2e suite, merge if green.

**Approach:**
- Handler adapts API Gateway v2 proxy event → Node `IncomingMessage`-shaped shim consumable by `StreamableHTTPServerTransport.handleRequest`. Stateless (`sessionIdGenerator: undefined`). Also wire a `GET /mcp` route that returns 405 with a JSON-RPC error body naming stateless mode, so clients that optimistically open an SSE GET leg fail fast with a clear signal.
- PRM endpoint returns `{ resource, authorization_servers, scopes_supported, bearer_methods_supported }` with `Cache-Control: max-age=300` and `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
- Tool dispatch uses `server.registerTool(name, { title, description, inputSchema }, handler)`.
- **Per-tool rate limiting lives here** (not in the authorizer): after dispatch resolves the tool name, increment a second DynamoDB counter keyed by `userId#agentId#tool-bucket` — `retain` bucket limit 30/min, `read` bucket limit 60/min, 429 on breach. TTL on rows = 120s.
- Handler pulls connection context (`userId`, `tenantId`, `agentId`, `clientId`) **exclusively** from `event.requestContext.authorizer.lambda`. **Header-based fallback is explicitly forbidden** — no `x-user-id`, `x-tenant-id`, etc. If authorizer context is missing, return 500; the route MUST have the authorizer attached (verified in Unit 10 Terraform).
- On exceptions, return MCP JSON-RPC error with code matching MCP spec.

**Patterns to follow:** existing Lambda handlers in `packages/api/src/handlers/*.ts` for event shape + error handling.

**Test scenarios:**
- Happy path: `POST /mcp` with valid context, `tools/list` call → returns 3 tools.
- Happy path: `GET /.well-known/oauth-protected-resource` → returns PRM JSON.
- Error path: missing connection context (authorizer bypassed in test) → 500 with safe message (shouldn't occur in prod but defensive).
- Error path: `tools/call` with unknown tool name → MCP spec-compliant error.
- Integration: scripted MCP client connects, discovers PRM, authorizes (mocked authorizer), lists tools.

**Verification:**
- Scripted MCP client session against dev Lambda does `initialize` + `tools/list` successfully.
- PRM document validates against [RFC 9728 schema](https://datatracker.ietf.org/doc/html/rfc9728).

---

- [ ] **Unit 7: `retain` tool**

**Goal:** Implement the `retain` tool — redact content, validate threadId ownership, synthesize the turn envelope, invoke `memory-retain` RequestResponse, surface structured response to the caller.

**Requirements:** R1, R2, R5, R6, R9.

**Dependencies:** Unit 3 (redaction lib), Unit 4 (provenance plumbing), Unit 6 (tool dispatch skeleton).

**Files:**
- Create: `packages/api/src/lib/mcp-server/tools/retain.ts` — tool handler.
- Create: `packages/api/src/lib/mcp-server/tools/retain.test.ts`.
- Modify: `packages/api/src/lib/mcp-server/server.ts` — register `retain`.

**Approach:**
- Input schema: `{ content: string, kind?: "learning"|"decision"|"fact"|"note", tags?: string[], threadId?: string }`.
- Flow: scrub content → validate threadId (DB lookup via Drizzle: does threadId belong to `(userId, agentId)`? 403 if not) or mint synthetic thread via `uuidv5(MCP_SYNTHETIC_NAMESPACE, userId + ':' + agentId + ':' + clientId)` (opaque to caller; raw component UUIDs never leak) → build turn envelope with `source: "external-mcp"`, `clientId`, `tags`, `kind` → `InvokeCommand` memory-retain, `InvocationType: RequestResponse` → unwrap response.
- Response: `{ ok: true, memoryId, agentName, threadId, wikiCompilePending: boolean, redactions?: Record<string, number> }` on success; `{ ok: false, error: { code, message, reauthRequired? } }` on failure. `threadId` is the UUIDv5 handle — never the raw `userId:agentId:clientId` string.
- Content-size limit: > 32KB returns MCP error `-32602 (Invalid params)` with `data: { reason: "content_too_large", limit_bytes: 32768 }`. Empty content returns the same error with `reason: "empty_content"`.
- Do NOT log redacted content; log only `redactions` counts as CloudWatch metrics.

**Execution note:** Test-first for the threadId-validation path — write the 403 test before the happy path.

**Patterns to follow:** `packages/api/src/lib/memory/` adapter pattern for internal Lambda invokes. `aws-sdk` `LambdaClient` + `InvokeCommand`.

**Test scenarios:**
- Happy path: content without credentials, no threadId → synthetic thread minted, memory-retain called, `{ ok, memoryId, wikiCompilePending: true }` returned.
- Happy path: content with an OpenAI key → redacted text reaches memory-retain; original never persisted.
- Error path: caller-supplied threadId not owned by (userId, agentId) → 403 with MCP error code; memory-retain NOT called.
- Error path: memory-retain returns `ok: false` → surface as MCP error with reauthRequired=false.
- Error path: memory-retain InvokeCommand rejects (throttling / AccessDenied) → MCP error; Retry-After if throttling.
- Edge case: empty content → 400 (MCP-invalid-params).
- Edge case: content over 32KB → truncate with warning + redaction count preserved (or reject; pick one explicitly in implementation).
- Integration: tool returns; `memory-retain` Lambda logs show `source: external-mcp`; Hindsight record carries tag.

**Verification:**
- End-to-end: retain call from scripted MCP client produces a visible memory under the bound agent with the source tag on the record.

---

- [ ] **Unit 8: `memory_recall` tool**

**Goal:** Implement the `memory_recall` tool — direct adapter call via `recall-service`, size-clamped results, `source` tag surfaced.

**Requirements:** R1, R7, R10.

**Dependencies:** Unit 6.

**Files:**
- Create: `packages/api/src/lib/mcp-server/tools/memory-recall.ts`.
- Create: `packages/api/src/lib/mcp-server/tools/memory-recall.test.ts`.
- Modify: `packages/api/src/lib/mcp-server/server.ts` — register `memory_recall`.

**Approach:**
- Input: `{ query: string, limit?: number }` (default 10, hard cap 20).
- `getMemoryServices()` → `createRecallService({ adapter, limit })` → `.recall({ tenantId, agentId, query })`.
- Post-process: clamp each result's text to 2KB, appending `…` when truncated so callers can distinguish complete from truncated. Map `source` tag from record metadata to response field (`external-mcp` when present, else `null`).
- Never trust caller-supplied `tenantId` or `agentId` — always from connection context.

**Patterns to follow:** `packages/api/src/lib/memory/recall-service.ts` existing usage in GraphQL resolvers.

**Test scenarios:**
- Happy path: query returns at most 10 results; all within tenant scope.
- Happy path: external-origin record's `source` field surfaces as `"external-mcp"` in result.
- Edge case: no matches → `{ results: [] }`.
- Edge case: limit > 20 → clamped to 20.
- Edge case: result text > 2KB → truncated to 2KB with ellipsis.
- Error path: adapter throws → MCP error; log at warn level.
- Integration: adapter re-enforces tenantId independently — stolen context fixture with wrong tenantId can't pull matching data.

**Verification:**
- Adapter-layer test with tampered tenantId returns empty result set.

---

- [ ] **Unit 9: `wiki_search` tool**

**Goal:** Implement `wiki_search` by directly importing the existing `wikiSearch` resolver function and calling it with a synthesized `ctx.auth` built from connection context.

**Requirements:** R1, R7, R11.

**Dependencies:** Unit 6.

**Files:**
- Create: `packages/api/src/lib/mcp-server/tools/wiki-search.ts`.
- Create: `packages/api/src/lib/mcp-server/tools/wiki-search.test.ts`.
- Modify: `packages/api/src/lib/mcp-server/server.ts` — register `wiki_search`.

**Approach:**
- Import `wikiSearch` resolver from `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts`.
- Synthesize `ctx` with `auth: { authType: "cognito", principalId: <Cognito sub from connection context>, tenantId, email: null }` — matches the `AuthResult` interface in `packages/api/src/lib/cognito-auth.ts` verbatim. `principalId` MUST be the Cognito sub (not AgentCore Identity's subject) so `resolveCallerTenantId(ctx)` fallback resolves for Google-federated users.
- `ownerId` = `userId` (`user_id`) from connection context. Wiki ownership is now user-scoped, not agent-scoped.
- Pass `{ tenantId, ownerId: userId, query, limit: min(limit ?? 10, 20) }`.
- Response shape passes through from resolver untouched (matches R11).

**Patterns to follow:** `packages/api/src/graphql/context.ts` for `ctx.auth` shape.

**Test scenarios:**
- Happy path: query with matches → resolver's hit list passed through verbatim.
- Edge case: no matches → empty array.
- Scope regression: connection context has `userId=U1` and `agentId=A1`; resolver is called with `ownerId=U1`, never `A1`.
- Error path: resolver throws `AuthorizationError` → MCP error; should not happen given synthesized ctx, but defensive.
- Integration: resolver-layer test with tampered synthesized tenantId → `assertCanReadWikiScope` rejects; MCP layer returns authorization error.

**Verification:**
- Fixture queries via scripted MCP client reproduce the same hits as a direct GraphQL call for the same tenant/agent.

---

- [ ] **Unit 10: Terraform wiring — API Gateway, authorizer, IAM, env, secrets**

**Goal:** Deploy the MCP Lambda end-to-end — route, authorizer attachment, cross-invoke permission for memory-retain, env vars (issuer URL, JWKS, MCP canonical URI, DynamoDB table name), DynamoDB table, WAF rule (if applicable).

**Requirements:** R1, R3, R8, R12.

**Dependencies:** Units 1, 5, 6.

**Files:**
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — add `mcp-server` + `mcp-oauth-prm` to the `for_each` Lambda set; add routes; attach authorizer to `/mcp`.
- Modify: `terraform/modules/app/lambda-api/main.tf` — extend `lambda_api_cross_invoke` policy to include `memory-retain` for `mcp-server`'s role.
- Create: `terraform/modules/app/lambda-api/mcp-server-env.tf` — env block for MCP Lambdas (issuer URL, JWKS URL, MCP canonical URI, DynamoDB table name, stage).
- Modify: `terraform/modules/foundation/monitoring/main.tf` (or equivalent) — CloudWatch dashboard + alarms for retain/recall/search rates and 429 counts.
- Check: WAF rule on stage; add an IP-floor rate-based rule if present, else note and defer.

**Approach:**
- Follow the existing handler pattern. No Function URL, no streaming.
- TLS via managed ACM cert on the stage (already configured for existing routes).
- Env: `MCP_CANONICAL_URI`, `MCP_ISSUER_URL`, `MCP_JWKS_URL`, `MCP_RATE_COUNTERS_TABLE`.
- Memory-retain ARN already in SSM at `/thinkwork/{stage}/memory-retain-fn-arn` — re-use.

**Patterns to follow:** existing handler additions in `handlers.tf`; existing SSM-based ARN discovery.

**Test scenarios:**
- Test expectation: none — infra change; validated by integration tests in Unit 14 end-to-end.

**Verification:**
- `terraform plan` shows only the intended diff.
- Post-deploy: `curl` on PRM endpoint returns valid doc; authorizer rejects missing Bearer.

---

### Phase C — Mobile

- [ ] **Unit 11: Mobile — Connected MCP Clients settings screen**

**Goal:** New mobile settings screen listing inbound MCP connections with revoke action. Sibling to outbound `mcp-servers.tsx`.

**Requirements:** R13.

**Dependencies:** Unit 2.

**Files:**
- Create: `apps/mobile/app/settings/connected-mcp-clients.tsx`.
- Create: `apps/mobile/src/graphql/inboundMcp.graphql` (or urql hook files, matching existing mobile conventions).
- Create: `packages/api/src/graphql/resolvers/mcp-inbound/*.query.ts` + `*.mutation.ts` — `inboundMcpConnections(userId)` query + `revokeInboundMcpConnection(id)` mutation.
- Modify: `packages/api/src/graphql/schema.ts` — add types and fields.
- Modify: `apps/mobile/app/settings/_layout.tsx` — add route entry.

**Approach:**
- List: client displayName, bound agent name, created/last-used timestamps, revoke button.
- Revoke: sets `revoked_at`; server invalidates authorizer cache for that connection (DynamoDB TTL).
- Match outbound settings screen's visual patterns for consistency.

**Patterns to follow:** `apps/mobile/app/settings/mcp-servers.tsx`.

**Test scenarios:**
- Happy path: user with one connection sees row; tapping revoke disables further MCP calls from that client within one authorizer cache TTL.
- Edge case: user with zero connections sees empty state + CTA to connect.
- Error path: revoke mutation fails → toast + row remains visible.

**Verification:**
- On device fixture: revoke causes subsequent MCP call from that client to return 401 within 30 seconds.

---

- [ ] **Unit 12: Mobile — External Memories panel on agent detail**

**Goal:** New panel on the mobile agent detail screen that surfaces `source="external-mcp"` retained memories, tagged with connected client name. External retains are NOT rendered in the agent's conversation thread view.

**Requirements:** R2, R4.

**Dependencies:** Unit 4 (source tag plumbing).

**Files:**
- Create: `apps/mobile/src/components/ExternalMemoriesPanel.tsx`.
- Modify: `apps/mobile/app/agents/[id]/index.tsx` — wire the panel below the conversation area (or behind a tab — decide during implementation based on visual density).
- Create: `packages/api/src/graphql/resolvers/memory/externalMemories.query.ts` — `externalMemories(agentId, limit, cursor)` returning records with `source="external-mcp"`.
- Modify: `packages/api/src/graphql/schema.ts`.

**Approach:**
- Panel renders a paginated list; each row shows content, timestamp, "via <clientName>" tag, and tap-for-detail.
- Explicit UX invariant: external retains do NOT appear in the conversation scroller that renders user turns. Verify by fixture.
- Query filters memories by `source="external-mcp"` via adapter-side tag filter.

**Patterns to follow:** existing agent detail panels in mobile.

**Test scenarios:**
- Happy path: agent with 3 external retains shows 3 rows tagged with client name; conversation view shows zero new turns.
- Edge case: no external retains → panel shows empty state or is hidden (decision at implementation).
- Error path: query fails → graceful fallback, panel shows error state.
- Integration: a retain call via MCP (Unit 7) surfaces in this panel within one mobile refresh cycle.

**Verification:**
- Manual fixture: retain from Claude Code → memory appears in External Memories, NOT in conversation.

---

- [ ] **Unit 13: Mobile — Connect Claude Code flow**

**Goal:** Deep link or web flow from mobile settings that initiates inbound OAuth with the dedicated issuer, lets the user pick an agent, and returns success state to the external client.

**Requirements:** R13.

**Dependencies:** Units 1, 2, 11.

**Files:**
- Create: `apps/mobile/app/settings/connect-mcp-client.tsx` — connect screen with agent picker.
- Modify: `apps/mobile/app/settings/connected-mcp-clients.tsx` — "Connect a new client" CTA.
- Create: `packages/api/src/handlers/mcp-connect-init.ts` — optional: initiation endpoint that ThinkWork mobile opens to start the flow with correct `resource` + agent binding metadata.
- Create: `docs/user/connecting-claude-code.md` — user-facing instructions.

**Approach:**
- Flow: (1) user in mobile settings taps "Connect Claude Code" → (2) picks an agent → (3) mobile opens the Claude Code MCP URL (or shows a copy-paste URL for manual entry in the external client) → (4) Claude Code does DCR against the dedicated issuer → (5) Claude Code initiates `/authorize` with `resource=<MCP URI>` + the chosen agent ID in the `state` param → (6) user lands on the AS's hosted login, authenticates with Cognito-federated Google → (7) consent screen shows requested scopes + display name of MCP client + bound agent name → (8) back-redirect to Claude Code with code → (9) token exchange → (10) on first successful MCP call from that client, an `inboundMcpConnections` row is created.
- The exact mobile ↔ external-client initiation mechanism is empirically determined — some clients accept a URL to paste, some support deep-link protocols, some support OAuth via a system-browser handoff.
- Consent screen copy: "Claude Code wants to read and add memories in your '<Agent Name>' agent on ThinkWork."

**Patterns to follow:** existing mobile OAuth mechanics in `apps/mobile/app/settings/mcp-servers.tsx` (outbound direction — mirror the UX idioms, not the code path).

**Test scenarios:**
- Happy path: user completes connect flow end-to-end; `inboundMcpConnections` row created; External Memories panel on the bound agent is visible.
- Edge case: user cancels consent → no DB row; no partial state.
- Error path: DCR registration fails → visible error with retry.
- Error path: token exchange fails → visible error; flow can be restarted without orphaned state.
- Integration: the chosen agent at connect time matches the `agent_id` on the DB row that later guards tool calls.

**Verification:**
- On real device: connect Claude Code, call `retain` once, verify memory appears in External Memories panel under the bound agent.

---

### Phase D — Validation + Documentation

- [ ] **Unit 14: End-to-end validation fixtures**

**Goal:** Deterministic test fixtures for the critical security and functional invariants.

**Requirements:** R5, R7, R8, R15.

**Dependencies:** Units 1-13.

**Files:**
- Create: `packages/api/src/handlers/mcp-server.e2e.test.ts` — end-to-end suite spun up against the dev stack (or LocalStack if feasible).
- Create: `packages/api/src/lib/redaction/credential-scrubber.regression.test.ts` — comprehensive redaction fixture.
- Create: `docs/runbooks/mcp-incident-response.md` — runbook for revocation, credential leak triage, rate-limit abuse.

**Approach:**
- Cross-tenant fixture: two tenants A and B; user A's token cannot recall/search for B's data — tested at MCP edge AND at adapter/resolver layer (tampered context).
- Rate-limit fixture: 31 retain calls in 50 seconds → last is 429 with Retry-After.
- Credential-leak regression: content with every supported credential type → all redacted; zero raw keys reach memory-retain (verified via Lambda log capture).
- Revocation propagation: revoke → next call within 30s is 401.

**Test scenarios:**
- All scenarios from Unit 7-9 replayed end-to-end against a live dev stack.
- Cross-tenant attack fixture — token with forged tenantId claim (signed by issuer with wrong `aud`) → 401 at authorizer.
- Happy path: full handshake + retain + recall + search from a scripted MCP client.

**Verification:**
- Suite runs in CI (nightly, not PR-gate, to keep PR CI fast).

---

- [ ] **Unit 15: Documentation + v0 pilot onboarding**

**Goal:** Write user-facing docs, operator runbooks, and establish the v0 pilot invite list.

**Requirements:** R14 (adoption gate needs pilots with tracked usage).

**Dependencies:** Units 1-14 (at least functional).

**Files:**
- Create: `docs/user/connecting-claude-code.md` — end-user connect instructions.
- Create: `docs/runbooks/mcp-oauth-server.md` — operator runbook for issuer issues, token revocation, rate-limit tuning.
- Create: `docs/runbooks/mcp-incident-response.md` — credential leak / abuse response.
- Modify: `README.md` — brief mention of MCP server with pointer to user docs.
- Create: `docs/solutions/best-practices/inbound-mcp-auth-pattern-2026-04-XX.md` — capture learnings from Units 1, 5, 6 back into the knowledge base.
- Identify and contact 2-3 ThinkWork users as v0 pilots; capture their specific use cases (see origin: Users and validation approach).

**Test scenarios:** Test expectation: none — documentation + outreach.

**Verification:**
- **Week-1 leading indicator:** at least 2 non-author pilot users successfully connect and perform ≥1 retain + ≥1 recall each.
- **R14 v1 gate (authoritative):** at least 1 non-author user performs ≥5 tool calls per week for 2 consecutive weeks. v1 plan work MUST NOT begin until this is met; the Risks table's 30-day review is the latest decision point to halt.

## System-Wide Impact

- **Interaction graph**: new MCP Lambda + authorizer + issuer fan out to existing memory-retain (InvokeCommand), recall-service (in-process), wikiSearch resolver (in-process). Mobile gains two screens and a panel. Wiki-compile reads a new optional tag but branches no behavior in v0.
- **Error propagation**: external client → MCP Lambda → JSON-RPC error codes. Token-expiry surfaces as `reauthRequired=true` so Claude Code can prompt re-auth. memory-retain failures surface structured errors (not fire-and-forget).
- **State lifecycle risks**: synthetic thread id collisions prevented by `(userId, agentId, clientId)` UUID composition. Connection revocation invalidates within one authorizer cache TTL (30s). Rate counter rows auto-expire via DynamoDB TTL.
- **API surface parity**: `wiki_search` returns same shape as `wikiSearch` GraphQL resolver — keeps one contract, not two. Adapter's `recall` shape passes through unchanged except for `source` surfacing.
- **Integration coverage**: cross-tenant test fixture covers the invariant that adapter + resolver re-enforce tenantId independently of the MCP edge. Rate-limit fixture covers the 429 path. Credential-redaction regression fixture covers the known key types.
- **Unchanged invariants**: `memory-retain` event shape for native callers (strands runtime, chat-agent-invoke) is unchanged — `metadata` extension is additive. Existing mobile screens (conversations, memory view) are untouched; only a new External Memories panel is added. GraphQL schema grows by `externalMemories` query + two inbound MCP fields; no existing resolver behavior changes. Cognito user pool contract is unchanged (federation lives on the dedicated issuer side).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Dedicated issuer DCR or RFC 8707 support varies at time of build | Unit 1 validates before downstream units begin; WorkOS as fallback if AgentCore Identity lacks a required feature in our region. |
| Credential-redaction regex bank misses a novel token format | Regression fixture in `credential-scrubber.regression.test.ts` is expandable; v1 upgrade to Bedrock Guardrails planned. Log redaction counts for anomaly detection. |
| `wikiSearch` resolver `assertCanReadWikiScope` rejects the synthesized ctx | Unit 9 tests the ctx adapter against real resolver; if mismatch, add a third auth branch to the resolver as a narrow fix. |
| Rate counter hot-partitioning in DynamoDB | Partition key shape includes minute bucket — ensures rotation; scale-test in Unit 14. |
| Adoption gate not met — v0 sits with author-only usage | Explicit 30-day review; if usage is author-only, mark feature "internal tool" and halt v1 scope. Avoid sunk-cost expansion. |
| `memory-retain` synthetic turn breaks downstream assumptions (wiki compile, embeddings) | Unit 4 characterization test captures current shape; Unit 7 re-runs the native path to prove no regression. |
| TLS + API Gateway + custom domain config drift | `terraform plan` review gates the stage change; managed ACM cert already exists. |
| `@modelcontextprotocol/sdk` v2 breaks | Version pin `^1.29.0`; renovate bot disabled for this package. |
| `aws-jwt-verify` JWKS fetch cold-start cost on the authorizer | Keep JWKS cache in module scope, not handler scope; pre-warm with scheduled ping if tail latency matters. |
| Drizzle migration from `push` to `generate+migrate` introduces process friction | Unit 2 documents the split; applies only to new tables. |

## Documentation / Operational Notes

- New runbooks in `docs/runbooks/`: `mcp-oauth-server.md`, `mcp-incident-response.md`.
- User-facing connect doc: `docs/user/connecting-claude-code.md`.
- Admin UI: no changes in v0 (the principle is user-driven). Per-connection visibility for admins is a v1 consideration.
- Monitoring: CloudWatch dashboards for retain/recall/search call volume, 429 counts, JWT verification failures, credential redaction counts by kind.
- Rollout: ship to dev first, exercise via a dedicated test tenant, then enable for pilot tenants only (feature flag on the `inboundMcpConnections` create mutation — allowlist of tenantIds). After pilot validation, enable tenant-wide.
- Capture learnings back into `docs/solutions/best-practices/` as each Unit lands (auth, rate limiting, redaction, synthetic-turn plumbing are all candidates).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md](../brainstorms/2026-04-20-thinkwork-memory-wiki-mcp-requirements.md)
- Related code: `packages/api/src/handlers/memory-retain.ts`, `packages/api/src/lib/memory/**`, `packages/api/src/graphql/resolvers/wiki/**`, `packages/api/src/handlers/skills.ts` (existing outbound OAuth mirror), `packages/api/src/lib/cognito-auth.ts`.
- Terraform: `terraform/modules/app/lambda-api/handlers.tf`, `terraform/modules/foundation/cognito/main.tf`.
- Spec: [MCP Authorization Spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), [MCP Authorization Spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728), [RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707), [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591).
- SDK: [`@modelcontextprotocol/sdk` TypeScript](https://github.com/modelcontextprotocol/typescript-sdk).
- AgentCore Identity DCR notes: [jonathanpenny.com blog post](https://jonathanpenny.com/blog/oauth-dcr-aws-bedrock-agentcore/), [stache-ai/agentcore-dcr](https://github.com/stache-ai/agentcore-dcr).
