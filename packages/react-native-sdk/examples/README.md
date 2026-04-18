# SDK examples

These files are **not** shipped in the `@thinkwork/react-native-sdk` tarball. They're reference implementations hosts can copy into their own app and restyle to taste.

## `chat-ui/ThinkworkChat.tsx`

Single-thread chat surface — header with back chevron, reverse-order message list, composer with send button. Auto-scrolls to the latest assistant message on first load and to the end for subsequent arrivals.

**Hooks used:** `useThread`, `useMessages`, `useSendMessage`.

**Additional peer deps** (not required by the SDK itself):

```sh
pnpm add react-native-safe-area-context react-native-svg react-native-markdown-display
```

**Usage**:

```tsx
import { ThinkworkChat } from "./thinkwork-chat/ThinkworkChat";
import { useRouter } from "expo-router";

export default function ThreadScreen({ threadId }: { threadId: string }) {
  const router = useRouter();
  return (
    <ThinkworkChat
      threadId={threadId}
      onBack={() => router.back()}
      fallbackTitle="Brain"
    />
  );
}
```

The component is styled with a neutral gray/black palette. Swap the colors, typography, and layout in `styles` and `markdownStyles` to match your app's design tokens.
