---
title: Replace AppSync and GraphQL HTTP with REST + targeted SSE
type: refactor
status: active
date: 2026-04-30
origin: docs/brainstorms/2026-04-30-rest-and-polling-cutover-requirements.md
---

# Replace AppSync and GraphQL HTTP with REST + targeted SSE

## Summary

The migration extends existing REST patterns (`packages/api/src/handlers/`, `apps/admin/src/lib/api-fetch.ts`) rather than inventing new ones — adds a greenfield `@thinkwork/api-schemas` zod package, a one-off SSE Function URL substrate, and 12 implementation units organized in 4 phases (substrate → first domain → SSE-bearing domain → parallel rollout → single cleanup PR). Inert→live seam swap (per institutional learning) governs per-domain PR cadence.

---

## Problem Frame

The origin requirements doc establishes the full pain narrative; see `docs/brainstorms/2026-04-30-rest-and-polling-cutover-requirements.md`. Briefly: every GraphQL type edit cascades through schema-build, codegen in 3 packages, AppSync redeploy, and urql client adjustments. AppSync's value is narrow (9 invalidation-shaped events delivered to clients that already follow "receive event → refetch") but it carries the cognitive weight of a full GraphQL platform. The product is an operator dashboard with one live-feeling surface (active thread watching) — a category where polling is the correct primitive and a single targeted SSE endpoint closes the one UX gap.

Plan-specific framing: research surfaced that the migration is *finishing a partly-staged transition*, not starting one cold. TanStack Query v5, zod 4, and a parallel REST handler pattern (`packages/api/src/handlers/agents.ts` with `parsePath()` sub-routing) already exist. The plan extends established substrate; it does not invent.

---

## Requirements

**API contract**
- R1. All non-streaming server↔client interactions use REST + JSON over HTTPS.
- R2. Request and response shapes are validated by zod schemas exported from a shared types package consumed by admin, mobile, and the server.
- R3. Endpoints are organized by domain (mirrors the 24 resolver folders in `packages/api/src/graphql/resolvers/`).
- R4. There is no codegen step for API types. Types flow from zod schemas via TypeScript inference; consumers import directly.
- R5. Authentication on all REST endpoints uses Cognito JWTs via the existing pattern.

**Client data layer**
- R6. TanStack Query is the sole client-side cache mechanism for both admin and mobile.
- R7. Each query specifies a `refetchInterval` appropriate to its route (per-feature during migration).
- R8. `refetchOnWindowFocus`, `refetchOnReconnect`, and freshness-favoring `staleTime` defaults are set globally for both clients.
- R9. Mutations apply optimistic updates where the user expects instant feedback; mutation success invalidates affected query keys.
- R10. urql is removed entirely from admin and mobile (queries, mutations, subscriptions, graphcache config).

**Live thread streaming (SSE)**
- R11. The route where a user actively watches an agent's thread executing is served by a dedicated SSE endpoint backed by Lambda response streaming.
- R12. The SSE endpoint emits events for new messages and turn updates within a single thread.
- R13. When the server closes the SSE connection, the client EventSource auto-reconnects without user intervention; mobile uses a polyfill that mirrors EventSource semantics.
- R14. SSE is used only for the live-thread route in v1.
- R15. When no user is actively watching a live thread, no SSE Lambda is held open. Idle resource cost is zero.

**Decommissioning**
- R16. AppSync is deleted from the Terraform configuration.
- R17. The schema build pipeline (`scripts/schema-build.sh`), `terraform/schema.graphql`, `subscriptions.graphql`, and any other GraphQL source files are deleted.
- R18. All nine server-side `notify*` helpers are deleted, not replaced.
- R19. The GraphQL HTTP Lambda (`graphql-http`), Yoga server, and all GraphQL resolvers are deleted.
- R20. Codegen scripts and generated artifacts are removed from `apps/cli`, `apps/admin`, `apps/mobile`, and `packages/api`. After cleanup, no `.graphql` files exist in the repo and no `codegen` script appears in any `package.json`.

**Migration sequencing**
- R21. New REST endpoints and the SSE endpoint stand up alongside the existing AppSync + GraphQL HTTP stack; the new stack is inert until clients begin cutover.
- R22. Admin and mobile cut over domain by domain.
- R23. After all domains are cut over and validated in production, decommissioning (R16–R20) executes in a single cleanup pass.
- R24. There are no backwards-compatibility shims for clients running mid-migration.
- R25. The Strands agent runtime's existing API consumers are not modified by this work.

**Origin actors:** A1 (admin operator), A2 (mobile user), A3 (server-side mutation handlers), A4 (Strands agent runtime — out of scope per R25)
**Origin flows:** F1 (read with auto-refresh), F2 (mutate with optimistic update), F3 (live thread watch), F4 (migration cutover per domain)
**Origin acceptance examples:** AE1 (covers R7, R8), AE2 (covers R9), AE3 (covers R11, R12, R15), AE4 (covers R13), AE5 (covers R10, R20)

---

## Scope Boundaries

- All push-based realtime layers — AppSync (any form), API Gateway WebSocket, IoT Core MQTT (rejected in brainstorm)
- All third-party SaaS realtime — Ably, PartyKit, Pusher, Liveblocks, Convex
- SSE for any route other than live-thread watching
- Pushing data payloads on any wire (REST is the source of truth; SSE delivers thread-event signals only)
- Replacing TanStack Query, Cognito, the API Gateway, or any other component above/below this layer
- OpenAPI / schema-driven REST tooling
- Migrating the Strands agent runtime's API calls (already REST + `API_AUTH_SECRET`)
- Multi-region failover for the API or SSE tier
- Backwards-compatibility shims for clients running mid-migration
- Bidirectional realtime — presence, cursors, typing indicators, multi-device sync
- Rate limiting and request throttling at API Gateway (existing limits unchanged)
- Per-endpoint Lambda topology (per-domain handler is the chosen shape)
- Aurora `LISTEN/NOTIFY` for SSE fanout (in-Lambda poll is the chosen shape)
- Cognito identity pool removal (vestigial; orthogonal to this work)
- Mobile push-notification fallback for backgrounded SSE — flagged for future work, not v1

### Deferred to Follow-Up Work

- Per-route SSE expansion to non-live-thread surfaces (e.g., eval run progress, cost ticker): defer until production data shows polling latency is felt
- Background-mode push notifications for mobile SSE consumers: separate workstream after this migration completes
- Decommission of the unused Cognito identity pool: opportunistic cleanup PR after this migration ships

---

## Context & Research

### Relevant Code and Patterns

- **REST handler pattern**: `packages/api/src/handlers/agents.ts` (`parsePath()` sub-resource routing, `requireTenantMembership` auth, `json`/`error`/`paginated` response helpers)
- **Shared response helpers**: `packages/api/src/lib/response.ts` (`json`, `error`, `notFound`, `unauthorized`, `forbidden`, `paginated`, `cors`, `handleCors`, `CORS_HEADERS`)
- **Auth shared infra**: `packages/api/src/lib/cognito-auth.ts` (`authenticate(headers)`), `packages/api/src/lib/tenant-membership.ts` (`requireTenantMembership`, `requireTenantAdmin`)
- **Tenant resolution for Google federation**: `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts:80` (`resolveCallerTenantId`)
- **Admin REST client substrate**: `apps/admin/src/lib/api-fetch.ts` (`apiFetch()` attaches Cognito id-token + `x-tenant-id`)
- **Admin TanStack Query setup**: `apps/admin/src/lib/query-client.ts` (defaults change as part of U1/U2 work), `apps/admin/src/lib/query-keys.ts` (namespace registry to extend)
- **Existing parallel REST API surface in admin**: `apps/admin/src/lib/{agent-builder-api.ts, builtin-tools-api.ts, context-engine-api.ts, guardrails-api.ts, knowledge-base-api.ts, mcp-api.ts, plugins-api.ts, skills-api.ts, workspace-files-api.ts}` — these are the template each domain extends
- **Subscription→invalidation bridge to delete**: `apps/admin/src/context/AppSyncSubscriptionProvider.tsx`
- **Resolver folder structure to mirror in REST domain split**: `packages/api/src/graphql/resolvers/{activation, agents, artifacts, brain, core, costs, evaluations, inbox, knowledge, memory, messages, observability, orchestration, quick-actions, recipes, runtime, skill-runs, teams, templates, threads, triggers, webhooks, wiki, workspace}/`
- **Lambda build pipeline**: `scripts/build-lambdas.sh` (esbuild + zip per handler; `BUNDLED_AGENTCORE_ESBUILD_FLAGS` not needed for new domain handlers — only for handlers using newer Bedrock SDKs)
- **AppSync Terraform module to delete**: `terraform/modules/app/appsync-subscriptions/` (3 files)
- **Terraform composer wiring to remove**: `terraform/modules/thinkwork/main.tf:164,197-198,216`, `terraform/modules/thinkwork/outputs.tf:82-91`, `terraform/examples/greenfield/main.tf:372-384`
- **AppSync env-var plumbing into `graphql-http`**: `terraform/modules/app/lambda-api/handlers.tf:30-32,59`, `terraform/modules/app/lambda-api/variables.tf:95,100,225`
- **Schema build pipeline**: `scripts/schema-build.sh`, `terraform/schema.graphql`, `packages/database-pg/graphql/`
- **Codegen surfaces**: `apps/admin/codegen.ts` → `apps/admin/src/gql/`, `apps/mobile/codegen.ts` → `apps/mobile/lib/gql/`, `apps/cli/codegen.ts` → cli gql output
- **graphql-contract test to replace with REST equivalent**: `packages/api/src/__tests__/graphql-contract.test.ts`
- **deploy.yml AppSync echo to remove**: `.github/workflows/deploy.yml:849`

### Institutional Learnings

- `docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md` — every new domain handler needs OPTIONS-bypass-auth + CORS-on-error treatment (drives U3 contract test)
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — exact template for per-domain PR cadence (PR-1 = inert handlers + tests; PR-2 = client cutover; cleanup is a separate trailing PR)
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` — service vs user surface discipline; do not widen `cognito-auth.ts`'s key-acceptance list to extend the new domain endpoints
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — `requireTenantAdmin(ctx, tenantId)` before any side effect, `tenantId` from row (update/delete) or arg (create) — enforced via U3 contract test
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md` — multi-user-tenant resolver discipline; resolve user from JWT `sub`, not `WHERE tenant_id = ? LIMIT 1`
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — if any domain introduces a hand-rolled `.sql` migration, declare `-- creates:` markers (gates `deploy.yml` migration-drift-check)
- `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md` — drives U1 (worktree bootstrap script)
- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — zod schemas qualify for extraction (U2); handler helpers stay inlined under `packages/api/src/lib/`
- `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md` — drives the U12 cleanup pre-survey discipline (re-grep before deletion)

### External References

- AWS Lambda response streaming with Function URLs: `awslambda.streamifyResponse` + `aws_lambda_function_url` with `invoke_mode = "RESPONSE_STREAM"`, `authorization_type = "NONE"`, JWT validated in handler via `aws-jwt-verify`. SSE keepalive comments every ~15s; pre-15-min internal timeout (~14m) to force EventSource auto-reconnect. ([AWS Lambda docs](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html), [tutorial](https://docs.aws.amazon.com/lambda/latest/dg/response-streaming-tutorial.html))
- React Native SSE: `react-native-sse` (binaryminds) is the maintained 2026 option for Expo managed workflow. JWT rotation via `Authorization: { toString(): string }` indirection. AppState integration for backgrounding. Production-build only — known Expo CdpInterceptor bug breaks SSE in debug builds (`expo/expo#27526`).
- TanStack Query v5: `refetchInterval` and `staleTime` are orthogonal axes. `refetchInterval` may be a function returning `number | false` for conditional polling. Optimistic-update v5 has two patterns — single-screen "UI only via `mutation.variables`" vs. multi-subscriber `onMutate` cache write — choose per route. ([Polling guide](https://tanstack.com/query/latest/docs/framework/react/guides/polling), [Optimistic updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates))

---

## Key Technical Decisions

- **Lambda topology = per-domain handler with internal sub-routing**: Extends the existing `parsePath()` pattern from `packages/api/src/handlers/agents.ts`. One Lambda per domain (24 domains → ~24 Lambdas), each handling its CRUD verbs internally. Avoids per-endpoint Lambda sprawl (50+ deploy units) and avoids monolith bundling. *Rationale: matches existing convention; reviewers and implementers don't have to learn a new shape.*
- **SSE substrate = Function URL + `awslambda.streamifyResponse` + JWT-in-handler**: Function URL with `invoke_mode = "RESPONSE_STREAM"` and `authorization_type = "NONE"`. JWT validated in handler via the same `aws-jwt-verify` library used by API Gateway. *Rationale: Function URLs do not integrate with Cognito user-pool authorizers; IAM auth would force SigV4 on the client, incompatible with browser EventSource.*
- **SSE event source = in-Lambda Aurora poll**: ~1-2s polling loop inside the streaming handler reads new turns/messages and writes SSE events. *Rationale: Aurora `LISTEN/NOTIFY` has constraints on aurora-postgres clusters; the per-connection cost is acceptable since SSE is scoped to "actively watching" only (R15) — no idle Lambdas.*
- **Pre-15-min internal close = ~14 minutes**: Handler writes a `: closing\n\n` SSE comment, calls `stream.end()`, exits cleanly. Client EventSource auto-reconnects via native browser/polyfill behavior. *Rationale: forces predictable rotation before the AWS hard cap; eliminates a class of hanging-disconnect bugs.*
- **Mobile SSE client = `react-native-sse`**: Wrapped in a hook (`useThreadEventStream` or similar — naming decided in U4) that subscribes to the auth token store, integrates `AppState` for foreground reconnect on iOS background recovery. Production-build only. *Rationale: only maintained Expo-managed-workflow option in 2026; alternatives require ejecting or hand-rolling SSE framing.*
- **Polling cadence policy**: Global TanStack Query defaults — `staleTime: 30s`, `refetchOnWindowFocus: true`, `refetchOnReconnect: true`. Per-route `refetchInterval` jittered (`base + Math.random()*5000`) to avoid thundering herd on focus return. Live-thread route's polled query is `enabled: false` while SSE is connected. *Rationale: TanStack Query v5 has no built-in jitter; thundering herd at 36-subscription scale is real.*
- **Shared types package = greenfield `@thinkwork/api-schemas`**: zod schemas + inferred TS types. Consumed by `packages/api`, `apps/admin`, `apps/mobile`. Lives at `packages/api-schemas/`. *Rationale: extraction qualifies per institutional learning (3+ consumers, drift would be silent at runtime).*
- **Domain ordering**: inbox → threads+messages → parallel rollout (5 domain groups). *Rationale: inbox is the smallest cross-surface domain (admin + mobile, no SSE), perfect for establishing the per-domain template; threads+messages is the densest urql usage AND the SSE consumer, so doing it second exercises the full substrate end-to-end before parallelizing the long tail.*
- **Cleanup as single trailing PR**: One PR deletes AppSync, schema build, urql, codegen, all `.graphql` files, `notify*` helpers, GraphQL HTTP Lambda, terraform composer wiring, and `deploy.yml` echo line. *Rationale: easier to review one large deletion than many small ones; intermediate states between domains and cleanup are healthy because the new stack runs alongside the old.*
- **Inert→live seam swap per domain**: Per-domain work splits into PR-1 (REST handlers + zod schemas + tests, called by nobody) and PR-2 (client cutover swaps urql calls to `apiFetch` + TanStack Query). PR-2 may also collapse with PR-1 for small domains where it's not worth two reviews.
- **Service vs user surface discipline**: New user-domain endpoints accept Cognito JWT only. Existing `API_AUTH_SECRET`-protected endpoints (Strands runtime callers in `packages/api/src/handlers/skills.ts` and similar) keep their dedicated paths.
- **Contract test enforces auth + CORS rules**: One parameterized test (U3) runs OPTIONS preflight + 401/403/500 CORS-header checks + `requireTenantMembership` call assertion against every new domain handler. Catches the recurring auth-and-CORS class without per-handler vigilance.

---

## Open Questions

### Resolved During Planning

- **Lambda topology**: per-domain Lambda with internal sub-routing (matches existing `agents.ts` pattern)
- **SSE implementation**: Function URL + `streamifyResponse` + in-Lambda DB poll + 14-min internal close + JWT-in-handler
- **React Native SSE polyfill**: `react-native-sse` (binaryminds), production-build only, AppState-driven reconnect
- **Polling cadence policy**: global 30s `staleTime` + per-route `refetchInterval` with jitter
- **Domain ordering**: inbox → threads+messages → parallel rollout
- **Cleanup execution**: single trailing PR after all domains migrate

### Deferred to Implementation

- Exact `refetchInterval` values per route (live: 2-3s, dashboard: 30-60s, static: none) — settled per-feature during the relevant domain's PR review
- Exact REST endpoint paths and verbs per domain — settled in each domain's PR-1 (zod schemas drive the path shape)
- Whether to consolidate inert handler scaffolding into a code-generator macro vs. hand-write each domain's handler — TBD after U5 (inbox) lands; if hand-writing felt boilerplate-heavy, introduce a small generator before U7
- Specific column-level fields exposed per resource — driven by what each domain's existing GraphQL resolver returns; zod schema captures it directly
- Whether to keep the optimistic-update pattern uniform across domains or vary it (UI-only via `mutation.variables` vs. `onMutate` cache write) — per-mutation judgment based on whether multiple subscribers need the optimistic value
- Whether `packages/api-schemas` needs runtime export beyond zod schemas (e.g., shared error types, pagination types) — discovered during U2 build-out, codified in U2 README

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Substrate layer

```
                  ┌───────────────────────────────────────────┐
                  │   @thinkwork/api-schemas  (greenfield)    │
                  │   - zod schemas per resource              │
                  │   - inferred TS types via z.infer<...>    │
                  │   - exported pagination + error types     │
                  └────────────────┬──────────────────────────┘
                                   │  (TS imports — no codegen)
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       packages/api          apps/admin            apps/mobile
       (REST handlers       (api-fetch.ts +       (use-*.ts hooks
        validate via        TanStack Query)       + TanStack Query)
        schema.parse)
```

### Wire format conventions

Each domain Lambda exports a single ESM handler. Internal routing uses path matching (mirroring `packages/api/src/handlers/agents.ts`):

```
GET    /api/threads                  → list (paginated)
GET    /api/threads/:id              → fetch
POST   /api/threads                  → create
PATCH  /api/threads/:id              → update
DELETE /api/threads/:id              → soft-delete
GET    /api/threads/:id/messages     → sub-resource list
POST   /api/threads/:id/messages     → sub-resource create
```

Auth: every non-OPTIONS request runs `requireTenantMembership(headers, { requiredRoles })` before any DB read. Mutations call `requireTenantAdmin(ctx, tenantId)` *before* any side effect.

### SSE wire format (live-thread route only)

```
GET https://<sse-function-url>/threads/:id/events
Headers: Authorization: Bearer <cognito-id-token>

Response: text/event-stream

: keepalive\n\n                                          ← every ~15s
event: thread.message\n
data: {"id":"...","role":"assistant","content":"..."}\n\n

event: thread.turn\n
data: {"runId":"...","status":"running"}\n\n

: closing\n\n                                            ← at ~14m
[stream ends; client EventSource auto-reconnects]
```

Client maps SSE events to TanStack Query cache writes: `event: thread.message` → append to `["threads", id, "messages"]` cache; `event: thread.turn` → invalidate `["threads", id, "turns"]`. The polled query for the same thread is `enabled: false` while the SSE connection is active (controlled by a hook-level boolean).

### Migration data flow per domain

```
                         Phase 0 (substrate)
                               │
                               ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Phase 1 (inbox)  →  Phase 2 (threads+messages + SSE)    │
  │                              │                            │
  │  ┌───────── PR-1 ─────────┐  │  ┌───────── PR-2 ────────┐ │
  │  │ REST handlers +        │  │  │ Admin urql → apiFetch │ │
  │  │ zod schemas +          │  │  │ Mobile urql → apiFetch│ │
  │  │ contract tests         │  │  │ TanStack Query wired  │ │
  │  │ (inert: nobody calls)  │  │  │ subscriptions removed │ │
  │  └────────────────────────┘  │  └───────────────────────┘ │
  └──────────────────────────────┴───────────────────────────-┘
                               │
                               ▼
                  Phase 3 (parallel domain rollout)
                               │
                               ▼
                       Phase 4 (single cleanup PR)
                  ┌───────────────────────────────┐
                  │ delete AppSync, schema build, │
                  │ codegen, urql, .graphql,      │
                  │ notify*, graphql-http Lambda  │
                  └───────────────────────────────┘
```

---

## Implementation Units

### Phase 0 — Substrate (must land before any domain work)

- U1. **Worktree bootstrap script**

**Goal:** Codify the worktree bootstrap sequence so every domain branch starts clean.

**Requirements:** R6, R7, R8 (build hygiene supports the migration; not directly user-facing)

**Dependencies:** None

**Files:**
- Create: `scripts/worktree-bootstrap.sh`
- Modify: root `package.json` (add `wt:bootstrap` script that calls the new shell script)
- Modify: `CLAUDE.md` worktree section (add reference to new script)

**Approach:**
- Script runs: `pnpm install --frozen-lockfile`, then `find . -name "tsconfig.tsbuildinfo" -not -path "*/node_modules/*" -delete`, then `pnpm --filter @thinkwork/database-pg build`, then `pnpm typecheck` as a sanity check.
- Idempotent. Safe to re-run after switching branches in the same worktree.

**Patterns to follow:**
- Existing scripts under `scripts/` are bash with `set -euo pipefail`; mirror that.

**Test scenarios:**
- Test expectation: none — pure tooling script. Validation is "run it on a fresh worktree and confirm typecheck passes."

**Verification:**
- A new worktree created via `git worktree add` followed by `pnpm wt:bootstrap` produces a passing `pnpm typecheck` without manual intervention.

---

- U2. **`@thinkwork/api-schemas` shared zod package (greenfield)**

**Goal:** Greenfield workspace package exporting zod schemas + inferred TS types. Foundation for all subsequent domain work.

**Requirements:** R2, R4

**Dependencies:** U1

**Files:**
- Create: `packages/api-schemas/package.json`
- Create: `packages/api-schemas/tsconfig.json`
- Create: `packages/api-schemas/src/index.ts` (re-exports)
- Create: `packages/api-schemas/src/common/{pagination,errors,timestamps}.ts` (shared schema fragments)
- Create: `packages/api-schemas/src/auth.ts` (shared auth shapes)
- Create: `packages/api-schemas/README.md` (usage from server + clients)
- Modify: `packages/api/package.json` (add `@thinkwork/api-schemas` as workspace dep — the existing `packages/*` glob in `pnpm-workspace.yaml` already covers the new package; no workspace.yaml edit needed)
- Modify: `apps/admin/package.json` (add as workspace dep)
- Modify: `apps/mobile/package.json` (add as workspace dep)
- Test: `packages/api-schemas/src/__tests__/schema-inference.test.ts`

**Approach:**
- Package exports zod schemas and inferred TS types via `z.infer<typeof Schema>`. No domain schemas yet — those land per-domain in U5+.
- Common fragments seed reuse: pagination cursor shape, RFC-7807-ish error envelope, timestamp normalization.
- Build target: ESM only, `tsconfig` extends `tsconfig.base.json` with `composite: true` for project-references in consumers.
- Document the consumption pattern in README: server uses `Schema.parse(body)` for validation; clients use `z.infer<typeof Schema>` for types.

**Patterns to follow:**
- `packages/database-pg` package layout (workspace package with its own `tsconfig.json`, `package.json`, `src/`, builds to `dist/`)
- Existing zod usage in `apps/admin/src/components/*FormDialog.tsx` for client-side form validation — same library version (zod 4.3.6)

**Test scenarios:**
- Happy path: `z.infer<typeof PaginationCursor>` produces a TS type matching the schema's runtime shape (compile-time + runtime parse test).
- Edge case: invalid input to `parse()` throws a `ZodError` with stable error path (validates the error envelope's structure for downstream handler use).
- Error path: optional fields default correctly when omitted.
- Integration: importing the package from a sibling workspace package resolves via `pnpm install` without a manual build step (ensures `composite: true` and `exports` field are configured correctly).

**Verification:**
- `pnpm install --frozen-lockfile` succeeds with the new package in the workspace.
- `pnpm --filter @thinkwork/api-schemas test` passes.
- A test consumer file in `packages/api/src/` can `import { PaginationCursor } from "@thinkwork/api-schemas"` and `pnpm --filter @thinkwork/api typecheck` succeeds.

---

- U3. **CORS + auth + tenant-membership contract test runner**

**Goal:** A parameterized test that runs against every new domain handler, asserting OPTIONS-bypass-auth, CORS-on-error, and `requireTenantMembership` is called before any DB write.

**Requirements:** R5, plus implicit safety rails for every R6–R10 client cutover

**Dependencies:** U1, U2

**Files:**
- Create: `packages/api/src/__tests__/rest-contract.test.ts`
- Create: `packages/api/src/__tests__/_helpers/handler-test-harness.ts` (event factory, mock `requireTenantMembership` spy, response assertion helpers)
- Modify: `packages/api/src/__tests__/setup.ts` (register new test as part of standard test suite if not auto-globbed)

**Approach:**
- Parameterized test takes a list of `{handlerName, handlerFn, paths, mutations}` records. For each handler:
  - Asserts OPTIONS preflight returns 204 with full CORS headers, **without** invoking `authenticate()`.
  - Asserts that requests with no `Authorization` header return 401 with CORS headers attached (CORS-on-error).
  - Asserts that mutating requests (POST/PATCH/DELETE) call `requireTenantAdmin` before any DB write (verified via mock spy ordering against the DB driver mock).
  - Asserts that requests with malformed JSON body return 400 with CORS headers.
- Initial registration list is empty in U3; each subsequent domain unit (U5+) adds its handler to the registration list as part of that unit's PR.

**Patterns to follow:**
- `packages/api/src/__tests__/escalate-delegate-thread.test.ts` for vi.mock + handler-invocation patterns
- `packages/api/src/handlers/agents.ts` for the canonical handler shape the test harness simulates against

**Test scenarios:**
- Happy path: a hand-rolled passing handler registered in the test passes all four assertions.
- Edge case: a handler that forgets to attach CORS to a 401 response fails the test with a clear message.
- Error path: a handler that calls a DB write before `requireTenantAdmin` fails the ordering assertion.
- Integration: the test runs in CI as part of `pnpm test` and fails the build when a new handler is registered without satisfying the contract.

**Verification:**
- A deliberately-broken handler stub (CORS missing on error) added temporarily fails the test with a clear assertion message; removing the bug makes it pass.

---

- U4. **SSE substrate (Function URL Terraform + handler scaffold + RN client wrapper)**

**Goal:** Stand up the Lambda response streaming substrate that U9 (live-thread SSE) consumes. Includes the Function URL Terraform, a reusable handler scaffold, and the React Native client wrapper.

**Requirements:** R11, R13, R15

**Dependencies:** U1, U2

**Files:**
- Create: `packages/api/src/lib/sse-stream.ts` (handler scaffold: `awslambda.streamifyResponse` wrapper, JWT validation via `aws-jwt-verify`, keepalive tick, internal-close timer, SSE event helper `writeEvent(stream, name, data)`)
- Create: `packages/api/src/lib/sse-stream.types.ts` (TS shim for `awslambda` global)
- Create: `apps/mobile/lib/hooks/use-sse.ts` (`react-native-sse` wrapper hook with AppState integration, JWT-from-store via `Authorization: { toString() }` indirection, exponential reconnect)
- Create: `apps/admin/src/lib/use-sse.ts` (browser EventSource wrapper hook with same JWT rotation pattern; thinner because EventSource is native)
- Modify: `terraform/modules/app/lambda-api/main.tf` (add new `aws_lambda_function_url` resource with `invoke_mode = "RESPONSE_STREAM"`, `authorization_type = "NONE"`, `cors` block; do not wire the actual SSE handler until U9 — the resource creates pointing at a stub Lambda)
- Modify: `terraform/modules/app/lambda-api/variables.tf` (declare any new vars the SSE Function URL needs)
- Modify: `terraform/modules/app/lambda-api/outputs.tf` (export `sse_function_url` for downstream wiring)
- Modify: `scripts/build-lambdas.sh` (add `build_handler "thread-events-stream" "<entry-path>"` line for the SSE handler bundle)
- Modify: `apps/mobile/package.json` (add `react-native-sse`)
- Test: `packages/api/src/__tests__/sse-stream.test.ts` (handler scaffold unit tests against a mock streaming response)
- Test: `apps/admin/src/lib/__tests__/use-sse.test.ts` (browser EventSource hook tests with mock EventSource)

**Approach:**
- The handler scaffold (`sse-stream.ts`) is a higher-order function: `streamHandler({ validateJwt, onConnect, onTick }) → AWS Lambda streaming handler`. U9 wires its thread-specific logic into this scaffold.
- Keepalive emits `: keepalive\n\n` every 15 seconds via `setInterval`.
- Internal close: 14-minute `setTimeout` that emits `: closing\n\n` and calls `stream.end()`.
- Client disconnect: handler listens to `responseStream.on('error', ...)` for `ERR_STREAM_PREMATURE_CLOSE` and runs synchronous DB-cleanup in that callback (per AWS re:Post known issue).
- RN hook wraps `react-native-sse` with: AppState listener (`'background'` → `close()`, `'active'` → reconnect), token-rotation reconnect (subscribes to auth store), exponential backoff on errors. Production-build only — known Hermes/CDP debug-build issue (`expo/expo#27526`).
- Browser hook is thin: native `EventSource` + token-rotation reconnect + cleanup on unmount.

**Patterns to follow:**
- `packages/api/src/handlers/graphql-http.ts` for handler bootstrap shape (env reads, `aws-jwt-verify` instantiation at module scope)
- `packages/api/src/lib/cognito-auth.ts:53-64` for the lazy-memoized JWT verifier pattern
- `terraform/modules/app/lambda-api/main.tf:25-49` for the existing API Gateway HTTP API setup (used as a sibling to the new Function URL)

**Test scenarios:**
- Happy path (handler scaffold): `streamHandler` validates a valid JWT, emits keepalive every 15s, emits `: closing\n\n` at 14m, exits cleanly.
- Edge case (handler scaffold): invalid JWT in `Authorization` header — handler emits `event: error\ndata: ...\n\n` once if before first write, else closes connection.
- Error path (handler scaffold): client disconnect mid-stream — `responseStream.on('error', ...)` fires; cleanup runs synchronously.
- Integration (handler scaffold): full 14-minute simulated lifecycle in fake-timer test — keepalive count, internal-close, exit ordering.
- Happy path (browser hook): token rotates → hook closes existing EventSource and creates new one with the rotated token.
- Error path (browser hook): EventSource emits error → hook reconnects with exponential backoff (verify timing in fake-timer test).
- Integration (RN hook): AppState changes from `'active'` to `'background'` → `close()` called; back to `'active'` → new EventSource created.

**Verification:**
- The Function URL is created in the dev stage Terraform plan and outputs a `*.lambda-url.us-east-1.on.aws` URL.
- A curl against the URL with no `Authorization` header receives 401 (or whatever the handler scaffold emits — confirmed via integration test).
- The mobile app builds with `react-native-sse` added; production-mode Expo build runs without bundling errors.

---

### Phase 1 — First domain (inbox) — establishes the per-domain template

- U5. **Inbox domain: full vertical (server REST + zod, admin migration, mobile migration)**

**Goal:** First end-to-end domain migration. Establishes the inert→live seam swap pattern, the zod-schema-per-domain shape, the TanStack Query invalidation pattern, and the contract-test registration discipline. Use this unit's PRs as the template for U7–U11.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R21, R22

**Dependencies:** U1, U2, U3

**Execution note:** First domain — write the contract test scaffold (U3) registration FIRST, then the server handlers, then run the test, then client cutover. Treats inbox as the canary pattern; subsequent domains can collapse PRs.

**Files:**
- Create: `packages/api-schemas/src/inbox.ts` (zod schemas: `InboxItem`, `InboxItemList`, `InboxItemUpdate`, etc.)
- Create: `packages/api/src/handlers/inbox.ts` (REST handler with `parsePath()` sub-routing)
- Create: `apps/admin/src/lib/inbox-api.ts` (admin REST client functions wrapping `apiFetch()`)
- Create: `apps/admin/src/hooks/use-inbox.ts` (TanStack Query hooks; new file replacing the urql-based pattern in this domain)
- Modify: `packages/api/src/__tests__/rest-contract.test.ts` (register inbox handler)
- Modify: `apps/admin/src/lib/query-keys.ts` (add inbox namespace if missing)
- Modify: `apps/admin/src/lib/graphql-queries.ts` (remove inbox-related operations only — leave others for later units)
- Modify: admin route files using inbox: `apps/admin/src/routes/_authed/_tenant/inbox/*.tsx` and any component reading inbox data — swap urql `useQuery` to TanStack Query equivalents
- Modify: `apps/mobile/lib/hooks/use-inbox.ts` (replace urql + 1 `useSubscription` with TanStack Query polling)
- Modify: `apps/mobile/lib/graphql-queries.ts` (remove inbox-related operations)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (register new `inbox` Lambda)
- Modify: `scripts/build-lambdas.sh` (add `build_handler "inbox" "..."` line)
- Test: `packages/api/src/__tests__/handlers/inbox.test.ts` (handler-level tests)
- Test: `packages/api-schemas/src/__tests__/inbox.test.ts` (schema-shape tests)

**Approach:**
- PR-1 (inert): Land server handler + zod schemas + tests + `rest-contract.test.ts` registration. Handler is callable but no client uses it yet. Existing inbox GraphQL resolver continues serving production traffic.
- PR-2 (cutover): Swap admin and mobile inbox calls from urql to `apiFetch()` + TanStack Query. The 1 mobile `useSubscription` (`use-inbox.ts:8`) becomes a 30-second polled query. AppSync inbox subscription continues firing but no client listens.
- Polling intervals for inbox: list view 30s, detail view 15s (decided per-route during this PR's review).
- Optimistic updates on inbox-item mutations (mark read, archive): use `mutation.variables` UI-only pattern (single screen).
- After PR-2, inbox-related entries in the giant `apps/admin/src/lib/graphql-queries.ts` flat file are removed; subsequent domains chip away at this file the same way.

**Patterns to follow:**
- `packages/api/src/handlers/agents.ts` for handler shape, sub-resource routing, response helpers
- `packages/api/src/graphql/resolvers/inbox/` for the existing logic to port (inbox handler imports from `@thinkwork/database-pg` and reuses the same Drizzle queries)
- `apps/admin/src/lib/skills-api.ts` (or similar) for the admin REST client pattern that wraps `apiFetch()`
- TanStack Query mutation pattern: `useMutation({ onSuccess: () => queryClient.invalidateQueries(...) })`

**Test scenarios:**
- Happy path (server): `GET /api/inbox` returns paginated inbox items for the authenticated tenant (covers F1, R3).
- Happy path (server): `PATCH /api/inbox/:id` marks an inbox item as read (covers F2, R9).
- Edge case (server): list with no items returns empty array, not 404.
- Edge case (server): pagination cursor edge — last page returns `{items: [...], next: null}`.
- Error path (server): cross-tenant access → 403 (covers `requireTenantMembership` discipline; verified via U3 contract test).
- Error path (server): mutation without admin role on a tenant requiring admin → 403 (covers `requireTenantAdmin` discipline).
- Integration (server): inbox handler reaches the same Drizzle queries as the existing GraphQL resolver — same DB read produces same shape.
- Happy path (admin): inbox list page renders, refreshes on focus and on 30s interval (covers AE1).
- Happy path (mobile): inbox hook returns data via TanStack Query, no `useSubscription` import remains in the file.
- Integration (admin): mark-as-read mutation triggers optimistic UI update; mutation success invalidates inbox list query.

**Verification:**
- `pnpm --filter @thinkwork/api test` passes including new contract-test registration.
- Admin and mobile both render inbox without urql query/mutation/subscription invocations for inbox-related code (`grep useQuery.*urql apps/admin/src` finds no inbox-related usage).
- AppSync inbox subscription still fires server-side (intentional — no behavior change in the legacy stack until U12 cleanup).

---

### Phase 2 — Threads + messages domain (the SSE consumer)

- U6. **Threads + messages domain: full vertical with live-thread SSE**

**Goal:** Migrates the densest urql usage in the codebase AND exercises the SSE substrate end-to-end. Threads + messages is the "showcase" domain — once this works, the parallel rollout is mechanical.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R22

**Dependencies:** U1, U2, U3, U4, U5 (uses inbox as the established pattern)

**Files:**
- Create: `packages/api-schemas/src/threads.ts` (`Thread`, `ThreadList`, `ThreadCreate`, `ThreadUpdate`, `Message`, `MessageCreate`, `ThreadEvent` for SSE payloads)
- Create: `packages/api/src/handlers/threads.ts` (REST handler — list, get, create, update, delete; sub-resource routing for messages)
- Create: `packages/api/src/handlers/thread-events-stream.ts` (SSE handler — uses `sse-stream.ts` scaffold from U4, polls Aurora for new turns/messages, emits `event: thread.message` and `event: thread.turn`)
- Create: `apps/admin/src/lib/threads-api.ts` (admin REST client)
- Create: `apps/admin/src/hooks/{use-threads.ts, use-thread-events.ts}` (TanStack Query hooks; SSE-bridging hook for the live-thread route)
- Modify: `packages/api/src/__tests__/rest-contract.test.ts` (register threads handler)
- Modify: `apps/admin/src/lib/query-keys.ts` (extend threads namespace)
- Modify: `apps/admin/src/lib/graphql-queries.ts` (remove thread/message-related operations)
- Modify: admin thread routes: `apps/admin/src/routes/_authed/_tenant/threads/{index,$threadId}.tsx`, `apps/admin/src/components/threads/{ExecutionTrace,ThreadDetailSheet}.tsx`
- Modify: `apps/admin/src/context/AppSyncSubscriptionProvider.tsx` (remove thread/message subscription lines — others stay until their domains land)
- Modify: `apps/mobile/lib/hooks/use-messages.ts`, `apps/mobile/lib/hooks/use-threads.ts`
- Modify: `apps/mobile/lib/graphql-queries.ts` (remove thread/message-related operations)
- Modify: `terraform/modules/app/lambda-api/handlers.tf` (register `threads` Lambda + wire `thread-events-stream` Lambda to the Function URL from U4)
- Modify: `scripts/build-lambdas.sh` (add `threads` and `thread-events-stream` handler entries)
- Test: `packages/api/src/__tests__/handlers/threads.test.ts`
- Test: `packages/api/src/__tests__/handlers/thread-events-stream.test.ts` (uses fake timers, mock streaming response, assertions on SSE event sequence)
- Test: `apps/admin/src/hooks/__tests__/use-thread-events.test.tsx` (mock EventSource, assert cache writes on event arrival)

**Approach:**
- REST handler for threads/messages mirrors inbox's shape; sub-resource routing for `/api/threads/:id/messages` follows the `agents.ts` `parsePath()` precedent.
- SSE handler:
  - Validates JWT in handler entry, asserts `requireTenantMembership` (or read-only equivalent) for the thread's tenant.
  - Polls `messages` and `turns` tables every 1.5s using a watermark cursor (`since` from `Last-Event-ID` header on reconnect, or `now()` on initial connection).
  - Emits `event: thread.message\ndata: ...\n\n` for each new message; `event: thread.turn\ndata: ...\n\n` for turn updates.
  - Emits `: keepalive\n\n` every 15s (handled by U4 scaffold).
  - Emits `: closing\n\n` and exits at 14 minutes (handled by U4 scaffold).
- Client (admin): `use-thread-events.ts` opens an EventSource via the U4 hook, maps events to TanStack cache writes (`thread.message` → append to messages cache; `thread.turn` → invalidate turns cache). Polled query for the same thread is `enabled: false` while SSE is connected.
- Client (mobile): same shape via `react-native-sse` hook from U4. AppState backgrounding closes the connection; foreground reopens.
- The `AppSyncSubscriptionProvider.tsx` shrinks by removing thread/message subscription lines but stays in place for other domains until they're cut over.
- Polling intervals for thread list: 30s on focus + invalidate on mutation. Live thread route: SSE handles freshness; backup polled query at 60s as a safety net while connected (effectively never fires due to `enabled: false`).

**Patterns to follow:**
- U5 (inbox) for the per-domain shape
- `apps/admin/src/context/AppSyncSubscriptionProvider.tsx` lines 20-50 for the `subscription event → invalidateQueries` bridge — the SSE hook replaces this directly
- AWS Lambda streaming: SSE event format from external research findings (`data:`, `event:`, `: comment`, `\n\n` delimiters, `Last-Event-ID` header support)

**Test scenarios:**
- Happy path (REST): `GET /api/threads/:id` returns thread with metadata (covers F1, R3).
- Happy path (REST): `POST /api/threads/:id/messages` creates a message and returns the persisted shape (covers F2, R9).
- Edge case (REST): create message with empty content → 400 with zod error path.
- Error path (REST): cross-tenant thread access → 403.
- Happy path (SSE): client connects with valid JWT → receives keepalive every 15s; new message in DB → `event: thread.message` arrives at client within 2s (covers F3, R12, AE3).
- Edge case (SSE): client disconnects mid-stream → handler runs cleanup synchronously; no orphaned DB connections.
- Edge case (SSE): connection at 14m boundary → server emits `: closing\n\n` and ends; browser EventSource auto-reconnects; client resumes from `Last-Event-ID` watermark (covers AE4).
- Error path (SSE): invalid JWT → handler emits error event before first data write, then closes (since the connection is already 200 OK by the time the first error is written; note that handlers check JWT before first write).
- Error path (SSE): user without thread access → 403 before stream begins.
- Integration (admin): on live-thread route, SSE connects, polled `["threads", id, "messages"]` query is `enabled: false`, new messages appear in UI within 2s of DB write, ≤2s lag (covers AE3 success criterion).
- Integration (admin): user sends a message → optimistic UI update → mutation success → SSE event arrives → cache reconciled with server-side persisted shape.
- Integration (mobile): backgrounding the app closes SSE; foregrounding reconnects; messages received during background are fetched via initial `GET /api/threads/:id/messages` after reconnect (covers AE4 + reconnect resilience).

**Verification:**
- A user actively viewing a live thread sees agent turns appear within 2s of server-side write (F3 success criterion).
- Tab switch away from the thread → SSE connection closes within 1s (verified via Function URL connection metric in CloudWatch).
- `apps/admin/src/context/AppSyncSubscriptionProvider.tsx` no longer contains thread/message subscription wiring (`grep -n threadSub apps/admin/src/context/AppSyncSubscriptionProvider.tsx` returns nothing).

---

### Phase 3 — Parallel domain rollout

Each domain group below is a self-contained vertical (server REST + zod + admin migration + mobile migration where applicable + contract test registration). Order within Phase 3 is not strict — these can be parallelized across worktrees once U6 ships.

- U7. **Agents + scheduled-jobs + triggers + recipes domains: full vertical**

**Goal:** Cut over the agent management surface — admin's largest area outside of threads.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R22

**Dependencies:** U2, U3, U5 (template)

**Files:**
- Create: `packages/api-schemas/src/{agents,scheduled-jobs,triggers,recipes}.ts`
- Create: `packages/api/src/handlers/{agents-rest,scheduled-jobs,triggers,recipes}.ts` (note: existing `agents.ts` handler already exists for some operations — extend it rather than recreate; verify in PR review whether to extend or create a sibling)
- Create: `apps/admin/src/lib/{agents-api,scheduled-jobs-api,triggers-api,recipes-api}.ts`
- Create: `apps/admin/src/hooks/{use-agents,use-scheduled-jobs,use-triggers,use-recipes}.ts`
- Modify: contract test registration, `query-keys.ts`, `graphql-queries.ts`, `AppSyncSubscriptionProvider.tsx`, mobile equivalents, terraform handlers, `build-lambdas.sh`
- Test: per-handler unit tests + admin/mobile hook tests

**Approach:** Mirrors U5/U6 template. `AppSyncSubscriptionProvider.tsx` shrinks further. The `agents` `useSubscription` (in `routes/_authed/_tenant/agents/index.tsx` and `$agentId.tsx`) becomes a 30s polled list query + 15s polled detail query. Scheduled-jobs subscriptions become per-job-detail polling.

**Patterns to follow:** U5 (inbox), U6 (threads).

**Test scenarios:**
- Happy path: agent list / detail / scheduled-job CRUD operations work end-to-end.
- Edge case: nested triggers under a scheduled job — sub-resource routing handles correctly.
- Error path: cross-tenant agent access → 403.
- Integration: starting a scheduled-job mutation → optimistic UI → invalidation → list shows new state (covers AE2).

**Verification:** All 7 admin files mentioning agent/scheduled-job/trigger subscriptions no longer import from `urql`.

---

- U8. **Evaluations + skill-runs domains: full vertical**

**Goal:** Cut over the evals surface — second-largest subscription density after threads.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R22

**Dependencies:** U2, U3, U5 (template)

**Files:**
- Create: `packages/api-schemas/src/{evaluations,skill-runs}.ts`
- Create: `packages/api/src/handlers/{evaluations,skill-runs}.ts`
- Create: `apps/admin/src/lib/{evaluations-api,skill-runs-api}.ts`
- Create: `apps/admin/src/hooks/{use-evaluations,use-skill-runs}.ts`
- Modify: contract test, `query-keys.ts`, `graphql-queries.ts`, eval-related routes (`evaluations/index.tsx`, `evaluations/$runId.tsx`, `agents/$agentId_.scheduled-jobs.$scheduledJobId.tsx`)
- Modify: existing `packages/api/src/lib/eval-notify.ts` — REMOVE the `notifyEvalRunUpdate` function (callers continue calling it inert; deletion of callers happens in U12)
- Modify: terraform handlers, `build-lambdas.sh`
- Test: per-handler unit tests

**Approach:** Eval run progress polling at 5s during active runs (where seconds matter), 30s otherwise — `refetchInterval` is a function returning `number | false` that returns 5s when status is `running`, false when complete. Per-route opt-in.

**Patterns to follow:** U5 (inbox), U6 (threads).

**Test scenarios:**
- Happy path: eval run list refreshes; run detail polls at 5s during `running` and stops at completion.
- Edge case: eval run completing mid-poll — status flips, `refetchInterval` returns false, polling stops.
- Error path: missing run → 404.

**Verification:** Eval routes render without urql imports.

---

- U9. **Costs + observability + activity domains: full vertical**

**Goal:** Cut over cost tracking + activity feeds.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R22

**Dependencies:** U2, U3, U5

**Files:**
- Create: `packages/api-schemas/src/{costs,observability,activity}.ts`
- Create: `packages/api/src/handlers/{costs-rest,observability,activity-rest}.ts` (existing `activity.ts` handler may be extended rather than created — review in PR)
- Create: `apps/admin/src/lib/{costs-api,observability-api,activity-api}.ts`
- Create: `apps/admin/src/hooks/{use-costs,use-observability,use-activity}.ts`
- Modify: contract test, query-keys, graphql-queries, `ActivityView.tsx`, terraform handlers, build-lambdas
- Modify: `packages/api/src/lib/cost-recording.ts` — REMOVE `notifyCostRecorded` function (callers continue inert)

**Approach:** Cost ticker on dashboards polls at 60s. Activity feed polls at 30s.

**Test scenarios:**
- Happy path: cost ticker updates on focus return after 60s.
- Integration: cost mutation → activity entry appears on next activity-feed refetch.

**Verification:** Cost/activity admin routes render without urql.

---

- U10. **Tenant + teams + users + org domains: full vertical**

**Goal:** Cut over tenant/team/user management surfaces.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R22

**Dependencies:** U2, U3, U5

**Files:**
- Create: `packages/api-schemas/src/{tenants,teams,users,org}.ts` (existing `users.ts`/`teams.ts` handlers may be extended)
- Modify: contract test registration, query-keys, graphql-queries, admin/mobile routes for these domains, terraform handlers
- Note: `notifyOrgUpdate` exists in subscription schema but has no server-side caller — confirm during PR

**Approach:** These surfaces have low churn — 60s polling is plenty. No subscriptions in the original surface for org (only schema-declared, not wired). Migration is mostly removing urql query usage.

**Test scenarios:**
- Happy path: tenant member list, team CRUD, user invitation flow.
- Error path: non-admin role attempting team mutation → 403 via `requireTenantAdmin`.

**Verification:** Tenant/team/user admin routes render without urql.

---

- U11. **Long-tail domains rollup: artifacts, knowledge, memory, recipes-extras, templates, workspace, brain, wiki, quick-actions, webhooks, runtime, orchestration, runtime-manifests, agent-templates, core**

**Goal:** Sweep up the remaining ~15 domains in one unit. Most have low subscription presence and low call-site density; bundling them avoids 15 small ceremony-heavy PRs.

**Requirements:** R1, R2, R3, R5, R6, R7, R8, R9, R10, R22

**Dependencies:** U2, U3, U5

**Files:**
- Create: `packages/api-schemas/src/{artifacts,knowledge,memory,templates,workspace,brain,wiki,quick-actions,webhooks,runtime,orchestration,runtime-manifests,agent-templates,core}.ts`
- Create: corresponding REST handlers in `packages/api/src/handlers/`
- Create: corresponding admin lib + hooks
- Modify: query-keys, graphql-queries, admin/mobile components for these domains
- Modify: contract test registrations
- Modify: terraform handlers, build-lambdas

**Approach:** This is a large unit by file count but each domain is small (often 1-3 endpoints, no live updates). Could be split into 2-3 PRs in execution if review burden warrants — reviewer judgment call. Hand-wave the per-domain breakdown until starting work.

**Test scenarios (representative):**
- Happy path per domain: each domain's primary read endpoint returns expected shape.
- Error path per domain: cross-tenant access → 403.
- One integration test asserting the contract-test runner has registered all handlers.

**Verification:**
- `grep "from \"urql\"" apps/admin/src` returns NO results (all admin urql consumption is gone).
- `grep "from \"urql\"" apps/mobile` returns NO results.
- `apps/admin/src/lib/graphql-queries.ts` has no remaining query/mutation/subscription bodies (file may still exist as a stub at this point — full deletion in U12).
- `apps/admin/src/context/AppSyncSubscriptionProvider.tsx` is empty / can be deleted (U12 actually deletes it).

---

### Phase 4 — Single trailing cleanup PR

- U12. **Decommission: delete AppSync, schema build, urql, codegen, .graphql, notify*, GraphQL HTTP Lambda, terraform composer wiring**

**Goal:** Single trailing PR that deletes everything the migration retired. Runs after U7–U11 are all merged and validated in production.

**Requirements:** R16, R17, R18, R19, R20, R23, R24, R25

**Dependencies:** U5, U6, U7, U8, U9, U10, U11 (all domain cutovers complete)

**Execution note:** Per institutional learning #9, the implementer **must** run a fresh consumer survey on this branch (after `git fetch`) immediately before deletion: re-grep `notify*` callers, `useSubscription`, urql imports, `.graphql` references, `APPSYNC_*` env reads, `appsync_api_url` outputs. The planning-time inventory below is stale by execution time.

**Files:**
- Delete: `terraform/modules/app/appsync-subscriptions/` (entire directory: `main.tf`, `outputs.tf`, `variables.tf`)
- Delete: `terraform/schema.graphql`
- Delete: `scripts/schema-build.sh`
- Delete: `packages/database-pg/graphql/` (entire directory: `schema.graphql` + 27 type files)
- Delete: `packages/api/src/graphql/` (entire directory: server, context, notify, all 24 resolver folders)
- Delete: `packages/api/src/handlers/graphql-http.ts`
- Delete: `packages/api/src/__tests__/graphql-contract.test.ts` (REST contract test in U3 supersedes)
- Delete: `apps/admin/src/context/AppSyncSubscriptionProvider.tsx`
- Delete: `apps/admin/src/lib/graphql-queries.ts` (now empty stub)
- Delete: `apps/admin/src/lib/graphql-client.ts`
- Delete: `apps/admin/src/gql/` (codegen output)
- Delete: `apps/admin/codegen.ts`
- Delete: `apps/mobile/lib/graphql-queries.ts`
- Delete: `apps/mobile/lib/gql/`
- Delete: `apps/mobile/codegen.ts`
- Delete: `apps/cli/codegen.ts` (and any cli gql output)
- Modify: `packages/api/package.json` (remove `graphql-yoga`, `@graphql-tools/schema`, `graphql`)
- Modify: `apps/admin/package.json` (remove `urql`, `@urql/exchange-graphcache`, `@graphql-codegen/*`, `graphql-ws`, `graphql`)
- Modify: `apps/mobile/package.json` (remove `urql`, `@urql/exchange-graphcache`, `@graphql-codegen/*`)
- Modify: `apps/cli/package.json` (remove urql + codegen deps if present)
- Modify: root `package.json` (remove `schema:build` script)
- Modify: `terraform/modules/thinkwork/main.tf:164` (remove `module "appsync"` block) and lines 197-198, 216 (remove `appsync_api_url`/`appsync_api_key`/`appsync_realtime_url` wiring)
- Modify: `terraform/modules/thinkwork/outputs.tf:82-91` (remove appsync outputs)
- Modify: `terraform/modules/app/lambda-api/handlers.tf:30-32,59` (remove `APPSYNC_ENDPOINT`, `APPSYNC_API_KEY`, `GRAPHQL_API_KEY`, `APPSYNC_REALTIME_URL` env vars)
- Modify: `terraform/modules/app/lambda-api/variables.tf:95,100,225` (remove appsync variables)
- Modify: `terraform/examples/greenfield/main.tf:372-384` (remove appsync example outputs)
- Modify: `scripts/build-lambdas.sh` (remove the `graphql-http` handler entry; remove the `.graphql` file copy lines for graphql-http bundle)
- Modify: `.github/workflows/deploy.yml:849` (remove `appsync_api_url` echo line)
- Modify: `packages/api/src/lib/cognito-auth.ts:30` (remove `GRAPHQL_API_KEY` from accepted-keys list — see institutional learning #3 service-vs-user discipline)
- Modify: `packages/api/src/handlers/chat-agent-invoke.ts:475,524,824,899,838,260,458,507,729,875,1051,612,969` (remove all inline `notifyNewMessage`, `notifyThreadTurnUpdate`, `notifyCostRecorded` calls and their inline definitions)
- Modify: `packages/api/src/handlers/wakeup-processor.ts:1372,1445,1518,1543,1578,1665,1829,1906,2014,2056,2239` (same)
- Modify: `packages/api/src/handlers/eval-runner.ts:572,761` (remove `notifyEvalRunUpdate` calls)
- Modify: `packages/api/src/lib/oauth-token.ts:450` (remove `notifyNewMessage` call)
- Verify: no `useSubscription` or `urql` references remain anywhere in `apps/admin/src/` or `apps/mobile/`

**Approach:**
- Step 1 (pre-survey): On the cleanup branch after `git fetch && git rebase origin/main`, run the comprehensive grep checklist (`notify*`, `useSubscription`, `urql`, `.graphql`, `APPSYNC_`). Update the file list above to match reality. Surface any unexpected callers in PR description for reviewer.
- Step 2 (verify silent failures): Confirm `notifyEvalRunUpdate` and `notifyCostRecorded` were not load-bearing (already missing from AppSync resolver `for_each` per repo research; deletion is safe).
- Step 3 (deletion): Execute the deletion list. Run `pnpm install` to drop dependencies. Run `pnpm typecheck && pnpm test && pnpm build` to confirm nothing broken.
- Step 4 (terraform plan): Run `thinkwork plan -s dev` to confirm the plan shows AppSync resources being destroyed and no unexpected drift in other modules.
- Step 5 (deploy): Standard merge → main triggers `deploy.yml` which destroys AppSync; deploy summary no longer references appsync URL.

**Patterns to follow:**
- Institutional learning #9 pre-survey discipline.
- Institutional learning #3: `GRAPHQL_API_KEY` removal from `cognito-auth.ts` is part of cleaning up the service-vs-user widening that AppSync's API key encouraged.

**Test scenarios:**
- Verification (CI): `pnpm typecheck && pnpm test && pnpm lint && pnpm build` all pass after deletion.
- Verification (regression): admin and mobile end-to-end smoke — log in, list agents, view a thread, watch live, run an eval. All flows work without GraphQL stack.
- Verification (CloudWatch): the GraphQL HTTP Lambda receives no traffic for 24h before merge (validates no consumer remained).
- Verification (terraform): `terraform plan` shows AppSync resources destroyed; no unintended changes elsewhere.

**Verification:**
- `find . -name "*.graphql" -not -path "*/node_modules/*"` returns no results.
- `grep -r "from \"urql\"" apps/ packages/` returns no results.
- `grep -r "useSubscription" apps/` returns no results.
- `grep -r "notifyThreadUpdate\|notifyNewMessage\|notifyAgentStatus\|notifyHeartbeatActivity\|notifyInboxItemUpdate\|notifyThreadTurnUpdate\|notifyOrgUpdate\|notifyCostRecorded\|notifyEvalRunUpdate" packages/api/src/` returns no results.
- `grep -r "APPSYNC_" terraform/ packages/` returns no results (covers both env-var declarations and reads).
- No `package.json` in the repo has a `codegen` script.
- A clean clone + `pnpm install && pnpm -r build` does not invoke any GraphQL codegen step.

---

## System-Wide Impact

- **Interaction graph:** The `notify*` callers (chat-agent-invoke, wakeup-processor, eval-runner, cost-recording, oauth-token, thread/message mutation resolvers) currently fire-and-forget invalidation events. After migration these are pure DB writes; client-side polling and SSE replace the fanout. No change to the *write* path semantics — only the post-write notification path goes away.
- **Error propagation:** REST endpoints follow `packages/api/src/lib/response.ts` envelope. Error class invariant: 4xx for client errors (validation, auth, not-found), 5xx for server errors. CORS headers attached on every response (success and error) per institutional learning #1.
- **State lifecycle risks:**
  - During mid-migration, both AppSync subscriptions AND polling fire simultaneously for unmigrated domains. This is fine — TanStack Query dedupes refetches, and AppSync subscriptions invalidate the same cache keys. No double-write risk.
  - SSE handler holds an Aurora connection open for up to 14 minutes. Connection pool sizing (current Aurora setup at `terraform/modules/data/aurora-postgres/`) must accommodate the additional concurrent connections from active SSE Lambdas. Acceptance criterion: even with 50 concurrent live-thread viewers, Aurora connection pool has headroom (verify in U6 PR via load test).
  - The `Last-Event-ID` watermark for SSE reconnect resumes from a server-known timestamp. If the client is offline for >14 minutes during a thread's run, on reconnect it fetches the missed messages via the standard `GET /api/threads/:id/messages` first, then reconnects to SSE — handled in U4's RN/browser hook.
- **API surface parity:** Mobile and admin both follow the same domain hooks (`use-<domain>.ts`). The Strands agent runtime (`API_AUTH_SECRET`-protected handlers) is unchanged — service vs user surface stays separated per institutional learning #3.
- **Integration coverage:** U3's contract test runs against every new handler. Per-domain unit tests cover happy/edge/error paths. Mid-migration manual smoke test after each domain's PR-2 lands.
- **Unchanged invariants:**
  - Cognito user pool, Cognito auth flow (Google federation, JWT issuance) — unchanged.
  - Aurora schema and Drizzle migrations — unchanged (the migration is API-layer-only).
  - The Strands agent runtime, AgentCore, all infrastructure outside the API tier — unchanged.
  - `API_AUTH_SECRET` and the dedicated service handlers (skills.ts, agentcore admin) — unchanged.
  - Cognito identity pool — unchanged (vestigial; out of scope).
  - The `tenant_members` row check (`requireTenantMembership`) — same auth guarantees as today, just enforced at REST layer instead of GraphQL.

---

## Phased Delivery

### Phase 0 — Substrate (blocks all subsequent work)

- U1. Worktree bootstrap script
- U2. `@thinkwork/api-schemas` shared zod package
- U3. CORS + auth contract test runner
- U4. SSE substrate (Function URL + handler scaffold + RN/browser client wrappers)

**Exit criteria:** `pnpm install` succeeds in fresh worktree → bootstrap script runs clean → schemas package builds and is consumable from a test import → contract test runner is registered in CI and passes against a stub handler → SSE Function URL is created in dev with stub Lambda, returns expected response → mobile build includes `react-native-sse`.

### Phase 1 — Inbox beachhead (establishes the per-domain template)

- U5. Inbox domain full vertical

**Exit criteria:** Admin and mobile inbox surfaces render via REST + TanStack Query. The 1 mobile inbox subscription is gone. `apps/admin/src/lib/graphql-queries.ts` has its inbox section deleted. AppSync inbox subscription is still firing server-side (intentional — legacy stack stays alive until U12).

### Phase 2 — Threads + messages (SSE consumer)

- U6. Threads + messages domain full vertical with live-thread SSE

**Exit criteria:** A user actively viewing a live thread sees agent turns within 2s of server-side write. Tab switch closes the SSE connection within 1s. `AppSyncSubscriptionProvider.tsx` no longer wires thread/message subscriptions. End-to-end mobile path works on a production build (debug build SSE limitation acknowledged).

### Phase 3 — Parallel domain rollout

- U7. Agents + scheduled-jobs + triggers + recipes
- U8. Evaluations + skill-runs
- U9. Costs + observability + activity
- U10. Tenant + teams + users + org
- U11. Long-tail domain sweep

**Exit criteria:** All 36 admin `useSubscription` call sites are gone. All 2 mobile `useSubscription` call sites are gone. `grep "from \"urql\"" apps/admin/src apps/mobile` returns nothing. `AppSyncSubscriptionProvider.tsx` is either empty or can be deleted at any moment. All domain Lambdas are deployed and serving production traffic; legacy GraphQL HTTP and AppSync continue running but receive no client traffic.

### Phase 4 — Trailing cleanup

- U12. Decommission

**Exit criteria:** No `.graphql` files anywhere. No `urql` in any `package.json`. No `codegen` scripts. AppSync resources destroyed in dev/prod terraform plans. `pnpm install && pnpm -r build` runs without any GraphQL-related step. Admin and mobile end-to-end smoke tests pass post-deletion.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mobile SSE breaks under iOS backgrounding edge cases | Medium | High (live-thread feels broken on mobile) | U4's `react-native-sse` hook integrates `AppState` for foreground reconnect; production builds only; explicit AE4 acceptance test; production parity check in U6 PR before merge |
| Aurora connection pool saturation under concurrent SSE | Low | Medium (other Lambdas can't get DB connections) | U6 PR includes a load test with 50 concurrent live-thread viewers against dev Aurora; alarm thresholds set on `DatabaseConnections` metric |
| Thundering herd on tab return after user leaves multiple tabs open | Medium | Low (latency spike, not failure) | Per-route `refetchInterval` jitter (`base + Math.random()*5000`); `staleTime: 30s` blocks most focus refetches |
| `notify*` deletion in U12 misses an inline caller | Medium | Medium (silent dead code or build break) | Pre-cleanup grep survey per institutional learning #9; CI typecheck + lint catches dead-import cases |
| Mid-migration domain calls both old GraphQL and new REST simultaneously | High | Low (functional but extra traffic) | Per-domain PR-2 ensures complete cutover for that domain; no domain straddles long-term |
| `requireTenantAdmin` missed on a new mutation handler | Medium | Critical (cross-tenant write authz hole) | U3 contract test enforces it for every registered handler; CI gate; institutional learning #4 carries forward |
| Codegen artifacts referenced by tooling outside the migration scope (e.g., docs site) | Low | Low (build break) | U12 grep for `gql/`, `graphql-queries.ts`, codegen config across all apps including `apps/www` and `docs/` |
| Function URL CORS misconfigured for cross-origin admin SPA | Low | High (SSE never connects from production admin) | U4 PR includes manual curl test from admin's deployed origin against the dev Function URL with explicit `Origin` header; `cors` block on `aws_lambda_function_url` is reviewed against admin's served origin |
| 14-minute internal SSE close races with thread completion | Low | Low (one extra reconnect cycle) | Acceptable; reconnect logic handles it via `Last-Event-ID` watermark |
| Long-tail domain (U11) bundles too much into one PR | Medium | Medium (review burden) | Reviewer judgment splits U11 into 2-3 PRs if needed; no architectural commitment to keep it monolithic |
| Cognito identity pool was actually used by AppSync IAM auth | Low | Medium (deletion breaks something assumed orthogonal) | U12 pre-survey checks for `iot:` / `appsync:` IAM references on the identity pool roles before merging |
| `notifyEvalRunUpdate` / `notifyCostRecorded` are silently load-bearing despite missing AppSync resolvers | Low | Low (research showed they're not, but verify) | U8/U9 PR descriptions explicitly note this finding; U12 pre-cleanup confirms before deletion |

---

## Documentation / Operational Notes

- Update `CLAUDE.md` "Architecture: the end-to-end data flow" section after U12 lands (remove AppSync references from the data-flow narrative).
- Update `CLAUDE.md` "Database / GraphQL schema" section — replace with "Database / API schema" describing zod-first pattern.
- Update `apps/admin/README.md` (if exists) and `apps/mobile/README.md` to reflect TanStack Query + REST as the data-fetching contract.
- Add `packages/api-schemas/README.md` with usage instructions (server `.parse()`, client `z.infer<>`, contribution guidelines).
- After U12, archive `docs/brainstorms/2026-04-30-rest-and-polling-cutover-requirements.md` and this plan as compounded learning candidates per `/ce-compound`.
- Operational: monitor Aurora `DatabaseConnections` metric during Phase 2 (U6) rollout; expect a small bump from concurrent SSE Lambdas, alarm if >80% of pool sustained.
- Rollout: each PR-2 (client cutover) ships in a coordinated admin + mobile release per R24 (no straddle support). Plan window where neither client is mid-migration to avoid version-mismatch confusion.
- No feature flags; `enable_hindsight`-style toggles are out of scope. Per-domain cutover is the rollout primitive.

---

## Deferred / Open Questions

### From 2026-04-30 review

**P0 — Critical**

- **CLI is built on urql/GraphQL — `thinkwork wiki/eval/me` will break at U12** — U12 Decommissioning (P0, feasibility, confidence 100)

  `apps/cli/src/lib/gql-client.ts` imports from `@urql/core` and is consumed by ~20 CLI command files (wiki/*, eval/*, me.ts) per `grep -rln '@urql/core\|gql-client' apps/cli/src` returning 20 files. R25 only excludes Strands runtime, not the CLI. U12 deletes only `apps/cli/codegen.ts` and `urql + codegen deps if present` from `apps/cli/package.json` — does not migrate any CLI command's runtime GraphQL usage. When U12 deletes `packages/api/src/handlers/graphql-http.ts`, `thinkwork wiki compile`, `thinkwork eval run`, `thinkwork me` all stop working. Need a CLI migration unit (e.g., U10.5) before U12, or extend R25 to also exclude the CLI and explicitly defer CLI migration as a separate plan.

  <!-- dedup-key: section="u12 decommissioning" title="cli is built on urql graphql thinkwork wikievalme will break at u12" evidence="apps/cli/src/lib/gql-client.ts imports from @urql/core and is consumed by ~20 CLI command files" -->

- **`@thinkwork/react-native-sdk` is fully GraphQL/urql-based — mobile breaks at U12** — U12 Decommissioning (P0, feasibility, confidence 100)

  `packages/react-native-sdk/package.json` declares `@thinkwork/react-native-sdk` v0.4.0-beta.0 with `packages/react-native-sdk/src/graphql/{queries.ts, appsync-ws.ts, client.ts, provider.tsx}` and 9 hook files (use-thread/use-threads/use-messages/use-agents/use-subscriptions/use-tenant-entity-page/use-wiki-graph/use-mobile-memory-captures/use-mobile-memory-search) all importing urql. Mobile imports `useAgents`, `useThreads`, `useMessages`, `useThreadTurnSubscription` from `@thinkwork/react-native-sdk` (apps/mobile/app/chat/index.tsx, threads/index.tsx). Plan U12 file-list contains zero references to `packages/react-native-sdk/`; plan exit criterion `grep "from \"urql\"" apps/mobile returns nothing` is satisfiable only because the urql imports live in the SDK package, which the grep doesn't cover. Each per-domain unit (U5–U11) must rewrite the corresponding SDK hook, and the SDK needs a major version bump after U12.

  <!-- dedup-key: section="u12 decommissioning" title="thinkworkreactnativesdk is fully graphqlurqlbased mobile breaks at u12" evidence="packages/react-native-sdk declares published SDK with full urql/graphql data layer used by mobile" -->

- **Aurora connection pool exhaustion under SSE load** — U4 SSE substrate / U6 Threads (P0, feasibility + adversarial cross-persona, confidence 100)

  `packages/database-pg/src/db.ts:118` sets per-Lambda pool `max: 2` with `idleTimeoutMillis: 120_000`. Aurora is provisioned at min 0.5, max 2 ACU (`terraform/modules/data/aurora-postgres/variables.tf:89,95`) — approximately 90-189 connections at max. SSE Lambda holds an Aurora connection for up to 14 minutes per concurrent viewer; warm Lambda containers also serve other invocations from the 2-slot pool. At 50 concurrent viewers the pool is 30-50% consumed before any other Lambda traffic. The SSE handler scaffold in U4 must acquire a dedicated `pg.Client` (not the shared `getDb()` singleton) at connection start, hold it only across the polling loop's transaction, and `client.release()` on close. Load-test ceiling (50) may also need to scale beyond 50 to match the documented 4-enterprise scale target.

  <!-- dedup-key: section="u4 sse substrate" title="aurora connection pool exhaustion under sse load" evidence="db.ts:118 max:2 per Lambda pool; SSE holds 14min; 50 viewers = 30-50% of pool before other traffic" -->

- **SSE wire format missing `id:` field per event — Last-Event-ID reconnect impossible** — U6 SSE wire format (P0, adversarial, confidence 75)

  Plan's wire format example (lines 222-230) emits `event: thread.message\ndata: {...}\n\n` with NO `id:` line per event. Without an `id:` field, the browser EventSource never populates `Last-Event-ID` on reconnect. The plan's stated reconnect contract (`since` from Last-Event-ID header on reconnect, or `now()` on initial connection) is structurally impossible: the server never sent an id, so the client has nothing to send back. Concrete failure: at the 14-minute boundary, server emits `: closing`, stream ends. Browser auto-reconnects with no `Last-Event-ID` header → handler treats it as initial connection → watermark = `now()` → any messages/turns written between server-side close and the new GET arriving (200ms-2s) are silently dropped. AE4 says reconnect resumes streaming events, but the user just lost messages.

  <!-- dedup-key: section="u6 sse wire format" title="sse wire format missing id field lasteventid reconnect impossible" evidence="event: thread.message\\ndata: {id...} no id: line; reconnect contract since=Last-Event-ID structurally impossible" -->

- **U5 removes inbox graphql-queries exports without modifying AppSyncSubscriptionProvider — TS build break** — U5 Files (P0, adversarial, confidence 75)

  U5 file list says `Modify: apps/admin/src/lib/graphql-queries.ts (remove inbox-related operations only — leave others for later units)` but does NOT list `apps/admin/src/context/AppSyncSubscriptionProvider.tsx` as a U5 modify target. The provider directly imports `OnInboxItemStatusChangedSubscription` from graphql-queries.ts (verified at AppSyncSubscriptionProvider.tsx:10). The moment U5 removes that export, admin TypeScript compilation breaks: `Module has no exported member 'OnInboxItemStatusChangedSubscription'`. Build is red between U5 PR-2 merging and U6 picking up. CI typecheck gate will fail the cutover PR or block subsequent deploys. Add AppSyncSubscriptionProvider.tsx to U5's modify list with the inbox subscription wiring removal.

  <!-- dedup-key: section="u5 files" title="u5 removes inbox graphqlqueries exports without modifying appsyncsubscriptionprovider ts build break" evidence="AppSyncSubscriptionProvider.tsx:10 imports OnInboxItemStatusChangedSubscription from graphql-queries.ts" -->

**P1 — Significant**

- **`scripts/build-admin.sh` writes `VITE_GRAPHQL_*` env vars; not in U12 deletion list** — U12 Files (P1, feasibility, confidence 100)

  `scripts/build-admin.sh:53–56` writes `VITE_GRAPHQL_HTTP_URL`, `VITE_GRAPHQL_URL`, `VITE_GRAPHQL_WS_URL`, `VITE_GRAPHQL_API_KEY` into `apps/admin/.env.production` from `tf_output_raw appsync_api_url/appsync_api_key`. Plan U12 mentions `terraform/examples/greenfield/main.tf:372-384` (the appsync output blocks) but `tf_output_raw appsync_api_url` calls in `build-admin.sh:28-30` will fail with "output not found" once those Terraform outputs are removed. U12 ships, deploy.yml runs build-admin.sh, the script tries `tf_output_raw appsync_api_url` against a Terraform state where the output was just removed, deploy fails, merge is broken. Add `scripts/build-admin.sh` to U12's Modify list — strip the four `VITE_GRAPHQL_*` env writes and the `tf_output_raw appsync_api_url/appsync_api_key/appsync_realtime_url` reads.

  <!-- dedup-key: section="u12 files" title="scriptsbuildadminsh writes vitegraphql env vars not in u12 deletion list" evidence="build-admin.sh:53-56 writes VITE_GRAPHQL_* env vars from tf_output_raw appsync_api_url/appsync_api_key" -->

- **`notifyConnectionExpired` in `oauth-token.ts` missing from 9-helper checklist** — U12 Files (P1, feasibility, confidence 100)

  `packages/api/src/lib/oauth-token.ts:420` exports `async function notifyConnectionExpired` — a 10th notify helper that calls AppSync directly; not in plan's grep checklist of 9 (notifyThreadUpdate/NewMessage/AgentStatus/HeartbeatActivity/InboxItemUpdate/ThreadTurnUpdate/OrgUpdate/CostRecorded/EvalRunUpdate). `oauth-token.ts:413` calls `notifyConnectionExpired(connectionId, tenantId, reason)`; plan's U12 says modify `oauth-token.ts:450` to "remove notifyNewMessage call" — but line 450 is INSIDE notifyConnectionExpired's body (the inlined GraphQL mutation it sends to AppSync). If U12 only removes the inline call at line 450 per the plan literal, `notifyConnectionExpired` becomes a wrapper around stripped AppSync code (dead) but is still called from line 413. Update U12's grep checklist to include `notifyConnectionExpired` and delete the entire function plus its caller.

  <!-- dedup-key: section="u12 files" title="notifyconnectionexpired in oauthtokents missing from 9helper checklist" evidence="oauth-token.ts:420 notifyConnectionExpired is 10th notify helper; plan only enumerates 9" -->

- **U12 deletes `graphql-client.ts` but AuthContext/TenantContext/main.tsx still import non-urql exports** — U12 Files (P1, scope-guardian, confidence 100)

  `apps/admin/src/lib/graphql-client.ts` exports `setAuthToken`, `setTokenProvider`, `startTokenRefresh`, `stopTokenRefresh` (imported by AuthContext.tsx) and `setGraphqlTenantId` (imported by TenantContext.tsx); main.tsx imports `graphqlClient`. U12 lists this file as a deletion target but no prior unit migrates these callers — the auth token plumbing is wired into the Cognito refresh cycle. Admin build breaks at U12. Add an explicit step in U12 (or U5/U6 PR-2) to migrate the auth token plumbing into `api-fetch.ts` or a dedicated auth-token-store module, update AuthContext and TenantContext, then delete graphql-client.ts. The pre-survey checklist must include these non-urql callers explicitly.

  <!-- dedup-key: section="u12 files" title="u12 deletes graphqlclientts but authcontexttenantcontextmaintsx still import nonurql exports" evidence="graphql-client.ts exports setAuthToken/setTokenProvider/startTokenRefresh/stopTokenRefresh/setGraphqlTenantId imported by AuthContext, TenantContext, main.tsx" -->

- **Dynamic `import("../graphql/notify.js")` in chat-agent-invoke.ts:837 not caught by typecheck** — U12 Files (P1, adversarial, confidence 75)

  `packages/api/src/handlers/chat-agent-invoke.ts:837` does `const { notifyThreadUpdate } = await import("../graphql/notify.js")` dynamically. TypeScript does NOT type-check `await import()` string literals as path references in many configurations. The dynamic import will fail at runtime AFTER U12 deletes `packages/api/src/graphql/`, but typecheck won't catch it. Failure mode: U12 ships, deploy succeeds, chat-agent-invoke runs, hits line 837, throws `Cannot find module ../graphql/notify.js`, the entire agent invocation fails. The plan's pre-survey discipline says to re-grep `notify*` callers — that grep finds 13 call sites, not the dynamic-import string literal. Add `import.*graphql/notify` to the U12 pre-survey grep set.

  <!-- dedup-key: section="u12 files" title="dynamic importgraphqlnotifyjs in chatagentinvokets837 not caught by typecheck" evidence="chat-agent-invoke.ts:837 const notifyThreadUpdate await import graphql/notify.js" -->

- **No rollback runbook for U12 once deletion ships** — Risks (P1, adversarial, confidence 75)

  The "no predetermined fallback condition" commitment is true mid-migration but not post-U12. Before U12, the legacy stack runs alongside; reverting any single domain PR brings back urql + GraphQL for that domain, easy. AFTER U12 deletes AppSync, schema build, urql, codegen, graphql-http Lambda, and 24 resolver folders — reverting requires reconstituting all of that from a single revert commit AND re-running `pnpm install` AND re-deploying terraform AND restoring AppSync resources from scratch (which Terraform recreates with new ARNs and which existing TestFlight clients won't trust). U12 verification "GraphQL HTTP Lambda receives no traffic for 24h before merge" is asserted as a gate but the plan does not specify enforcement — manual check, CloudWatch alarm, or hard-blocked on a metric? A forgotten admin worktree on a developer laptop, an old browser tab, a TestFlight client mid-update — any of these fail the gate silently. There is no rollback runbook for "U12 merged, then 30 minutes later prod breaks."

  <!-- dedup-key: section="risks" title="no rollback runbook for u12 once deletion ships" evidence="Verification CloudWatch GraphQL HTTP Lambda receives no traffic for 24h before merge ... No predetermined fallback condition" -->

- **Three architectural decisions misclassified as Scope Boundaries exclusions** — Scope Boundaries (P1, coherence, confidence 100)

  Lines 80-82 list three items that are chosen architectural decisions ("Per-endpoint Lambda topology (per-domain handler is the chosen shape)", "Aurora LISTEN/NOTIFY (in-Lambda poll is the chosen shape)", "Cognito identity pool removal (vestigial; orthogonal to this work)"), not out-of-scope exclusions. Readers will confuse exclusions with decisions and may incorrectly assume these architectures are debatable mid-implementation. Move these three items from Scope Boundaries section into Key Technical Decisions where they logically belong with similar decision statements like "Lambda topology = per-domain handler with internal sub-routing".

  <!-- dedup-key: section="scope boundaries" title="three architectural decisions misclassified as scope boundaries exclusions" evidence="Lines 80-82 Per-endpoint Lambda topology / Aurora LISTEN/NOTIFY / Cognito identity pool listed under Scope Boundaries header" -->

- **Cross-document R3 mismatch: brainstorm lists "scheduled jobs"; plan R3 doesn't** — Requirements (P1, coherence, confidence 75)

  Brainstorm R3 explicitly lists "scheduled jobs" as a domain. Plan R3 references "24 resolver folders" but the enumerated list does not include a "scheduled-jobs" resolver. Implementer may miss a domain entirely or migrate it twice if it's renamed mid-work. Verify whether `packages/api/src/graphql/resolvers/` contains a "scheduled-jobs" or similar folder; if it exists, add it to the 24-domain list; if it doesn't exist, clarify in the plan whether "scheduled jobs" queries are subsumed under another domain, and update the brainstorm origin document to match. This same shape applies to several other domain enumeration mismatches (recipes-extras, activity, tenants/users, runtime-manifests/agent-templates) — collapsed under P2 "Domain enumeration mismatch."

  <!-- dedup-key: section="requirements" title="crossdocument r3 mismatch brainstorm lists scheduled jobs plan r3 doesnt" evidence="Brainstorm R3 lists scheduled jobs; Plan R3 references 24 resolver folders, enumeration omits scheduled-jobs" -->

- **TestFlight distribution lag breaks R24 hard-cutover assumption** — R24 / Operational notes (P1, product-lens + adversarial cross-persona, confidence 100)

  R24 commits to "no backwards-compatibility shims for clients running mid-migration. Each release ships admin and mobile updates together." Eric publishes the mobile app via TestFlight (per project memory `project_mobile_testflight_setup.md`), where TestFlight builds propagate at Apple's pace and users update on their own schedule. Admin redeploys on merge-to-main; mobile rollout takes Apple review plus user install latency, often days to weeks. After U12 ships, mobile users still on older TestFlight builds will hit deleted GraphQL endpoints with no fallback. The 24h CloudWatch quiet period validates no live web/admin traffic but does not account for mobile clients offline, on cellular, or slow to update. Plan must define a minimum mobile-version-uptake threshold (e.g., "95% of active mobile users on a build that consumes the new REST stack") before U12 is allowed to ship.

  <!-- dedup-key: section="r24 operational notes" title="testflight distribution lag breaks r24 hardcutover assumption" evidence="R24 no backwards-compatibility shims; mobile TestFlight propagation takes Apple review plus user install latency" -->

- **SSE error UI states not specified for live-thread route** — U4 / U6 SSE (P1, design-lens, confidence 100)

  The live-thread route is the single UX surface the plan calls out as latency-critical (≤2s lag). When the SSE connection fails before the first byte (network drop, JWT rejection, Function URL CORS misconfiguration), the plan specifies what the server emits but never specifies what the user sees. The implementer will make a judgment call — likely a silent spinner — producing an invisible failure state on the one screen where the user is watching real-time agent output. There is no design direction for distinguishing "loading", "connected", "reconnecting after 14-min close", and "hard error (cannot connect)" in the UI. AE3 only covers the happy path. Specify each of the four SSE connection states and what is displayed to the user in each, including whether the polling fallback becomes visible in the hard-error state.

  <!-- dedup-key: section="u4 u6 sse" title="sse error ui states not specified for livethread route" evidence="U4 invalid JWT handler emits event:error; U6 maps events to TanStack cache writes — no UI state specified for connecting/reconnecting/error" -->

- **Mid-domain-cutover UX divergence undefined for operators** — Phased Delivery (P1, design-lens, confidence 100)

  During Phase 3, an admin operator simultaneously sees: inbox refreshing on focus return (30s poll), thread list refreshing on focus return (30s poll), and the agents list, evaluations, and cost surfaces still driven by AppSync subscriptions that invalidate an urql cache. Different surfaces in the same SPA will behave inconsistently — some update automatically, others stall — with no UI signal to indicate which. If an operator is mid-session when a domain cuts over (PR-2 deploys), the page will have a mix of stale urql cache and fresh TanStack Query cache with no reconciliation path defined. R24's "no shims" addresses binary version shims but not the intra-session mixed state during the multi-week migration window. Specify whether a page reload is required at cutover boundaries, whether a banner/indicator acknowledges the in-progress state, and what stale-data appearance is acceptable on not-yet-migrated domains.

  <!-- dedup-key: section="phased delivery" title="middomaincutover ux divergence undefined for operators" evidence="During Phase 3, admin operator sees inbox/thread polling alongside agents/evals/costs still on AppSync subs; no UX direction for mixed state" -->

- **AppSync subscription toasts (`toast.success/warning`) lost when polling replaces subscriptions** — U5 / Subscription provider (P1, adversarial, confidence 75)

  AppSyncSubscriptionProvider.tsx fires `toast.success/warning/info/error` on inbox + agent + thread events (e.g., "Inbox item APPROVED"). After U5 swaps inbox to TanStack Query polling, the polling refetch returns updated data but emits NO toast — the UX changes (no real-time-feeling notification on inbox approval). Plan's R9 covers the mutator's feedback, not third-party-tab notifications. Plan does not state whether toasts are part of the migration's product contract or are silently dropped. Resolve: either replicate the toast UX through a polled-event-detection layer, deprecate the toasts intentionally, or document the UX change.

  <!-- dedup-key: section="u5 subscription provider" title="appsync subscription toasts toastsuccesswarning lost when polling replaces subscriptions" evidence="AppSyncSubscriptionProvider line 75-80 toast.success/warning/info/error on inbox/agent/thread events" -->

- **Function URL `authorization_type = "NONE"` requires explicit pre-first-byte JWT discipline** — U4 SSE substrate (P1, security-lens, confidence 75)

  Lambda Function URLs with `authorization_type = "NONE"` are reachable by any internet client without any AWS IAM or Cognito authorizer gate. The plan's mitigation is JWT validation in the handler, which is correct in principle, but any implementation bug in `sse-stream.ts` (auth check after first stream write, async exception not caught, streaming response already started before auth check throws) would produce either a 200 OK stream with no data or a silent hang. Function URL streaming responses always return 200 once the stream is opened, so the error signal is inside the SSE event body, not in the HTTP status code. An unauthenticated scan of the SSE endpoint URL would receive a 200 with an SSE error event rather than a 401, and automated vulnerability scanners would not flag it. Specify that `validateJwt` must run synchronously before `awslambda.streamifyResponse` yields control to the response body; add a contract test asserting the JWT check runs before any `stream.write()` call.

  <!-- dedup-key: section="u4 sse substrate" title="function url authorizationtype none requires explicit prefirstbyte jwt discipline" evidence="Plan: Function URL with invoke_mode RESPONSE_STREAM and authorization_type NONE; JWT validated in handler" -->

- **SSE polling loop tenant scope predicate not enforced — IDOR risk on guessable thread UUIDs** — U6 SSE handler (P1, security-lens, confidence 75)

  Handler asserts `requireTenantMembership` at connect, but the polling-loop SQL query `WHERE thread_id = :id AND created_at > :watermark` has no `tenant_id` predicate documented. If a user from Tenant A guesses or enumerates a thread UUID belonging to Tenant B, they would receive that thread's events after passing their own tenant's membership check. The pattern in REST handlers (`agents.ts:117`: `and(eq(agents.id, id), eq(agents.tenant_id, tenantId))`) is correct, but that discipline is on implementer judgment. Add an explicit test scenario to U6: "cross-tenant thread ID supplied — authenticated user from Tenant A requests stream for a thread UUID belonging to Tenant B → 403 before stream begins, OR polling query returns no rows."

  <!-- dedup-key: section="u6 sse handler" title="sse polling loop tenant scope predicate not enforced idor risk on guessable thread uuids" evidence="GET /threads/:id/events thread ID is caller-supplied; polling SQL where thread_id without tenant_id predicate documented" -->

- **`messages.ts` (existing service handler) name collides with U6 threads/messages domain** — U6 / U8 / handlers (P1, adversarial, confidence 75)

  `packages/api/src/handlers/messages.ts` uses `validateApiSecret` at line 30 and rejects any request without an API secret token (Strands runtime caller per R25). U6 plans `packages/api/src/handlers/threads.ts` "REST handler — list, get, create, update, delete; sub-resource routing for messages" — a Cognito-JWT user-domain handler. If U6 creates `messages-rest.ts` for browser users while leaving `messages.ts` as a service handler, the plan does not say so. If U6 instead replaces `messages.ts`, the Strands runtime's existing callers break. Plan's "service vs user surface discipline" is asserted but the messages.ts case is not explicitly resolved. Decide: extend `messages.ts` to accept both auth modes (rejected by service-vs-user discipline), keep them separate with distinct route prefixes (e.g., `/api/messages` for service vs `/api/threads/:id/messages` for users), or rename one.

  <!-- dedup-key: section="u6 u8 handlers" title="messagests existing service handler name collides with u6 threadsmessages domain" evidence="messages.ts uses validateApiSecret; U6 creates threads.ts with sub-resource routing for messages" -->

- **SSE 1.5s polling at 50 viewers = ~33 QPS sustained baseline + per-tab multiplier** — U6 SSE (P1, adversarial, confidence 75)

  With 1.5s poll cadence over a 14-minute connection that's 560 SELECT queries per active viewer per session. At 50 concurrent viewers (the stated load-test target) that's 28,000 queries every 14 minutes, or ~33 queries per second sustained baseline JUST for SSE. That competes directly with all other REST handlers' query budget on the same 0.5-2 ACU cluster. The plan's risk-analysis row "thundering herd on tab return" is rated Low impact — but the steady-state SSE poll volume is a separate, larger concern that the risk table does not address. Worse, multiple admin tabs on the same thread will EACH open an SSE connection (the plan's "enabled: false on the polled query while SSE is connected" is per-tab, not per-thread) — there is no server-side connection deduplication. Consider per-thread query result caching (15-30s TTL) or a server-side connection-deduplication primitive.

  <!-- dedup-key: section="u6 sse" title="sse 15s polling at 50 viewers 33 qps sustained baseline pertab multiplier" evidence="SSE Polls messages and turns tables every 1.5s; 50 viewers × 14min × 1/1.5s = 28000 queries/14min = ~33 QPS baseline" -->

- **U3 contract test misses unregistered handlers** — U3 (P1, adversarial, confidence 75)

  U3 contract test is parameterized with a registry — each domain's PR adds its handler to the registration list. Failure mode: a future domain handler is created but the developer forgets to register it in `rest-contract.test.ts`. The contract test passes (it has no entry to test). The handler ships to production missing OPTIONS-bypass-auth or CORS-on-error or `requireTenantAdmin` ordering — exactly the institutional-learning class the test exists to prevent. The plan does NOT include any orthogonal CI check that scans `packages/api/src/handlers/*.ts` and asserts each is registered. Add a discovery test that globs `packages/api/src/handlers/*.ts`, parses each for a default export, and asserts each is in the registry.

  <!-- dedup-key: section="u3" title="u3 contract test misses unregistered handlers" evidence="U3 each subsequent domain unit adds its handler to the registration list as part of that unit's PR" -->

**P2 — Notable**

- **Domain enumeration mismatch between R3's 24-list and U7-U11's 31 enumerated domains** — Requirements / U7-U11 (P2, coherence, confidence 75 + 4 related variants demoted to FYI)

  Plan claims "mirrors the 24 resolver folders" with explicit list. But the implementation units enumerate 31 domain names across U5-U11 (inbox=1, threads+messages=2, U7=4, U8=2, U9=3, U10=4, U11=15). U7 lists "scheduled-jobs", U9 lists "activity", U10 lists "tenants/users", U11 lists "recipes-extras/runtime-manifests/agent-templates" — none of these appear in the 24-domain list. Implementer will be confused about whether all 31 are real GraphQL resolvers or whether some are new creations. Cross-check the actual 24 resolver folders in `packages/api/src/graphql/resolvers/` against the domain names in the enumerated list and reconcile.

  <!-- dedup-key: section="requirements u7u11" title="domain enumeration mismatch between r3s 24list and u7u11s 31 enumerated domains" evidence="R3 mirrors 24 resolver folders; U7-U11 enumerate 31 domain names including scheduled-jobs/activity/tenants/users/recipes-extras/runtime-manifests/agent-templates" -->

- **AppSyncSubscriptionProvider has 4 hooks (not 2 implied); mobile useSubscription count off-by-one** — U6 Files (P2, feasibility, confidence 100)

  Plan U6 says "remove thread/message subscription lines" implying 1-2 lines but actual structure is 4 distinct hooks (agent at line 25, thread at 46, inboxItem at 63, turnUpdate at 136). Phase 3 exit criterion says "All 2 mobile useSubscription call sites are gone" but actual count is 1 (only `use-inbox.ts`) — `grep -rn useSubscription apps/mobile | wc -l` returns 1. Update U6's note to clarify which two of the four AppSyncSubscriptionProvider hooks are removed (thread + turnUpdate, since both are thread-domain), and update Phase 3 exit criterion to "All 1 mobile useSubscription call site is gone."

  <!-- dedup-key: section="u6 files" title="appsyncsubscriptionprovider has 4 hooks not 2 implied mobile usesubscription count offbyone" evidence="AppSyncSubscriptionProvider 4 useSubscription call sites (agent/thread/inboxItem/turnUpdate); mobile grep returns 1 not 2" -->

- **Existing admin queryClient defaults are opposite of plan's targets** — U2 / TanStack defaults (P2, feasibility, confidence 75)

  `apps/admin/src/lib/query-client.ts` currently has `staleTime: 1000 * 60 * 5, refetchOnWindowFocus: false` — the inverse of plan's target (`staleTime: 30s, refetchOnWindowFocus: true, refetchOnReconnect: true`). Existing TanStack queries (skills-api, agent-builder-api, mcp-api, etc.) currently never refetch on window focus and treat 5-minute-old data as fresh. Flipping the defaults globally during U2 changes their behavior — likely fine, but should be noticed before a 1-line edit produces a step-change in API traffic patterns at admin tabs returning to focus. Add an explicit step in U2 (or new U2.5) and gate the change on a brief dev-stage smoke check.

  <!-- dedup-key: section="u2 tanstack defaults" title="existing admin queryclient defaults are opposite of plans targets" evidence="apps/admin/src/lib/query-client.ts staleTime 1000*60*5, refetchOnWindowFocus: false — inverse of plan's target staleTime: 30s refetchOnWindowFocus: true" -->

- **`awslambda` global TS shim and esbuild flag selection not specified for SSE handler** — U4 Files (P2, feasibility, confidence 75)

  Plan U4 says "add `build_handler "thread-events-stream" "<entry-path>"` line for the SSE handler bundle" but does not specify which flag set. `awslambda` is a runtime global not yet in DefinitelyTyped (`@types/aws-lambda` does NOT cover `awslambda.streamifyResponse`); implementer needs a manual `declare global { var awslambda: ... }` shim. Specify in U4 that `thread-events-stream` uses the default `ESBUILD_FLAGS` (not `BUNDLED_AGENTCORE_ESBUILD_FLAGS`) since `aws-jwt-verify` inlines fine, and document the `awslambda` global TS shim requirement.

  <!-- dedup-key: section="u4 files" title="awslambda global ts shim and esbuild flag selection not specified for sse handler" evidence="build-lambdas.sh BUNDLED_AGENTCORE_ESBUILD_FLAGS; @types/aws-lambda does not cover awslambda.streamifyResponse" -->

- **Aurora `max_capacity = 2` may be sized below 4-enterprise scale target** — System-Wide Impact (P2, feasibility, confidence 75)

  `terraform/modules/data/aurora-postgres/variables.tf` defaults `max_capacity = 2`. Aurora Postgres Serverless v2 max connections at 2 ACU ≈ 270 connections; with 50 SSE handlers + ~22 other Lambdas × pool max=2 = 94 active connections, leaves ~75% headroom. Plan does not address what happens when dev's `max_capacity` was overridden lower (e.g., 1 ACU for cost), or when prod scales beyond U6's 50-user load-test ceiling toward documented "4 enterprises × 100+ agents" scale target. Add an explicit Terraform variable bump check to U6 — confirm `max_capacity` is at least 2 ACU in prod tfvars; document that >100 concurrent live-thread viewers requires raising it. Add a CloudWatch alarm threshold (e.g., DatabaseConnections > 80%).

  <!-- dedup-key: section="systemwide impact" title="aurora maxcapacity 2 may be sized below 4enterprise scale target" evidence="aurora-postgres/variables.tf max_capacity default 2; CLAUDE.md scale guardrail 4 enterprises × 100+ agents × 5 templates" -->

- **U7/U9 "extend or create — verify in PR review" defers architectural decision past planning** — U7 / U9 Files (P2, feasibility, confidence 75)

  Plan U7 file-list: "Create: packages/api/src/handlers/{agents-rest,scheduled-jobs,triggers,recipes}.ts (note: existing agents.ts handler already exists for some operations — extend it rather than recreate; verify in PR review whether to extend or create a sibling)". Same ambiguity in U9 for `costs-rest, observability, activity-rest`. This is an architectural decision the plan should have made — the answer determines file naming, route registration in handlers.tf, and whether existing tests grow or fork. Implementer creates `agents-rest.ts` and ends up with two handlers serving overlapping routes. Convert each "extend or create — verify in PR review" note to a concrete decision before U7/U9 PRs begin.

  <!-- dedup-key: section="u7 u9 files" title="u7u9 extend or create verify in pr review defers architectural decision past planning" evidence="Plan U7 extend or create — verify in PR review; existing agents.ts already serves CRUD with capabilities sub-resources" -->

- **Per-route refetchInterval policy unpinned** — Key Technical Decisions (P2, product-lens, confidence 75)

  Plan resolves the brainstorm's deferred polling policy question as "leave per-feature" without naming the trade-off. 24 domain PRs choosing intervals independently produces inconsistent freshness across surfaces (one dashboard polls every 15s, another every 60s, both shipped by the same product) and gives the new contributor (a stated success criterion) no anchor for what good looks like. Pin a starter policy (e.g., live: 2-3s, dashboard: 30s, status: 60s, static: none) so per-route deviations require justification.

  <!-- dedup-key: section="key technical decisions" title="perroute refetchinterval policy unpinned" evidence="Polling cadence policy: per-route refetchInterval jittered; settled per-feature during the relevant domain's PR review" -->

- **U11 bundles 15 domains as one unit; blocks U12 if any single domain stalls** — U11 / Phased Delivery (P2, product-lens + scope-guardian cross-persona, confidence 100)

  U11 labels itself a single unit but explicitly covers 15 domains. Each domain requires the same 8-step pattern as U5-U10 (~120 file changes total) with no per-domain exit criteria. The brainstorm does not define these as a monolithic batch — R22 says "each domain's REST + TanStack Query migration ships in a coordinated admin+mobile release before the next domain begins," which U11 breaks. "Knowledge", "memory", "wiki", "brain", "orchestration", "runtime" are not low-stakes — they touch substrates under active concurrent development (plan 008 phases D/E/F, Pi runtime parallel substrate, composable-skills connector work). If any one hits unexpected complexity, U11 stalls and U12 blocks behind it indefinitely. Decompose U11 into named units with their own dependencies, or define a "good enough" threshold that lets U12 proceed when N of 15 are complete.

  <!-- dedup-key: section="u11 phased delivery" title="u11 bundles 15 domains as one unit blocks u12 if any single domain stalls" evidence="U11 Long-tail domains rollup: artifacts, knowledge, memory, recipes-extras, templates, workspace, brain, wiki, quick-actions, webhooks, runtime, orchestration, runtime-manifests, agent-templates, core" -->

- **Optimistic rollback UI behavior unspecified for failed mutations** — U5/U6/F2 (P2, design-lens, confidence 75)

  Plan specifies two optimistic update patterns ("UI-only via mutation.variables" vs "onMutate cache write") and defers the choice per-route, but neither specifies what happens when a mutation fails after an optimistic update has been applied. For "UI-only via mutation.variables", TanStack Query rolls back automatically on navigation or re-render — the user sees their action disappear without explanation. On a surface like "send message in a live thread," a silent rollback means the user's message vanishes while they are actively watching the thread — a high-visibility failure. Define what toast/inline error the user sees when a mutation fails, whether rolled-back optimistic items show an error indicator, and which surfaces require an explicit error message vs silent rollback.

  <!-- dedup-key: section="u5 u6 f2" title="optimistic rollback ui behavior unspecified for failed mutations" evidence="Optimistic-update v5 has two patterns — single-screen UI only via mutation.variables vs multi-subscriber onMutate cache write — choose per route" -->

- **Mobile SSE foreground-return UI gap (1-2s catch-up window)** — U6 mobile (P2, design-lens, confidence 75)

  When the user foregrounds the app after 3 minutes, the thread detail screen will briefly show stale content (the last state before backgrounding), fire a fetch, and then update. For a live-running agent this can look like the thread is paused or frozen — especially if the fetch takes 1-2s on a cellular connection. Specify the foreground-return UI state on the live-thread screen: whether a loading indicator appears during the catch-up fetch, whether missed messages appear with a visual seam, or whether the screen simply updates when the fetch resolves.

  <!-- dedup-key: section="u6 mobile" title="mobile sse foregroundreturn ui gap 12s catchup window" evidence="U6 backgrounding the app closes SSE; foregrounding reconnects; messages received during background are fetched via initial GET after reconnect" -->

- **Empty-state for polled list queries unspecified across 24 domains** — Per-domain (P2, design-lens, confidence 75)

  Plan introduces TanStack Query globally across 24 domains, each with a list endpoint. Without design direction, implementers will produce inconsistent empty states: some will show a spinner that resolves to an empty list, others will show nothing until data arrives, others will show "No items" immediately. AE1 only covers the non-empty case. Define for each domain: what renders during initial load (spinner? skeleton?), what renders when the list is empty (zero-state message? illustration?), and whether a stale-data indicator appears during background refetches.

  <!-- dedup-key: section="perdomain" title="emptystate for polled list queries unspecified across 24 domains" evidence="U5 list with no items returns empty array, not 404 — server contract only; no client direction; AE1 only covers non-empty case" -->

- **JWT validated only at SSE connect — 14-min revocation window** — U6 SSE (P2, security-lens, confidence 75)

  Cognito ID tokens have a 1-hour validity. The SSE Lambda validates the JWT once at connection open, then holds the Aurora poll loop for up to 14 minutes without re-validating. If a user's session is revoked (admin removes a tenant member, the user is offboarded), the SSE connection remains open and continues emitting thread events from that tenant for up to 14 more minutes. The privilege escalation window is bounded but for a tenant offboarding scenario involving a disgruntled insider, 14 minutes of continued event stream is a real data exposure. Add a periodic tenancy re-check (not full JWT re-verification but a DB-layer `requireTenantMembership` call) inside the SSE polling loop — e.g., every 5 minutes verify the user's membership row is still active.

  <!-- dedup-key: section="u6 sse" title="jwt validated only at sse connect 14min revocation window" evidence="SSE substrate: JWT validated in handler ... pre-15-min internal close ~14 minutes; no periodic re-auth step" -->

- **U3 contract test spy-ordering misses branching auth bypass paths** — U3 (P2, security-lens, confidence 75)

  Plan's stated U3 assertion: "mutating requests call requireTenantAdmin before any DB write (verified via mock spy ordering against the DB driver mock)." This checks that in the test harness's happy-path invocation of the handler, auth is called before the DB mock. It would miss a handler that has multiple code branches — e.g., an `if (hasSpecialFlag)` path that runs a write before the auth check — because the test harness invokes the handler once without the flag set. Strengthen U3 to assert that the DB mock is not called at ALL when `requireTenantAdmin` is mocked to throw — this catches branching auth bypasses that call-ordering spies miss.

  <!-- dedup-key: section="u3" title="u3 contract test spyordering misses branching auth bypass paths" evidence="U3: Asserts that mutating requests call requireTenantAdmin before any DB write — verified via mock spy ordering" -->

- **Browser EventSource cannot send custom Authorization header — plan's wire format impossible for admin SPA** — U4 / SSE wire format (P2, feasibility + security-lens cross-persona, confidence 100)

  Plan's wire format example shows `Authorization: Bearer <cognito-id-token>` but native browser EventSource API does NOT support custom headers — only the URL and a `withCredentials` option. Plan U4 line 390 calls for `apps/admin/src/lib/use-sse.ts (browser EventSource wrapper hook with same JWT rotation pattern; thinner because EventSource is native)` — but this works only for `react-native-sse` on mobile. Implementer reaches U4 PR-1, writes the hook, runs it in a browser, and discovers the auth header is silently dropped — JWT validation in handler returns 401 on every connect. Resolve before U4 implementation: either (a) use `fetch` with `ReadableStream` (or `@microsoft/fetch-event-source` polyfill) for the admin browser which supports custom headers, or (b) pass JWT as URL query parameter (token-in-URL leakage in CloudWatch logs and browser history). Option (a) is strongly preferred.

  <!-- dedup-key: section="u4 sse wire format" title="browser eventsource cannot send custom authorization header plans wire format impossible for admin spa" evidence="GET https://<sse-function-url>/threads/:id/events Headers: Authorization: Bearer <cognito-id-token> — native browser EventSource cannot send custom headers" -->

- **`GRAPHQL_API_KEY` persists in cognito-auth.ts accepted-keys throughout migration** — U12 / cognito-auth (P2, security-lens, confidence 75)

  `packages/api/src/lib/cognito-auth.ts` lines 27-30 list `GRAPHQL_API_KEY` (the AppSync API key) as a third accepted API key alongside `API_AUTH_SECRET` and `THINKWORK_API_SECRET`. During the migration (potentially weeks), the new REST domain handlers inherit `cognito-auth.ts` as-is. Any party with the AppSync API key string can authenticate against all 24 new REST domain endpoints as a platform-credential with no per-tenant membership check (apikey path bypasses membership enforcement). Plan defers removal to U12 cleanup. Pull the removal forward to Phase 0 — the AppSync API key has no legitimate callers among the new REST domain handlers, so remove it from `cognito-auth.ts` and from new handler Terraform configurations from day one.

  <!-- dedup-key: section="u12 cognitoauth" title="graphqlapikey persists in cognitoauthts acceptedkeys throughout migration" evidence="cognito-auth.ts lines 27-30 GRAPHQL_API_KEY listed among accepted API keys; tenant-membership.ts apikey path bypasses membership check" -->

- **Identity pool `appsync:GraphQL` IAM policy persists post-deletion** — U12 / Identity pool (P2, security-lens, confidence 75)

  `terraform/modules/foundation/cognito/main.tf` lines 343-356 show the identity pool's authenticated IAM role has an inline policy granting `appsync:GraphQL` on `*`. Plan categorizes the Cognito identity pool as "vestigial; out of scope" and defers its removal to a follow-up PR. If AppSync is recreated under any future PR (even outside this plan), credentials obtained via the identity pool would immediately grant GraphQL access. The identity pool `appsync-access` IAM policy should be deleted or scoped down in U12 at the same time AppSync is deleted, even if the identity pool itself stays — removing the `appsync:GraphQL` permission from the authenticated role is safe and eliminates forward-risk.

  <!-- dedup-key: section="u12 identity pool" title="identity pool appsyncgraphql iam policy persists postdeletion" evidence="cognito/main.tf lines 343-356 aws_iam_role_policy.authenticated_appsync grants appsync:GraphQL on * to identity pool authenticated role" -->

- **U3 contract test runner duplicates existing admin-rest-auth-bridge.test.ts** — U3 (P2, scope-guardian, confidence 75)

  `packages/api/src/__tests__/admin-rest-auth-bridge.test.ts` already provides a 758-line parameterized harness that covers auth-gate crossing, 401/403 shape, and membership gating across 14 existing handlers. The brainstorm has no requirement for a separate contract test abstraction — R5 is the only auth requirement stated. U3's new framework adds process overhead without adding coverage that the extended auth-bridge test couldn't deliver. Extend `admin-rest-auth-bridge.test.ts` to accept new domain handlers as they land, rather than creating a parallel framework.

  <!-- dedup-key: section="u3" title="u3 contract test runner duplicates existing adminrestauthbridgetestts" evidence="admin-rest-auth-bridge.test.ts 758-line parameterized for(const c of CASES) covering 14 handlers; U3 creates rest-contract.test.ts" -->

- **U4 builds higher-order streamHandler factory premature for single SSE consumer** — U4 (P2, scope-guardian, confidence 75)

  U4 creates `sse-stream.ts` as a higher-order function (`streamHandler({ validateJwt, onConnect, onTick }) → AWS Lambda streaming handler`) — shipped inert before any consumer exists. R14 explicitly locks SSE to exactly one route in v1; the brainstorm's deferred-to-follow-up-work confirms per-route SSE expansion is out of scope. A higher-order factory earns its generality only when there are 2+ consumers; with one consumer ever planned, the factory adds indirection without reducing total code. Collapse U4 into U6 — write the SSE handler and client hooks directly for the thread-events-stream use case without the factory wrapper. If a second SSE route is added later, extract the shared scaffold at that point.

  <!-- dedup-key: section="u4" title="u4 builds higherorder streamhandler factory premature for single sse consumer" evidence="U4: streamHandler({validateJwt, onConnect, onTick}) higher-order; R14: SSE used only for live-thread route in v1" -->

- **U8/U9 remove notify functions while callers still active — TS build break per-PR** — U8 / U9 (P2, scope-guardian, confidence 75)

  U8's file list says "Modify: packages/api/src/lib/eval-notify.ts — REMOVE the notifyEvalRunUpdate function (callers continue calling it inert; deletion of callers happens in U12)." U9 similarly removes `notifyCostRecorded`. This pattern — removing the function definition while keeping call sites that now reference a non-existent export — will break TypeScript build at the U8/U9 PR stage unless callers are updated simultaneously. Brainstorm R23 says decommission executes "in a single cleanup pass." Move notify* function removal entirely into U12, consistent with R23. U8 and U9 should not touch eval-notify.ts or cost-recording.ts — the functions stay compilable until U12 deletes both functions and their call sites in one PR.

  <!-- dedup-key: section="u8 u9" title="u8u9 remove notify functions while callers still active ts build break perpr" evidence="U8: REMOVE the notifyEvalRunUpdate function (callers continue calling it inert; deletion of callers happens in U12); R23 single cleanup pass" -->

**P3 — Minor**

- **U1 (worktree bootstrap script) not tied to any brainstorm requirement** — U1 (P3, scope-guardian, confidence 75)

  Plan U1 requirements attribution: "R6, R7, R8 (build hygiene supports the migration; not directly user-facing)" — but R6-R8 are client data layer requirements (TanStack Query defaults), not build tooling. U1 has zero bearing on the REST/polling migration outcome and would be useful regardless of whether this plan exists. Plan acknowledges it is "pure tooling script" with no test scenarios. Placing it in Phase 0 as a blocker for all domain work means 12 units wait on a worktree convenience script. Remove U1 from Phase 0 blocking and ship as standalone chore PR before/parallel with Phase 0, not as a dependency of U2-U4.

  <!-- dedup-key: section="u1" title="u1 worktree bootstrap script not tied to any brainstorm requirement" evidence="U1 requirements: R6, R7, R8 (build hygiene supports the migration; not directly user-facing); U1 dependencies blocker for U2/U3/U4/U5" -->

**FYI Observations (anchor 50, no decision required)**

- `[FYI]` Domain naming: "recipes" (U7) vs "recipes-extras" (U11) inconsistency
- `[FYI]` Domain naming: "activity" in U9 not in 24-domain list
- `[FYI]` Domain naming: "tenants/users" in U10 not in 24-domain list
- `[FYI]` Domain naming: "runtime-manifests/agent-templates" in U11 not in 24-domain list
- `[FYI]` Strategic positioning: migration narrows AWS-native preference toward DIY-on-Lambda; not stated explicitly
- `[FYI]` SSE Aurora load: no off-ramp criterion for in-Lambda poll vs LISTEN/NOTIFY revisit at scale
- `[FYI]` `refetchOnWindowFocus: true` interaction with screen reader focus events not addressed
- `[FYI]` `agents-rest.ts` naming inconsistent with bare-domain pattern (`inbox.ts`, `threads.ts`)
- `[FYI]` SSE Lambda Terraform timeout setting not specified (must be 15min, not default)
- `[FYI]` U4 Function URL Terraform applied early — creates unused infra weeks before consumer exists

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-30-rest-and-polling-cutover-requirements.md](docs/brainstorms/2026-04-30-rest-and-polling-cutover-requirements.md)
- **Institutional learnings:**
  - [docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md](docs/solutions/integration-issues/lambda-options-preflight-must-bypass-auth-2026-04-21.md)
  - [docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md](docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md)
  - [docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md](docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md)
  - [docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md](docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md)
  - [docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md](docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md)
  - [docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md](docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md)
  - [docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md](docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md)
  - [docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md](docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md)
  - [docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md](docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md)
- **External references:**
  - [AWS Lambda response streaming docs](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)
  - [Lambda response streaming tutorial](https://docs.aws.amazon.com/lambda/latest/dg/response-streaming-tutorial.html)
  - [react-native-sse (binaryminds)](https://github.com/binaryminds/react-native-sse)
  - [Expo CdpInterceptor SSE bug (expo/expo#27526)](https://github.com/expo/expo/issues/27526)
  - [TanStack Query v5 polling guide](https://tanstack.com/query/latest/docs/framework/react/guides/polling)
  - [TanStack Query v5 optimistic updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates)
  - [aws-jwt-verify (awslabs)](https://github.com/awslabs/aws-jwt-verify)
- **Related code:**
  - REST handler reference: `packages/api/src/handlers/agents.ts`
  - Admin REST client substrate: `apps/admin/src/lib/api-fetch.ts`
  - Subscription→invalidation bridge to delete: `apps/admin/src/context/AppSyncSubscriptionProvider.tsx`
  - AppSync Terraform module to delete: `terraform/modules/app/appsync-subscriptions/`
  - GraphQL HTTP handler to delete: `packages/api/src/handlers/graphql-http.ts`
