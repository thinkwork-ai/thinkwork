# SDK examples

These files are **not** shipped in the `@thinkwork/react-native-sdk` tarball. They're reference implementations hosts can copy into their own app and restyle to taste.

## `chat-ui/ThinkworkChat.tsx`

Single-thread chat surface — header with back chevron, reverse-order message list, composer with send button. Auto-scrolls to the latest assistant message on first load and to the end for subsequent arrivals.

**Hooks used:** `useThread`, `useMessages`, `useSendMessage`.

### Additional peer deps

Not required by the SDK itself; only this example needs them:

```sh
pnpm add react-native-safe-area-context react-native-svg react-native-markdown-display
```

### Usage

```tsx
import { ThinkworkChat } from "./thinkwork-chat/ThinkworkChat";
import { useRouter } from "expo-router";
import { useThinkworkAuth } from "@thinkwork/react-native-sdk";

export default function ThreadScreen({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { user } = useThinkworkAuth();
  return (
    <ThinkworkChat
      threadId={threadId}
      onBack={() => router.back()}
      fallbackTitle="Brain"
      currentUserId={user?.sub}
      keyboardVerticalOffset={96}
      onSendError={(err) => {
        console.warn("send failed", err);
        // show a toast / retry affordance
      }}
    />
  );
}
```

### Props

| Prop | Default | Purpose |
| --- | --- | --- |
| `threadId` | — | Thread to render messages for. Required. |
| `onBack` | `undefined` | Tapping the back chevron calls this. If omitted, the chevron is non-interactive. |
| `fallbackTitle` | `"Chat"` | Header text while `useThread` is loading. |
| `currentUserId` | `undefined` | Passed as `senderId` to `useSendMessage`. Omit to let the backend derive attribution from the auth context. |
| `keyboardVerticalOffset` | `0` | Added to `KeyboardAvoidingView`. Typical tab-bar hosts use ~80–96. |
| `onSendError` | `undefined` | Called when `sendMessage` throws. Use this to surface a toast or retry UI. If omitted, the draft is restored and the error is logged. |
| `emptyStateText` | `"Send a message to start the conversation."` | Shown when the thread has no messages. |

### Styling

The component is styled with a neutral gray/black palette. Swap the colors, typography, and layout in the `styles` and `markdownStyles` blocks to match your app's design tokens.

## Typechecking the examples

The SDK's main `tsconfig.json` excludes `examples/` from the build. To verify an example compiles against the current `src/` types:

```sh
pnpm exec tsc --noEmit -p examples/tsconfig.check.json
```

This uses a path-mapped config that resolves `@thinkwork/react-native-sdk` to `src/index.ts` directly, so you can iterate on the SDK and the example together without rebuilding.
