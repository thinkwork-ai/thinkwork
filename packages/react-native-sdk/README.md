# @thinkwork/react-native-sdk

Hooks-only SDK for embedding ThinkWork threads, messages, and streaming agent turns into any React Native / Expo host app. No shipping UI, no host-specific vocabulary — consumers build their own chat surface from hooks.

## Install

```sh
pnpm add @thinkwork/react-native-sdk
pnpm add amazon-cognito-identity-js expo-crypto expo-secure-store expo-web-browser graphql urql
```

## Quick start

```tsx
import {
  ThinkworkProvider,
  useThinkworkAuth,
  useAgents,
  useThreads,
  useUnreadThreadCount,
  useCreateThread,
  useUpdateThread,
  useMessages,
  useSendMessage,
  useNewMessageSubscription,
} from "@thinkwork/react-native-sdk";

const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_THINKWORK_API_URL!,
  graphqlUrl: process.env.EXPO_PUBLIC_THINKWORK_GRAPHQL_URL!,
  graphqlWsUrl: process.env.EXPO_PUBLIC_THINKWORK_GRAPHQL_WS_URL,
  cognito: {
    userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID!,
    userPoolClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID!,
    region: "us-east-1",
    hostedUiDomain: process.env.EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN,
  },
  oauthRedirectUri: "myapp://oauth/callback",
};

export default function App() {
  return (
    <ThinkworkProvider config={config}>
      <Brain />
    </ThinkworkProvider>
  );
}
```

## Hooks

| Hook | Purpose |
| --- | --- |
| `useThinkworkAuth()` | `{ status, user, signIn, signInWithGoogle, signOut, getIdToken }`. `user.tenantId` is always populated when `status === "signed-in"` (falls back to the `me` query for Google-federated users with no `custom:tenant_id` claim). |
| `useAgents({ tenantId })` | Pure data: `{ agents, loading, error, refetch }`. Selection + storage are host concerns. |
| `useThreads({ tenantId, agentId?, limit? })` | Thread list. Invalidates automatically when any Thread mutation fires. |
| `useUnreadThreadCount({ tenantId, agentId? })` | Server-aggregated count. Drives tab-bar badges without a client-side scan. |
| `useThread(threadId)` | Single thread read. |
| `useCreateThread()` | Imperative `(input) => Promise<Thread>`. Pass `firstMessage` to atomically create thread + first user message in one round-trip (avoids the footgun where you can't `useSendMessage(newId)` right after `createThread` without re-rendering). |
| `useUpdateThread()` | Imperative `(threadId, input) => Promise<Thread>`. Unbound — works for any threadId at call time. |
| `useMessages(threadId)` | Messages in the thread + auto-refetch on new-message subscription. |
| `useSendMessage()` | Imperative `(threadId, content) => Promise<Message>`. Unbound in 0.2.0 — was `useSendMessage(threadId)` in 0.1.x. |
| `useNewMessageSubscription(threadId)` | WebSocket subscription for new messages on a thread. |
| `useThreadTurnSubscription(threadId)` | WebSocket subscription for agent turn progress. |

## Reference UI

The SDK ships no UI. See [`examples/chat-ui/`](./examples/chat-ui/) for a copyable chat surface that composes the hooks above (markdown rendering + scroll-to-last-assistant + composer).

## Migration from 0.1.x

- `useSendMessage(threadId)` → `useSendMessage()`, call as `send(threadId, content)`.
- `useThinkworkMe` removed — `useThinkworkAuth().user.tenantId` is now populated even for Google-federated users.
- New: `useAgents`, `useThreads`, `useUnreadThreadCount`, `useUpdateThread`.
- `createThread` now accepts `firstMessage?: string` for atomic thread-plus-first-message creation.
