# PRD: Refactor ThinkWork SDK to pure hooks; decouple from LastMile; remove Task concept from ThinkWork

## Context

We are mid-build on embedding ThinkWork's "Brain" experience into LastMile's mobile app. In doing so, we over-engineered on two fronts:

1. **ThinkWork grew a Task concept** (external tasks, sync, webhook ingest, `external_task_id` correlation, dedicated resolvers and Lambda integrations) that exists only because LastMile has tasks. None of it belongs in ThinkWork — ThinkWork's job is to be an agent harness with threads, messages, and turns.
2. **The embedded SDK grew server-side coupling to LastMile** (`threads.context_linkage_key`, `threads.context_envelope`, `threadByLinkageKey` query, `CreateThreadInput.contextLinkageKey/contextEnvelope`). That's LastMile's correlation state wedged into ThinkWork's schema. The moment a second host integrates, it either collides or spawns a new LastMile-sized wart.
3. **The SDK is also too opinionated** — today it ships a full modal, sign-in screen, theme system, and a `BrainContextEnvelope` type that reads suspiciously LastMile-shaped (entity types enumerate `task | customer | route | stop | vehicle | loadsheet`).

The fix: ThinkWork stays a clean agent harness. LastMile owns all task state, all task↔thread correlation, and all chat UI. The SDK shrinks to a hooks-only library that any host can consume.

This PRD is scoped to the React Native SDK rewrite + the LastMile refactor that consumes it + removing Task functionality from ThinkWork. Web SDK and formalizing the CLI as an SDK consumer are separate PRDs.

## Target state

```
ThinkWork
  ├─ threads, messages, turns, agents              (unchanged core)
  ├─ GraphQL API (Lambda) + AppSync subscriptions  (unchanged)
  └─ @thinkwork/react-native-sdk                   (hooks-only, host-agnostic)
       └─ examples/                                (reference chat UI, sign-in UI — not published)

LastMile (owns 100% of task <-> thread coupling)
  ├─ task.thinkwork_thread_id (new column)
  ├─ chat UI in-tree                               (built from SDK hooks)
  └─ Brain trigger on map + task screens           (team's UX call)
```

### Decisions made during planning

- **SDK shape**: single package `@thinkwork/react-native-sdk`, hooks only, no shipping UI. Reference UIs live under `packages/react-native-sdk/examples/` and are not published.
- **Task cleanup in ThinkWork**: dev-only nuke. No backfill, no deprecation window. Columns, tables, resolvers, integrations — all gone.
- **Scope**: RN SDK + LastMile refactor only. Web SDK / CLI integration deferred.
- **Existing work in flight**: close branch `eo/embed-thinkwork` on both repos; don't merge. Start fresh branches off the new PRD.
- **Backend coupling**: reverted. ThinkWork's DB + GraphQL stay oblivious to LastMile.

## Phase A — Build `@thinkwork/react-native-sdk` (hooks-only)

Consolidate `packages/react-native-core/` + `packages/react-native-brain/` into a single package `packages/react-native-sdk/`.

### Public API surface

```ts
// Provider — wraps host app, configures auth + GraphQL
export function ThinkworkProvider({ config, children }): JSX.Element
export interface ThinkworkConfig {
  apiBaseUrl: string
  graphqlUrl: string
  graphqlWsUrl?: string
  graphqlApiKey?: string
  cognito: { userPoolId, userPoolClientId, region, hostedUiDomain? }
  oauthRedirectUri?: string
  logger?: ThinkworkLogger
}

// Auth
export function useThinkworkAuth(): {
  status: "unknown" | "signed-out" | "signed-in" | "error"
  user: ThinkworkUser | null
  signIn(email, password): Promise<void>
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
  getIdToken(): Promise<string | null>
}

// Threads
export function useThread(threadId): { thread, loading, error, refetch }
export function useCreateThread(): (input: CreateThreadInput) => Promise<Thread>

// Messages
export function useMessages(threadId): { messages, loading, error, refetch }
export function useSendMessage(threadId): (content: string) => Promise<Message>

// Real-time
export function useNewMessageSubscription(threadId): { data, error }
export function useThreadTurnSubscription(threadId): { data, error }

// Low-level escape hatches
export function useThinkworkClient(): ThinkworkGraphqlClient     // urql client
export { setAuthToken, getAuthToken }                             // token access
```

Types exposed: `Thread`, `Message`, `ThreadTurn`, `ThinkworkUser`, `CreateThreadInput`. **No** `BrainContextEnvelope`, no entity-type enums, no LastMile vocabulary. `CreateThreadInput` is the slim ThinkWork-native shape: `{ title?, agentId?, tenantId }`.

### What to keep from current packages

Move as-is into `@thinkwork/react-native-sdk/src/`:

- `react-native-core/src/auth/cognito.ts` — Cognito helpers including Google OAuth (`getGoogleSignInUrl`, `exchangeCodeForTokens`, `storeOAuthTokens`)
- `react-native-core/src/auth/secure-storage.ts` — `CognitoSecureStorage` adapter
- `react-native-core/src/auth/provider.tsx` — auth provider (already has `signIn`, `signInWithGoogle`, `signOut`) — reshape into `useThinkworkAuth` hook + provider
- `react-native-core/src/graphql/client.ts` + `appsync-ws.ts` + `token.ts` + `provider.tsx` — GraphQL client + AppSync WebSocket transport
- `react-native-core/src/hooks/use-subscriptions.ts` — rename hooks (`useNewMessageSubscription`, `useThreadTurnSubscription`), drop tenant-scoped variants that don't take a `threadId`
- `react-native-brain/src/queries.ts` — strip the linkage-key query, rename `BrainMe` → `Me`, strip `contextLinkageKey/contextEnvelope` selections
- `react-native-brain/src/hooks/use-brain-messages.ts` + `use-brain-thread.ts` — **redo as generic hooks**. Drop linkage-key resolution logic entirely (host handles it).

### What to delete from current packages

- All UI components (`SignInScreen`, `ThinkworkBrainModal`, `ThinkworkBrainView`, `BrainThreadScreen`, `Composer`, `MessageList`, `MessageBubble`, `ContextHeader`, `TypingIndicator`, `BrainLogo`, `GoogleGlyph`)
- Theme system (`theme/tokens.ts`, `theme/context.tsx`)
- All `Brain*` type names (`BrainContextEnvelope`, `BrainEntity`, `BrainPresentation`, `BrainThreadSummary`, `ThinkworkBrainEvent`)
- `useBrainThread` — the "resolve or create by linkage key" logic; this is host concern

Most of the above can move to `packages/react-native-sdk/examples/chat-ui/` as a reference implementation that pulls from the published SDK via workspace ref — shows consumers how to build an opinionated chat UI if they want one.

### Package config

```jsonc
{
  "name": "@thinkwork/react-native-sdk",
  "version": "0.2.0-alpha.1",
  "main": "./dist/index.js",
  "peerDependencies": {
    "amazon-cognito-identity-js": "^6.3.14",
    "expo-crypto": "*",
    "expo-secure-store": "*",
    "expo-web-browser": "*",
    "graphql": "^16",
    "react": ">=18",
    "react-native": ">=0.72",
    "urql": "^4"
  }
}
```

Version jumps to `0.2.0-alpha.1` to signal the API break.

### Critical files (Phase A)

- `thinkwork/packages/react-native-sdk/package.json` — new
- `thinkwork/packages/react-native-sdk/tsconfig.json` — new (mirror existing `tsc --build` pattern from `@thinkwork/api`)
- `thinkwork/packages/react-native-sdk/src/index.ts` — new public exports
- `thinkwork/packages/react-native-sdk/src/provider.tsx` — new `ThinkworkProvider`
- `thinkwork/packages/react-native-sdk/src/auth/*` — ported from `react-native-core`
- `thinkwork/packages/react-native-sdk/src/graphql/*` — ported from `react-native-core`
- `thinkwork/packages/react-native-sdk/src/hooks/*` — new generic thread/message hooks
- `thinkwork/packages/react-native-sdk/examples/chat-ui/` — moved UI components from `react-native-brain`
- `thinkwork/packages/react-native-core/` — **delete**
- `thinkwork/packages/react-native-brain/` — **delete**

## Phase B — LastMile refactor onto the new SDK

Consume `@thinkwork/react-native-sdk` from `lastmile/mobile-apps/apps/mobile`. UX/presentation decisions are up to the LastMile team; PRD only prescribes the integration shape.

### Task ↔ thread mapping — LastMile-owned

Add column on LastMile's `task` table via its existing schema management (likely a PowerSync schema migration — LastMile team to confirm):

```
task.thinkwork_thread_id uuid NULL
```

Logic flow when user triggers Brain from a task context:

1. Read `task.thinkwork_thread_id`.
2. If set, `useThread(id)` + show chat.
3. If null, call `useCreateThread()` (optionally with `title: task.title`), receive new `threadId`, persist it to `task.thinkwork_thread_id` (LastMile backend call), then show chat.

No `BrainContextEnvelope`, no linkage key, no ThinkWork-side correlation. ThinkWork just has threads; LastMile remembers which thread belongs to which task.

### What to remove from LastMile (work we just did)

- `src/components/thinkwork/brain-host.tsx` — no mounted modal
- `src/lib/thinkwork/context.ts` — no envelope builder
- `src/stores/brain-store.ts` — reconsider if the new UX needs Zustand state; may keep or drop
- `src/components/ui/tab-bar.tsx` — remove Brain tab item (unless team decides to keep tab as one entry point)
- `app/(app)/_layout.tsx` — remove `<BrainHost />` mount
- `app/_layout.tsx` — replace `ThinkworkBrainProvider` with `ThinkworkProvider`

### What to build in LastMile

- Chat UI (message list, composer, streaming indicator) — built from SDK hooks, styled with LastMile's design system. Can crib from `@thinkwork/react-native-sdk/examples/chat-ui/` as a starting point but lives in LastMile's tree.
- Sign-in flow — LastMile builds its own sign-in screen using `useThinkworkAuth().signIn` + `signInWithGoogle`. Integrates visually with existing LastMile sign-in affordances.
- Brain trigger on task detail screen + map overlay (team's UX call).

### Critical files (Phase B)

- `lastmile/mobile-apps/apps/mobile/package.json` — swap `@thinkwork/react-native-brain`/`-core` file refs for a single `@thinkwork/react-native-sdk` tarball
- `lastmile/mobile-apps/vendor/thinkwork/` — replace tarballs with new SDK
- `lastmile/mobile-apps/package.json` — update pnpm override name
- `lastmile/mobile-apps/apps/mobile/app/_layout.tsx` — swap provider
- `lastmile/mobile-apps/apps/mobile/app/(app)/_layout.tsx` — drop `BrainHost`
- `lastmile/mobile-apps/apps/mobile/src/components/chat/` (new) — LastMile's chat UI built on SDK hooks
- `lastmile/mobile-apps/apps/mobile/src/lib/thinkwork/` — shrink to just `config.ts` (env-driven `ThinkworkConfig`)
- LastMile backend — `task.thinkwork_thread_id` migration (team owns this path)

## Phase C — Remove Task concept from ThinkWork

Dev-only nuke. No backfill. Drop everything task-shaped.

### Schema / migrations

- Drop `threads.external_task_id` column + its unique index (migration 0007) — revert
- Drop the `sync_status`, `sync_error` columns from `threads` — these exist only for LastMile task sync
- Drop `thread_dependencies` table if it's only referenced by task flows (verify — it may be more general)
- Revert my uncommitted migration 0013 columns (`context_linkage_key`, `context_envelope`) before merge
- Draft new migration that does all the drops in one go

### API / resolvers

- Delete `packages/api/src/integrations/external-work-items/` entirely (restClient, mcpClient, verifySignature, ensureExternalTaskThread, syncExternalTaskOnCreate, executeAction, ingestEvent, all providers)
- Delete Lambda handlers wired for LastMile ingest (webhook ingest path)
- Delete resolvers: `retryTaskSync`, anything reading/writing `external_task_id` or `sync_*`
- Delete `external-tasks.graphql` type file
- Drop `ThreadChannel.TASK` enum value + all conditional logic that branches on `channel === 'task'` (e.g. identifier prefix `TASK-`, sync pending status, intake form tasks)
- Delete `bootstrap-workspaces.ts` migration if it's LastMile-derived (verify)
- Delete tests: `external-task-*.test.ts`, `lastmile-*.test.ts`, any task-sync e2e

### Revert my recent work

Undo the backend-coupling additions from `eo/embed-thinkwork`:

- `packages/database-pg/src/schema/threads.ts` — remove `context_linkage_key`, `context_envelope`, `idx_threads_context_linkage_key`
- `packages/database-pg/drizzle/0013_thread_context_envelope.sql` — delete
- `packages/database-pg/drizzle/meta/0013_snapshot.json` — delete
- `packages/database-pg/drizzle/meta/_journal.json` — revert to pre-0013
- `packages/database-pg/graphql/types/threads.graphql` — revert `contextLinkageKey`, `contextEnvelope`, `threadByLinkageKey`
- `packages/api/src/graphql/resolvers/threads/threadByLinkageKey.query.ts` — delete
- `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` — revert linkage-key persistence
- `packages/api/src/graphql/resolvers/threads/index.ts` — remove export

The dev DB already has the new columns applied (you pushed the migration manually). A drop-column statement in the new consolidated migration will handle that.

### Secrets / infra

- Any SSM params or Secrets Manager entries for LastMile integration (`lastmile-pat`, `oauth-token`, etc.) — delete in a follow-up sweep
- Terraform modules for LastMile webhook routes — remove or parameterize off

### Critical files (Phase C)

- `thinkwork/packages/api/src/graphql/resolvers/threads/index.ts`
- `thinkwork/packages/api/src/integrations/external-work-items/` — delete directory
- `thinkwork/packages/database-pg/graphql/types/threads.graphql`
- `thinkwork/packages/database-pg/graphql/types/external-tasks.graphql` — delete
- `thinkwork/packages/database-pg/src/schema/threads.ts`
- `thinkwork/packages/database-pg/drizzle/` — new consolidated drop-column migration
- `thinkwork/packages/api/src/__tests__/` — delete LastMile-named tests

## Phase D — Cleanup

- Close `eo/embed-thinkwork` branch in thinkwork repo (don't merge). Same in LastMile.
- Delete `packages/react-native-core/` + `packages/react-native-brain/` from thinkwork repo once `react-native-sdk` is in place.
- Update `thinkwork/.prds/embedded-mobile-brain-package.md` — mark superseded by this PRD. Or delete it since the new direction is documented here.
- Update `thinkwork/README.md` to position ThinkWork as "second brain harness for agents" with SDK + CLI as integration surfaces.
- Revert `terraform/modules/foundation/cognito/variables.tf` — the `myapp://oauth/callback` addition I added earlier. The redirect URI is a LastMile concern; should live in LastMile's own Cognito app client config (if they spin one up) or stay hardcoded here with a note (lesser evil for now given we already registered it live).

## Phase ordering / parallelization

- **A and C can run in parallel** — SDK work doesn't touch backend; backend cleanup doesn't touch SDK.
- **B depends on A** — LastMile can't consume the new SDK until it exists.
- **D depends on A + B + C** — final cleanup.

Realistic sequence:
1. A (SDK rewrite) — 1–2 days
2. C (nuke Tasks from ThinkWork) — in parallel with A, 1–2 days
3. B (LastMile refactor) — after A ships as alpha tarball, 2–3 days including team UX decisions
4. D (cleanup + docs) — 0.5 day

## Verification

### Phase A — SDK

1. `pnpm --filter @thinkwork/react-native-sdk build` produces clean `dist/`.
2. `pnpm --filter @thinkwork/react-native-sdk typecheck` passes.
3. `pnpm pack` produces a single tarball that, when installed into a throwaway RN app, exposes the declared hooks without extraneous UI exports.
4. Manual test: a trivial consumer calling `useThinkworkAuth().signIn`, `useCreateThread`, `useSendMessage` against the dev ThinkWork API succeeds.

### Phase B — LastMile

1. Fresh `pnpm install` in LastMile resolves the new SDK tarball, no version drift in other deps (save-exact is already in `.npmrc`).
2. Metro builds end-to-end (`curl http://localhost:8081/node_modules/expo-router/entry.bundle` returns a valid bundle).
3. On simulator: sign in via email → land on task list → open a task → trigger Brain → see chat screen (either empty timeline for new thread or prior thread for reopened task).
4. Close Brain, reopen from the same task: same `threadId` returned, same conversation restored.
5. Open Brain from a different task: new thread created, LastMile's `task.thinkwork_thread_id` populated.
6. Google OAuth flow works (already working via `myapp://oauth/callback`).
7. Streaming: send a message → observe agent turn stream tokens into the timeline in real time.

### Phase C — ThinkWork

1. `pnpm --filter @thinkwork/api typecheck` passes after deletes.
2. All existing tests (non-LastMile) still pass; LastMile-named tests are gone.
3. `bash scripts/db-push.sh --stage dev` applies the drop-column migration cleanly (idempotent, no conflicts).
4. Deploy pipeline (`.github/workflows/deploy.yml`) green against the stripped code.
5. ThinkWork web admin (`apps/admin`) still works — it doesn't touch Task-channel anything except via `ThreadChannel` enum, so search for `TASK` enum usage and verify no crashes.
6. ThinkWork's own mobile app (`apps/mobile`) still works — it likely shows Task channel threads; replace Task-specific UI with generic chat UI or drop those screens.

### Phase D

1. `eo/embed-thinkwork` branches show as closed/abandoned on GitHub.
2. No stale references in docs to `@thinkwork/react-native-core` or `@thinkwork/react-native-brain`.
3. A new developer can read `README.md` + the SDK README and understand the integration model without touching task code.

## Open questions (to resolve during implementation, not now)

- Does `apps/mobile` (ThinkWork's own mobile app) need task-channel removal too, or does it continue to show generic threads only? This PRD assumes generic-only.
- Does the LastMile team prefer a single `task.thinkwork_thread_id` column or a separate `task_thread_map` table? Column is simpler; table is normalized if they ever want multiple threads per task. Defer to LastMile team.
- PowerSync schema changes for the new column — does it sync to mobile? If so, the mapping is offline-readable on device.
- Should `@thinkwork/react-native-sdk/examples/chat-ui/` be published as a separate `@thinkwork/chat-ui-kit` package at some point? Out of scope for this PRD; noted for later.
