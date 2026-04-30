---
date: 2026-04-30
topic: rest-and-polling-cutover
---

# Replace AppSync and GraphQL HTTP with REST + targeted SSE

## Summary

Pure REST + TanStack Query polling replaces both AppSync and the GraphQL HTTP layer. No global realtime push. One narrowly-scoped exception: an SSE endpoint for the live-thread-watching route, the only UX surface where polling latency genuinely hurts. Full cutover across admin and mobile; codegen as a category goes away.

---

## Problem Frame

Today, every change to a GraphQL type forces edits to `subscriptions.graphql` (or a sibling source file), `pnpm schema:build` to regenerate the AppSync subscription schema, codegen runs in four packages (`apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`), an AppSync redeploy, and updated urql client expectations on admin and mobile. Every iteration cycle absorbs that overhead.

The realtime layer (AppSync) serves a narrow, well-bounded purpose — pushing nine event types to clients that already follow a "receive event → call refetch" pattern. But it carries the cognitive and operational weight of a full GraphQL platform: schema-build pipeline, `@aws_subscribe` directive semantics, subscription codegen, urql graphcache configuration, and per-environment AppSync deployment.

The HTTP GraphQL layer compounds the problem with codegen sprawl across four packages, urql configured in admin (59 query/mutation files) and mobile, and a tooling boundary contributors must cross every time a type evolves — for type safety that zod + TanStack Query can deliver in a single TypeScript-only artifact.

The product is an operator dashboard with a few live-feeling surfaces, not a collaborative-editing app. Every realtime push option evaluated (AppSync kept, API Gateway WebSocket, IoT Core MQTT, SaaS realtime) added meaningful complexity without earning it back in product value.

```
After the cutover

Client (admin / mobile)
   TanStack Query
     - per-route refetchInterval
     - refetchOnWindowFocus / refetchOnReconnect
     - optimistic updates + invalidateQueries on mutations
   │
   │  HTTPS + Cognito JWT
   ▼
API Gateway (HTTP API)         ← already running
   │
   ├──▶  Domain REST Lambdas   ← formerly graphql-http; zod-typed handlers
   │
   └──▶  Live-thread SSE Lambda  ← response streaming, one route only
                                   (idle when no active viewer)
   │
   ▼
Aurora                          ← unchanged
```

---

## Actors

- A1. Admin operator: uses the admin SPA (port 5174). Reads tenant resources, manages agents, watches live threads during execution.
- A2. Mobile user: uses the Expo app. Reads/mutates resources, including the inbox subscription replaced by a polled query.
- A3. Server-side mutation handlers: today fire `notify*` to AppSync after DB writes; after migration, write to the DB and return.
- A4. Strands agent runtime: consumes the API via REST + `API_AUTH_SECRET`. Out of scope for migration — already on the target shape.

---

## Key Flows

- F1. Read with auto-refresh
  - **Trigger:** A1 or A2 navigates to a route that displays server data.
  - **Actors:** A1 or A2.
  - **Steps:** Client mounts a TanStack Query against the relevant REST endpoint with route-appropriate `refetchInterval`. On mount, an initial fetch returns current state. The query refetches on its interval, on window focus, and on network reconnect.
  - **Outcome:** UI displays current state without manual refresh; updates appear within the configured interval.
  - **Covered by:** R1, R3, R6, R7, R8.

- F2. Mutate with optimistic update
  - **Trigger:** A1 or A2 takes an action that writes data (send message, update thread, schedule job, etc.).
  - **Actors:** A1 or A2; A3.
  - **Steps:** Client calls a REST mutation endpoint. TanStack Query applies an optimistic cache update. Server validates input via zod, writes to Aurora, returns the persisted shape. On success, the client invalidates affected query keys, triggering refetch where stale data may exist.
  - **Outcome:** User sees the change immediately; other queries showing the same entity converge on next refetch.
  - **Covered by:** R2, R5, R9.

- F3. Live thread watch
  - **Trigger:** A1 or A2 navigates to a thread detail route while an agent is actively running.
  - **Actors:** A1 or A2.
  - **Steps:** Client opens an SSE connection to the live-thread endpoint for that thread id. Lambda response streaming holds the connection. Inside the Lambda, new turns and messages are emitted as SSE events as they appear. When the thread completes or 15 minutes elapse, the server closes the connection. Client EventSource auto-reconnects (with mobile polyfill); the new connection resumes from current state.
  - **Outcome:** User sees thread events with ≤2s lag from server-side write to UI update. When the user navigates away, the connection closes.
  - **Covered by:** R11, R12, R13, R15.

- F4. Migration cutover (per domain)
  - **Trigger:** Migration team starts work on the next domain (threads, agents, evaluations, etc.).
  - **Actors:** A3 (engineering).
  - **Steps:** New REST endpoints stand up alongside existing GraphQL HTTP resolvers. Admin and mobile consumer code in that domain swaps urql → TanStack Query + REST in a coordinated release. After validation in production, the old GraphQL resolvers and their codegen artifacts are removed for that domain.
  - **Outcome:** Each cutover is a complete domain migration; no domain straddles the old and new stacks long-term.
  - **Covered by:** R21, R22, R23, R24.

---

## Requirements

**API contract**
- R1. All non-streaming server↔client interactions use REST + JSON over HTTPS.
- R2. Request and response shapes are validated by zod schemas exported from a shared types package consumed by admin, mobile, and the server.
- R3. Endpoints are organized by domain (threads, agents, evaluations, scheduled jobs, inbox, costs, eval runs, activation, org). Endpoint paths and verbs are decided during planning.
- R4. There is no codegen step for API types. Types flow from zod schemas via TypeScript inference; consumers import them directly from the shared package.
- R5. Authentication on all REST endpoints uses Cognito JWTs via the existing pattern. No auth-layer changes are introduced by this work.

**Client data layer**
- R6. TanStack Query is the sole client-side cache mechanism for both admin and mobile.
- R7. Each query specifies a `refetchInterval` appropriate to its route (short on live-feeling pages, longer on dashboards, none on static pages). Per-route interval values are decided per-feature during migration.
- R8. `refetchOnWindowFocus`, `refetchOnReconnect`, and freshness-favoring `staleTime` defaults are set globally for both clients.
- R9. Mutations apply optimistic updates where the user expects instant feedback; mutation success invalidates affected query keys.
- R10. urql is removed entirely from admin and mobile (queries, mutations, subscriptions, graphcache config).

**Live thread streaming (SSE)**
- R11. The route where a user actively watches an agent's thread executing is served by a dedicated SSE endpoint backed by Lambda response streaming.
- R12. The SSE endpoint emits events for new messages and turn updates within a single thread; the client uses these to update its local cache without polling that thread's data while connected.
- R13. When the server closes the SSE connection (Lambda 15-minute cap or thread completion), the client EventSource auto-reconnects without user intervention. Mobile uses a polyfill that mirrors EventSource semantics.
- R14. SSE is used only for the live-thread route in v1. No other surface uses SSE.
- R15. When no user is actively watching a live thread, no SSE Lambda is held open. Idle resource cost is zero.

**Decommissioning**
- R16. AppSync is deleted from the Terraform configuration.
- R17. The schema build pipeline (`scripts/schema-build.sh`), `terraform/schema.graphql`, `subscriptions.graphql`, and any other GraphQL source files are deleted.
- R18. All nine server-side `notify*` helpers are deleted, not replaced. DB writes proceed without a fanout step.
- R19. The GraphQL HTTP Lambda (`graphql-http`), Yoga server, and all GraphQL resolvers are deleted.
- R20. Codegen scripts and generated artifacts are removed from `apps/cli`, `apps/admin`, `apps/mobile`, and `packages/api`. After cleanup, no `.graphql` files exist in the repo and no `codegen` script appears in any `package.json`.

**Migration sequencing**
- R21. The new REST endpoints and the SSE endpoint stand up alongside the existing AppSync + GraphQL HTTP stack; the new stack is inert until clients begin cutover.
- R22. Admin and mobile cut over domain by domain. Each domain's REST + TanStack Query migration ships in a coordinated admin+mobile release before the next domain begins.
- R23. After all domains are cut over and validated in production, decommissioning (R16–R20) executes in a single cleanup pass.
- R24. There are no backwards-compatibility shims for clients running mid-migration. Each release ships admin and mobile updates together.
- R25. The Strands agent runtime's existing API consumers are not modified by this work.

---

## Acceptance Examples

- AE1. **Covers R7, R8.** Given the admin operator is on the agents list, when they switch to another tab and return after 90 seconds, the agents list refetches automatically and shows current state without a manual reload.
- AE2. **Covers R9.** Given the operator submits a new message in a thread, when the mutation is sent, the new message appears in the thread immediately (optimistic). On mutation success, any other open queries showing that thread (e.g., the thread list with last-message preview) refresh on next render.
- AE3. **Covers R11, R12, R15.** Given an operator navigates to a thread detail view while an agent is actively running, when they arrive the page opens an SSE connection. New messages and turn updates appear within ~2 seconds of being written server-side. When they navigate away from the route, the SSE connection closes and no Lambda is held open.
- AE4. **Covers R13.** Given an operator has had an SSE connection open for more than 15 minutes, when the Lambda closes the connection, the client EventSource (or mobile polyfill) auto-reconnects and resumes streaming events without user intervention.
- AE5. **Covers R10, R20.** Given the migration is complete, when a contributor runs `pnpm install && pnpm -r build` from a clean clone, no GraphQL codegen step executes and no `.graphql` files are read or generated.

---

## Success Criteria

- Codegen does not run as part of any build, deploy, or development workflow. Zero `.graphql` files exist in the repo. No `codegen` script remains in any `package.json`.
- AppSync is absent from `terraform/`. The schema build pipeline is absent from `scripts/`. urql is absent from both `apps/admin/package.json` and `apps/mobile/package.json`.
- Admin and mobile both render their primary surfaces (agents, threads, inbox, evaluations, scheduled jobs) using TanStack Query against REST endpoints. Operator perception of "freshness" on dashboard surfaces is no worse than the AppSync version.
- Live thread watching during an agent run feels live: ≤2 seconds from server-side event to UI update.
- Monthly AWS cost for the API tier (excluding agent runtime and DB) sits in the $30–100/month range, an order of magnitude lower than the realtime push alternatives evaluated.
- A new contributor can read the entire client→server data path in one sitting: a REST endpoint, a zod schema, a TanStack Query call, and (for one route) an SSE Lambda.

---

## Scope Boundaries

- All push-based realtime layers — AppSync (any form), API Gateway WebSocket, IoT Core MQTT.
- All third-party SaaS realtime — Ably, PartyKit, Pusher, Liveblocks, Convex.
- SSE for any route other than live-thread watching. Eval run progress, agent status, cost ticker, and all other surfaces stay on polling. Per-route SSE expansion is a follow-up decision based on production feedback, not v1 scope.
- Pushing actual data payloads on any wire (REST is the source of truth; SSE delivers thread-event signals only).
- Replacing TanStack Query, Cognito, the API Gateway, or any other component above/below this layer.
- OpenAPI / schema-driven REST tooling — the goal is to escape codegen, not relocate it.
- Migrating the Strands agent runtime's API calls (already REST + `API_AUTH_SECRET`).
- Multi-region failover for the API or SSE tier.
- Backwards-compatibility shims for clients running mid-migration. Full cutover means admin and mobile move together per domain.
- Bidirectional realtime — presence, cursors, typing indicators, multi-device sync.
- Rate limiting and request throttling at API Gateway (existing limits unchanged).
- Replacing `pnpm`, the monorepo layout, or any tooling outside the API tier.

---

## Key Decisions

- **Pure REST + polling as the default**: for an operator dashboard product, polling is the right primitive. Realtime push adds complexity (authz at publish, schema versioning, cache routing, ordering, reconnect/buffering) that the product doesn't earn back in user value.
- **SSE as the targeted exception**: live thread watching has a real UX gap that 2–5s polling can't close. Lambda response streaming, scoped to "only when actively watching," keeps idle cost at zero and avoids standing up a global push tier.
- **Reject API Gateway WebSocket**: rolling production-hardened WebSocket plumbing (auth refresh, ghost connections, reconnect, redelivery, heartbeats) is weeks of work and an ongoing fragility surface. AWS lacks a managed WebSocket primitive that is both serverless and ergonomic for this shape.
- **Reject IoT Core MQTT**: AWS-managed pub/sub is the architecturally cleanest realtime option, but the migration risk and new-service cognitive load is not justified once the product is reframed as polling-friendly.
- **Reject SaaS realtime (Ably, PartyKit, Pusher)**: conflicts with AWS-native preference; not justified once polling is acceptable.
- **Reject keeping AppSync as a vestige**: keeping a GraphQL-shaped realtime platform to deliver `{kind, id}` invalidations is a compromise that ages poorly and preserves the schema-build + subscription-codegen treadmill.
- **zod over OpenAPI**: zod schemas provide runtime validation and TypeScript-inferred types in one artifact. OpenAPI codegen replaces GraphQL codegen with REST codegen and misses the point.
- **Domain-by-domain cutover**: each domain (threads, agents, evaluations, etc.) migrates as a unit. New and old stacks coexist briefly per domain. Avoids a big-bang switchover and lets validation happen incrementally.
- **No predetermined fallback condition**: the user is committed; the migration succeeds or stalls forward, not backward.

---

## Dependencies / Assumptions

- TanStack Query is already installed in `apps/admin` and `apps/mobile`. The `QueryClientProvider` is already wired in `apps/admin/src/main.tsx`. This work finishes a partly-staged transition rather than starting one cold.
- Cognito JWT validation is already used for the existing GraphQL HTTP path; the same auth pattern applies unchanged to REST + SSE endpoints.
- Aurora, the Strands agent runtime, AgentCore, and all infrastructure outside the API tier are unaffected by this work.
- Lambda response streaming is a generally available AWS feature; no service enrollment or quota request is required.
- React Native lacks a native EventSource. A polyfill (`react-native-sse` or fetch-streaming) is assumed to be available and stable for the SSE endpoint use; planning will pick the specific library.
- The existing per-tenant authorization model is preserved within REST endpoint handlers; tenancy enforcement moves with the resolver logic into the new endpoints.
- Single-region deployment continues to be the operating context.

---

## Outstanding Questions

### Resolve Before Planning

- *(none — all scope-shaping decisions are settled. Questions below are technical decisions appropriate for planning.)*

### Deferred to Planning

- [Affects R3][Technical] Lambda topology for REST endpoints: a single Lambda per domain, a single Lambda with sub-routing, or a Lambda per endpoint. Trade-off between cold-start surface, bundle size, and deployment unit count.
- [Affects R7][Technical] Default polling intervals: pin a starter policy (e.g., live: 3s, dashboard: 30s, static: none, manual-refresh: never) or leave fully per-feature.
- [Affects R11][Technical, Needs research] SSE endpoint implementation: in-Lambda DB polling at ~1s vs. Aurora `LISTEN/NOTIFY` (Aurora's NOTIFY support has known constraints that need verification). Performance and per-connection cost under expected viewer load.
- [Affects R13][Technical, Needs research] React Native SSE polyfill choice: `react-native-sse` vs. fetch-streaming-based alternative. Reliability under app backgrounding, cellular handoff, and 5G/Wi-Fi switches.
- [Affects R20][Technical] Order of file deletion vs. type deletion to avoid breaking the build mid-migration. Likely "domain endpoints land first inert; domain client cuts over; domain GraphQL deletion ships in cleanup pass."
- [Affects R22][Technical] Domain ordering: which domain is the first beachhead. Threads/messages is a candidate because it drives the SSE route and exercises the most surface; planning should validate.
- [Affects R23][Technical] Single cleanup-pass execution: one PR or several. If single, regression-window risk; if several, intermediate states to keep healthy.
