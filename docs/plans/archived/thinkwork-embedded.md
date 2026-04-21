# Plan: Embeddable ThinkWork Brain package for LastMile Expo app

## Context

LastMile's mobile app needs an always-available Brain button in its bottom tab bar. Tapping it should open a native modal with a context-aware ThinkWork chat experience grounded in the current task/customer/route. Today, ThinkWork's mobile experience lives only in `apps/mobile` as a standalone Expo app — there's no embeddable surface. The PRD at `thinkwork/.prds/embedded-mobile-brain-package.md` calls for extracting Brain into a dedicated React Native package family (`@thinkwork/react-native-core` + `@thinkwork/react-native-brain`) that host apps can import and render inside a host-owned modal.

### Decisions made during planning

- **Auth:** Mode A — ThinkWork user tokens. The SDK ships its own sign-in UI (Cognito); LastMile users sign into ThinkWork on first open. No host-JWT exchange endpoint needed for v1.
- **Delivery:** Start with `yalc` for local iteration, ship a committed `.tgz` in LastMile for the first CI-visible integration, move to GitHub Packages before beta, public npm at GA.
- **Presentation:** Full-screen React Native `Modal` owned by the SDK (`ThinkworkBrainModal`). No peer-dep on Gorhom/Reanimated. Also expose a headless `ThinkworkBrainView` for future hosts.
- **v1 surface:** Single entity-linked thread. Open → resolve-or-create one thread keyed to host context → timeline + composer + streaming. No thread list, no history browse.

## Target architecture

```
lastmile/mobile-apps/apps/mobile
  └─ tab-bar.tsx (adds Brain item)
      └─ <ThinkworkBrainModal visible context={{entities, threadLinkage}} />

thinkwork/packages/
  ├─ react-native-core/     auth, GraphQL client, subscriptions, storage
  └─ react-native-brain/    provider, modal, timeline, composer, streaming

thinkwork/apps/mobile       becomes a reference consumer of the two packages
```

## Phase 0 — Extract reusable pieces from `apps/mobile` into new packages

Create two new workspace packages in `thinkwork/packages/`. Follow the existing `tsc --build` pattern used by `@thinkwork/api`, `@thinkwork/database-pg`, etc.

### `packages/react-native-core` — foundational plumbing

Move (not copy) from `apps/mobile`:

- `lib/auth.ts` — Cognito client (USER_PASSWORD_AUTH)
- `lib/auth-context.tsx` — session lifecycle, restore, refresh
- `lib/cognito-storage.ts` — SecureStore adapter
- `lib/graphql/client.ts` — urql + AppSync WebSocket client
- `lib/graphql/provider.tsx` — `<UrqlProvider>` wrapper
- `lib/hooks/use-subscriptions.ts` — `useNewMessageSubscription`, `useThreadUpdatedSubscription`, `useThreadTurnUpdatedSubscription`
- `lib/hooks/use-turn-completion.tsx` — turn completion state machine

Public API:

```ts
export { ThinkworkCoreProvider } from './provider'     // composes auth + urql + turn-completion
export { useThinkworkAuth } from './auth'
export { useThinkworkClient } from './graphql'
export type { ThinkworkCoreConfig, ThinkworkUserAuth } from './types'
```

Peer deps: `react`, `react-native`, `expo-secure-store`, `expo-constants`, `@urql/core`, `urql`, `graphql-ws`, `amazon-cognito-identity-js`.

### `packages/react-native-brain` — Brain UI

Move (not copy) from `apps/mobile`:

- `app/thread/[threadId]/index.tsx` → `src/screens/BrainThreadScreen.tsx` (strip expo-router specifics)
- `components/chat/` (MarkdownMessage, ChatBubble, TypingIndicator, ChatInput)
- `components/input/` (MessageInputFooter)
- `components/threads/ActivityTimeline.tsx`
- `lib/hooks/use-messages.ts`, `use-threads.ts`
- `lib/graphql-queries.ts` (thread/message/turn GraphQL documents)

Public API:

```ts
export { ThinkworkBrainProvider } from './provider'  // wraps ThinkworkCoreProvider + Brain-specific config
export { ThinkworkBrainModal } from './components/ThinkworkBrainModal'
export { ThinkworkBrainView } from './components/ThinkworkBrainView'
export type {
  BrainContextEnvelope,
  ThinkworkBrainThemeOverrides,
  ThinkworkBrainEvent,
} from './types'
```

Depends on `@thinkwork/react-native-core` as a workspace peer.

### `apps/mobile` refactor

Replace the extracted in-tree paths with imports from the two packages. The mobile app's `app/thread/[threadId]/index.tsx` becomes a thin expo-router wrapper around `BrainThreadScreen`. The root `_layout.tsx` provider stack composes `ThinkworkBrainProvider` + the existing `TurnCompletionProvider` moves into core.

Success criterion: `apps/mobile` builds and runs identically to main, now consuming the two new packages.

### Build tooling

Use the existing `tsc --build` pattern. For React Native packages specifically:

- `main`: `./dist/index.js` (CJS, preserved JSX — Metro handles JSX)
- `types`: `./dist/index.d.ts`
- `exports` map with `"source": "./src/index.ts"` so yalc/workspace consumers pick up TS source without prebuild during dev
- `files`: `["dist", "src"]`

## Phase 1 — LastMile integration

Work happens in `lastmile/mobile-apps/apps/mobile`.

### 1. Add the Brain tab item

`src/components/ui/tab-bar.tsx` — add a `TabBarItem` for Brain between the existing conditional role-gated tabs and the Menu overflow (around line 210 based on the exploration). It sets a Zustand flag (new slice, `brainModalOpen`) rather than navigating.

### 2. Mount the modal at app root

`app/(app)/_layout.tsx` (line 423 area, where `<TabBar />` renders) — add:

```tsx
<ThinkworkBrainModal
  visible={brainModalOpen}
  onClose={() => setBrainModalOpen(false)}
  context={buildBrainContext(currentRoute, currentEntity)}
  presentation="fullScreenModal"
/>
```

`buildBrainContext` is a new helper in `src/lib/thinkwork/context.ts` that reads the current route / active task / active customer from Zustand and emits a `BrainContextEnvelope`:

```ts
{
  source: { app: 'lastmile-mobile', surface: currentRouteName, appVersion },
  actor: { hostUserId: userId },            // from useAuth()
  tenant: { hostTenantId: companyId },
  entities: [/* current task | customer | route | loadsheet */],
  threadLinkage: { key: `lastmile:${entityType}:${entityId}`, mode: 'reuse-or-create' },
}
```

### 3. Provider wiring

Wrap `ThinkworkBrainProvider` around the tree (near `BottomSheetModalProvider` in `app/_layout.tsx`). Provider config:

- `apiBaseUrl`, `graphqlUrl`, `graphqlWsUrl` from a new `src/lib/thinkwork/config.ts` (env-driven)
- `auth.mode = 'thinkworkUserToken'`, with `getIdToken` backed by the SDK's own Cognito session (the SDK owns the sign-in UI — LastMile never sees a ThinkWork token)

### 4. First-run sign-in

Mode A means the first time a user opens the Brain modal and there's no ThinkWork session, the modal shows a sign-in screen owned by the SDK. This is a `SignInScreen` inside `react-native-brain` that uses `react-native-core`'s auth hooks. LastMile does nothing for this.

## Phase 2 — Delivery loop

### Local dev loop (you, today)

```
cd thinkwork
pnpm --filter @thinkwork/react-native-core build
pnpm --filter @thinkwork/react-native-brain build
cd packages/react-native-brain && yalc publish
cd packages/react-native-core && yalc publish

cd /Users/ericodom/projects/lastmile/mobile-apps/apps/mobile
yalc add @thinkwork/react-native-core
yalc add @thinkwork/react-native-brain
pnpm install
pnpm start --clear
```

On change: `yalc push` from each package auto-propagates into LastMile's `.yalc/` dir + triggers pnpm. Keep the `yalc:` protocol out of committed `package.json` — revert before PR.

### First CI-visible integration (vendored tarball)

1. Bump `@thinkwork/react-native-core` and `@thinkwork/react-native-brain` to `0.1.0-alpha.1`.
2. `pnpm --filter "@thinkwork/*" pack --pack-destination /tmp/tw-pack`.
3. Copy the two `.tgz` files into `lastmile/mobile-apps/vendor/thinkwork/`.
4. LastMile `apps/mobile/package.json`:
   ```json
   "@thinkwork/react-native-core": "file:../../vendor/thinkwork/thinkwork-react-native-core-0.1.0-alpha.1.tgz",
   "@thinkwork/react-native-brain": "file:../../vendor/thinkwork/thinkwork-react-native-brain-0.1.0-alpha.1.tgz"
   ```
5. `pnpm install` resolves tarballs; LastMile CI works unchanged.
6. Every SDK bump is one PR in LastMile that swaps the tarball + bumps the filename version. Annoying but deterministic.

### Before beta — GitHub Packages

New workflow `thinkwork/.github/workflows/publish-rn-packages.yml` triggered on tags matching `rn-sdk-v*`:

- `pnpm publish --filter "@thinkwork/react-native-*" --registry https://npm.pkg.github.com --access restricted`
- Uses `GITHUB_TOKEN` (has `write:packages` in its own repo).

LastMile side:

- Add `.npmrc` (committed):
  ```
  @thinkwork:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```
- Add `NPM_TOKEN` secret to LastMile CI (GitHub PAT with `read:packages` on the thinkwork-ai org).
- Switch `package.json` deps from `file:` to semver ranges. Delete `vendor/thinkwork/`.

### At GA — public npm

Claim `@thinkwork` scope on npmjs.com, publish `@thinkwork/react-native-core` and `@thinkwork/react-native-brain` there, drop the `.npmrc` scope config in consumer apps.

## Backend work required for v1

Minimal, because Mode A reuses the existing Cognito + GraphQL surface. Two additions:

1. **Thread metadata persistence** — when creating a thread, accept and store a `contextEnvelope` field (source app, entities, linkage key) on the thread row. Extends the existing create-thread mutation; no new endpoint.
2. **Thread lookup by linkage key** — a new GraphQL query `threadByLinkageKey(key: String!): Thread`. Returns the most recent thread owned by the current user with matching `threadLinkage.key`. If null, client creates a new thread with that key attached.

Both land server-side in the existing ThinkWork API layer. `POST /mobile/embed/session/exchange` (PRD line 380) is deferred to Mode B, out of scope here.

## Critical files

**ThinkWork (to modify/create):**
- `pnpm-workspace.yaml` — already globs `packages/*`, no change needed
- `packages/react-native-core/` — new
- `packages/react-native-brain/` — new
- `apps/mobile/app/_layout.tsx` — swap provider imports
- `apps/mobile/app/thread/[threadId]/index.tsx` — thin expo-router wrapper
- `apps/mobile/package.json` — add workspace deps on the two packages
- ThinkWork GraphQL schema + resolvers — add `threadByLinkageKey`, context envelope fields on thread

**LastMile (to modify):**
- `apps/mobile/src/components/ui/tab-bar.tsx` — add Brain tab item
- `apps/mobile/app/(app)/_layout.tsx` — mount `ThinkworkBrainModal`
- `apps/mobile/app/_layout.tsx` — wrap tree in `ThinkworkBrainProvider`
- `apps/mobile/src/lib/thinkwork/config.ts` — new, env config
- `apps/mobile/src/lib/thinkwork/context.ts` — new, `BrainContextEnvelope` builder from host state
- `apps/mobile/src/stores/brain-store.ts` — new Zustand slice for modal visibility
- `apps/mobile/package.json` — add `@thinkwork/*` deps
- `apps/mobile/vendor/thinkwork/` — new dir for tarballs (phase 2 only)

## Reusable code identified

No refactor needed — these already exist and should be moved as-is (not rewritten) during extraction:

- `apps/mobile/lib/auth.ts` — Cognito USER_PASSWORD_AUTH
- `apps/mobile/lib/auth-context.tsx` — full session lifecycle
- `apps/mobile/lib/cognito-storage.ts` — SecureStore adapter (no rewrite)
- `apps/mobile/lib/graphql/client.ts` — urql + AppSync WS wiring
- `apps/mobile/lib/hooks/use-subscriptions.ts` — subscription hooks
- `apps/mobile/lib/hooks/use-turn-completion.tsx` — turn completion state
- `apps/mobile/components/chat/*` — timeline/bubbles/markdown
- `apps/mobile/components/input/MessageInputFooter.tsx` — composer

## Verification

End-to-end checks before calling this done:

1. **ThinkWork `apps/mobile` still works.** Build + run on simulator. Sign in, open an existing thread, send a message, receive a streaming response. The two packages should be transparent to its behavior.
2. **Package install path works.** In a fresh clone of LastMile, `pnpm install` resolves the `@thinkwork/*` tarballs from `vendor/thinkwork/` without a registry.
3. **Brain modal cold path on LastMile.** Launch LastMile on a simulator, sign into LastMile, tap Brain in the tab bar → modal opens with ThinkWork sign-in → sign in once → modal transitions to Brain chat with the current task context header visible.
4. **Entity linkage.** Open a task, open Brain, send a message, close modal. Reopen Brain from the same task: the previous thread is restored (tested by `threadByLinkageKey` returning the stored thread).
5. **Entity switch.** Open a different task, open Brain: a new thread is created with the new linkage key. Switch back to the first task: original thread returns.
6. **Streaming.** Agent response streams tokens into the timeline in real time via the AppSync WS subscription. Turn completion marker fires.
7. **Sign out behavior.** Signing out of ThinkWork from inside the modal surfaces `onAuthFailure` to LastMile; modal closes cleanly.
8. **CI.** LastMile CI pipeline builds successfully against the vendored tarballs. ThinkWork CI builds `apps/mobile` against the workspace packages.
