/**
 * Example ThinkworkChat component — a single-thread chat surface built from
 * the SDK's hooks. This file is **not** shipped in the published tarball
 * (see the `files` field in package.json). Hosts should copy it into their
 * app and restyle to match their design system.
 *
 * Required peer deps for this example (NOT for the SDK itself):
 *   - react-native-safe-area-context
 *   - react-native-svg
 *   - react-native-markdown-display
 */
import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import Markdown from "react-native-markdown-display";
import {
  useMessages,
  useSendMessage,
  useThread,
  type Message,
} from "@thinkwork/react-native-sdk";

export interface ThinkworkChatProps {
  threadId: string;
  /** Called when the user taps the back chevron. If omitted, the header is still rendered with a non-interactive chevron. */
  onBack?: () => void;
  /** Override the default title when the thread hasn't loaded yet. */
  fallbackTitle?: string;
  /**
   * Optional user id to stamp on sent messages for attribution. Passed
   * through to the SDK's `useSendMessage` `senderId` option. Omit and
   * the backend derives sender from the auth context.
   */
  currentUserId?: string;
  /**
   * Host apps with a bottom tab bar typically need to offset the
   * `KeyboardAvoidingView` so the composer doesn't slide behind the tabs
   * on focus. Defaults to `0`.
   */
  keyboardVerticalOffset?: number;
  /**
   * Called when a message send fails. Use this to surface a toast /
   * retry affordance. If omitted, the error is logged and swallowed.
   */
  onSendError?: (err: unknown) => void;
  /**
   * Custom text for the empty state shown when a thread has no messages
   * yet. Defaults to "Send a message to start the conversation."
   */
  emptyStateText?: string;
}

function ChevronLeftIcon({
  size = 22,
  color = "#111827",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 18l-6-6 6-6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Thread title header, reverse-order message list, composer.
 *
 * `useMessages` subscribes to AppSync and auto-refetches when new messages
 * arrive — agent streaming updates land with no extra wiring. The composer
 * uses the unbound `useSendMessage()` from 0.2.0, so the same hook works
 * whether the thread was mounted or just created.
 */
export function ThinkworkChat({
  threadId,
  onBack,
  fallbackTitle = "Chat",
  currentUserId,
  keyboardVerticalOffset = 0,
  onSendError,
  emptyStateText = "Send a message to start the conversation.",
}: ThinkworkChatProps) {
  const { thread } = useThread(threadId);
  const { messages, loading } = useMessages(threadId);
  const sendMessage = useSendMessage();
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const listRef = React.useRef<FlatList<Message>>(null);

  // Server returns newest-first; reverse into chronological order for the
  // FlatList so the reader scans top → bottom as oldest → newest.
  const timeline = React.useMemo(() => [...messages].slice().reverse(), [messages]);

  // Index of the last assistant message. On first load we land the reader on
  // the message BEFORE it (usually the user's question) so they see their
  // prompt at the top of the viewport and read the answer below.
  const lastAssistantIndex = React.useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].role === "ASSISTANT") return i;
    }
    return -1;
  }, [timeline]);

  const didInitialScroll = React.useRef(false);
  const prevCountRef = React.useRef(timeline.length);

  React.useEffect(() => {
    if (didInitialScroll.current) return;
    if (lastAssistantIndex < 0 || timeline.length === 0) return;
    didInitialScroll.current = true;
    prevCountRef.current = timeline.length;
    const targetIndex = Math.max(0, lastAssistantIndex - 1);
    const handle = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({
          index: targetIndex,
          animated: false,
          viewPosition: 0,
          viewOffset: 16,
        });
      } catch {}
    }, 150);
    return () => clearTimeout(handle);
  }, [lastAssistantIndex, timeline.length]);

  // After the initial land, scroll to the end for each new arrival.
  React.useEffect(() => {
    if (!didInitialScroll.current) {
      prevCountRef.current = timeline.length;
      return;
    }
    if (timeline.length > prevCountRef.current && timeline.length > 0) {
      const handle = setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 200);
      prevCountRef.current = timeline.length;
      return () => clearTimeout(handle);
    }
    prevCountRef.current = timeline.length;
    return;
  }, [timeline.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    try {
      await sendMessage(
        threadId,
        text,
        currentUserId ? { senderId: currentUserId } : undefined,
      );
    } catch (err) {
      // Restore the draft so the user can retry without retyping.
      setDraft(text);
      if (onSendError) onSendError(err);
      else console.error("[ThinkworkChat] send failed:", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <Pressable onPress={onBack} style={styles.header} disabled={!onBack}>
        <View style={styles.backBtn}>
          <ChevronLeftIcon size={24} color="#111827" />
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {thread?.title || fallbackTitle}
        </Text>
      </Pressable>
      {loading && messages.length === 0 ? (
        <View style={[styles.center, styles.chatArea]}>
          <ActivityIndicator />
        </View>
      ) : !loading && messages.length === 0 ? (
        <View style={[styles.center, styles.chatArea]}>
          <Text style={styles.emptyText}>{emptyStateText}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={timeline}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          style={styles.chatArea}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              try {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  animated: false,
                  viewPosition: 0,
                  viewOffset: 16,
                });
              } catch {}
            }, 100);
          }}
        />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            multiline
            editable={!sending}
            style={styles.input}
            onSubmitEditing={submit}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={submit}
            disabled={!draft.trim() || sending}
            style={[
              styles.sendBtn,
              (!draft.trim() || sending) && styles.sendBtnDisabled,
            ]}
          >
            <Text style={styles.sendLabel}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "USER";
  const content = message.content ?? "";
  if (isUser) {
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowUser]}>
        <View style={[styles.bubble, styles.bubbleUser]}>
          <Text style={[styles.bubbleText, styles.bubbleTextUser]}>{content}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.agentCard}>
      <Markdown style={markdownStyles}>{content}</Markdown>
    </View>
  );
}

const markdownStyles = {
  body: { color: "#111827", fontSize: 15, lineHeight: 22 },
  heading1: { fontSize: 22, fontWeight: "700", marginTop: 12, marginBottom: 8, color: "#111827" },
  heading2: { fontSize: 19, fontWeight: "700", marginTop: 12, marginBottom: 6, color: "#111827" },
  heading3: { fontSize: 17, fontWeight: "700", marginTop: 10, marginBottom: 4, color: "#111827" },
  heading4: { fontSize: 15, fontWeight: "700", marginTop: 8, marginBottom: 4, color: "#111827" },
  paragraph: { marginTop: 0, marginBottom: 10, color: "#111827" },
  strong: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  link: { color: "#2563EB", textDecorationLine: "underline" },
  bullet_list: { marginBottom: 10 },
  ordered_list: { marginBottom: 10 },
  list_item: { marginBottom: 2 },
  code_inline: {
    backgroundColor: "#F3F4F6",
    color: "#111827",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
  },
  code_block: {
    backgroundColor: "#F3F4F6",
    color: "#111827",
    padding: 12,
    borderRadius: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
    marginVertical: 6,
  },
  fence: {
    backgroundColor: "#F3F4F6",
    color: "#111827",
    padding: 12,
    borderRadius: 8,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
    marginVertical: 6,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: "#E5E7EB",
    paddingLeft: 12,
    marginVertical: 6,
    color: "#4B5563",
  },
  hr: { backgroundColor: "#E5E7EB", height: 1, marginVertical: 12 },
  table: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 4 },
  th: { padding: 8, fontWeight: "700", backgroundColor: "#F9FAFB" },
  td: {
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E7EB",
  },
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  chatArea: { flex: 1, backgroundColor: "#E5E7EB" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: {
    color: "#6B7280",
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  listContent: { padding: 12, gap: 8 },
  bubbleRow: { flexDirection: "row" },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubble: { maxWidth: "85%", padding: 10, borderRadius: 12 },
  bubbleUser: { backgroundColor: "#111827", borderBottomRightRadius: 4 },
  bubbleText: { fontSize: 15 },
  bubbleTextUser: { color: "#fff" },
  agentCard: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: {
    paddingHorizontal: 16,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
    borderRadius: 8,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendLabel: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
