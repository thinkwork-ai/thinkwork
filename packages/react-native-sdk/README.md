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
  useCreateThread,
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
      <Chat />
    </ThinkworkProvider>
  );
}
```

## Reference UI

The SDK ships no UI. Build your own chat surface from these hooks and your host app's design system. An earlier opinionated chat modal (`ThinkworkBrainModal`, `Composer`, `MessageList`, etc.) lives on the archived `eo/embed-thinkwork` branch under `packages/react-native-brain/src/components/` and can be cribbed as a starting point, though its `BrainContextEnvelope` / linkage-key workflow is no longer part of this SDK.
