# @thinkwork/react-native-sdk

Hooks-only client for embedding ThinkWork threads, messages, and streaming agent turns into any React Native / Expo host app. No UI ships; host apps build their own chat surface from the hooks.

For conceptual docs, walkthroughs, and recipes, see [the ThinkWork docs site](https://docs.thinkwork.ai/sdks/react-native/). This README is the engineering reference — full signatures, return shapes, and behavior details.

## Install

```sh
pnpm add @thinkwork/react-native-sdk@beta
pnpm add amazon-cognito-identity-js expo-crypto expo-secure-store expo-web-browser graphql urql
```

### Peer dependencies

The SDK declares these as peers. Your host installs them; the SDK uses whatever version you have.

| Package | Why |
| --- | --- |
| `react`, `react-native` | Host framework |
| `urql` | GraphQL client |
| `graphql` | Document type definitions |
| `amazon-cognito-identity-js` | Session restore + email/password flow |
| `expo-web-browser` | Cognito hosted-UI flow for Google sign-in |
| `expo-secure-store`, `expo-crypto` | Token storage + key material |

## Provider

```tsx
import { ThinkworkProvider } from "@thinkwork/react-native-sdk";

<ThinkworkProvider config={config}>
  <App />
</ThinkworkProvider>;
```

`config: ThinkworkConfig` — the following shape:

```ts
{
  graphqlUrl: string;          // HTTPS endpoint
  graphqlWsUrl?: string;        // WSS endpoint for AppSync subscriptions
  apiBaseUrl?: string;
  graphqlApiKey?: string;       // unusual; normally auth is Cognito
  cognito: {
    userPoolId: string;
    userPoolClientId: string;
    region: string;
    hostedUiDomain?: string;    // required for Google sign-in
  };
  oauthRedirectUri?: string;    // required for Google sign-in
  tenantSlug?: string;
  environment?: "prod" | "staging" | "dev";
  logger?: { debug, info, warn, error };
}
```

**Config re-initialization**: the GraphQL client rebuilds and the auth provider re-runs `restore()` whenever `config` changes identity. The internal Cognito pool cache is keyed by `userPoolId + userPoolClientId`, so swapping ThinkWork stages mid-session is safe.

## Hooks — auth

### `useThinkworkAuth()`

```ts
{
  status: "unknown" | "signed-out" | "signed-in" | "error";
  user: ThinkworkUser | null;
  signIn(email, password): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  getIdToken(): Promise<string | null>;
}
```

`user.tenantId` is populated for every signed-in user, including Google-federated users whose Cognito ID token is missing the `custom:tenant_id` claim (the provider fires a `me` query fallback internally).

## Hooks — threads

### `useThreads(args)` → `{ threads, loading, error, refetch }`

```ts
useThreads({
  tenantId: string | null | undefined;
  agentId?: string | null;
  assigneeId?: string | null;
  status?: string | null;       // ThreadStatus enum value
  priority?: string | null;     // ThreadPriority enum value
  type?: string | null;         // ThreadType enum value
  channel?: string | null;      // ThreadChannel enum value
  search?: string | null;       // full-text search
  limit?: number;
  cursor?: string | null;
});
```

`cache-and-network` with `additionalTypenames: ["Thread"]`. Any mutation through the same urql client that touches a `Thread` row invalidates this query automatically.

### `useThread(threadId)` → `{ thread, loading, error, refetch }`

Single-thread read. Paused when `threadId` is falsy.

### `useUnreadThreadCount(args)` → `{ count, loading, error }`

```ts
useUnreadThreadCount({ tenantId, agentId });
```

Server-side aggregate — no client-side thread scan. Uses the same `Thread` typename invalidation as `useThreads`.

### `useCreateThread()` → `(input) => Promise<Thread>`

```ts
await createThread({
  tenantId,
  title,
  agentId?,
  description?,
  channel?,
  type?,
  priority?,
  createdByType?,
  createdById?,
  firstMessage?, // atomic thread + first user message in one round-trip
});
```

### `useUpdateThread()` → `(threadId, input) => Promise<Thread>`

Unbound — threadId is passed at call time, not hook time.

```ts
await updateThread(threadId, {
  title?, description?,
  status?, priority?, type?, channel?,
  assigneeType?, assigneeId?,
  archivedAt?, lastReadAt?,
});
```

## Hooks — messages

### `useMessages(threadId)` → `{ messages, loading, error, refetch }`

Messages in descending creation order. Subscribes internally to `onNewMessage(threadId)` and refetches on arrival — you don't need to wire subscriptions manually.

### `useSendMessage()` → `(threadId, content, opts?) => Promise<Message>`

Unbound — threadId is passed at call time, not hook time. This is the 0.2.0 fix for the "create thread then send first message" footgun.

```ts
await sendMessage(threadId, content, {
  senderType?: string; // default "user"
  senderId?: string;   // optional attribution
});
```

## Hooks — agents

### `useAgents(args)` → `{ agents, loading, error, refetch }`

```ts
useAgents({ tenantId });
```

Pure data. Selection state is a host concern.

## Hooks — subscriptions

The SDK wires the `useMessages` refresh subscription for you. Use these directly only when you want to react to events outside a messages list.

### `useNewMessageSubscription(threadId)` → urql subscription tuple

Thread-scoped new-message stream.

### `useThreadTurnSubscription(threadId)` → urql subscription tuple

Thread-scoped agent turn updates, filtered client-side.

### `useThreadTurnUpdatedSubscription(tenantId)` → urql subscription tuple

Tenant-wide turn stream — no client filter.

### `useThreadUpdatedSubscription(tenantId)` → urql subscription tuple

Tenant-wide thread-status stream.

## Exported types

```ts
import type {
  ThinkworkConfig, ThinkworkUser, ThinkworkAuthStatus, ThinkworkAuthContextValue,
  Agent, Thread, Message, ThreadTurn,
  CreateThreadInput, UpdateThreadInput,
  NewMessageEvent, ThreadTurnUpdateEvent, ThreadUpdateEvent,
  SendMessageOptions, UseThreadsArgs,
} from "@thinkwork/react-native-sdk";
```

`Thread.lastResponsePreview`, `Thread.identifier`, and `Thread.assigneeId` are populated by the server but not by every query — the SDK's built-in queries include them. `Message.role` comes back as the uppercase enum (`"USER"` / `"ASSISTANT"`).

## Example UI

See [`examples/chat-ui/ThinkworkChat.tsx`](./examples/chat-ui/ThinkworkChat.tsx) for a reference implementation of a single-thread chat screen. Not shipped in the tarball; copy into your app and restyle.

## Migration from 0.1.x

See the [Upgrading guide](https://docs.thinkwork.ai/sdks/react-native/migration) on the docs site.

## Publishing notes

- Published to public npm on the `beta` dist-tag.
- Version tagged as `sdk-v<version>` on the main repo triggers CI publish.
- Tarball contains `dist/`, `src/`, `README.md`, `LICENSE` — `examples/` is excluded.
