import React, { useRef, useMemo, useState, useEffect } from "react";
import { View, FlatList, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, MoreHorizontal } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { useAuth } from "@/lib/auth-context";
import {
  useAgents,
  useMessages,
  useNewMessageSubscription,
  useSendMessage,
  useThread,
} from "@thinkwork/react-native-sdk";
import { useMe } from "@/lib/hooks/use-users";
import { useTurnCompletion } from "@/lib/hooks/use-turn-completion";
import type { ChatMessage } from "@/hooks/useGatewayChat";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { WebContent } from "@/components/layout/web-content";
import type { SelectedMention } from "@/components/chat/ChatInput";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { isSystemMessage } from "@/components/chat/system-message";

// Discriminated union for FlatList items
type MessageItem = {
  kind: "message";
  id: string;
  data: ChatMessage;
};

type ListItem = MessageItem;

export default function ThreadConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const flatListRef = useRef<FlatList>(null);

  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const { thread: threadData } = useThread(id);
  const { agents } = useAgents({ tenantId });

  const { messages, refetch: reexecuteMessages } = useMessages(id);

  // Subscribe to new messages in real-time — refetch messages when event arrives
  const { markThreadActive, clearThreadActive } = useTurnCompletion();
  const [{ data: subData }] = useNewMessageSubscription(id);
  useEffect(() => {
    if (subData?.onNewMessage) {
      reexecuteMessages();
      // Clear loading indicator — assistant responded
      if (id && subData.onNewMessage.role === "assistant") {
        clearThreadActive(id);
      }
    }
  }, [subData]);

  const sendMessage = useSendMessage();
  const [{ data: meData }] = useMe();
  const currentUser = meData?.me;
  // TODO: mentionCandidates query not yet available in GraphQL schema
  const mentionCandidates: any[] = [];
  const [pendingMentions, setPendingMentions] = useState<SelectedMention[]>([]);
  const [showSystemMessages, setShowSystemMessages] = useState(false);

  // Find the agent for this thread
  const agent = useMemo(() => {
    const aid = threadData?.agentId;
    return agents?.find((a: any) => a.id === aid);
  }, [threadData, agents]);

  // Convert messages to ChatMessage type with timestamp. SDK returns role as
  // the uppercase enum literal ("USER" | "ASSISTANT" | ...) whereas the
  // local ChatMessage type expects lowercase; normalize here.
  const chatMessages: ChatMessage[] = useMemo(() => {
    return messages.map((m) => ({
      id: m.id,
      role: (m.role === "USER" ? "user" : "assistant") as ChatMessage["role"],
      content: (m.content ?? "").trim(),
      timestamp: new Date(m.createdAt).getTime(),
      isStreaming: false,
    }));
  }, [messages]);

  const visibleChatMessages = useMemo(
    () => (showSystemMessages ? chatMessages : chatMessages.filter((message) => !isSystemMessage(message))),
    [chatMessages, showSystemMessages],
  );

  // Build list items sorted by creation time
  const interleaved = useMemo((): ListItem[] => {
    const items: ListItem[] = visibleChatMessages.map((m) => ({
      kind: "message",
      id: `msg-${m.id}`,
      data: m,
    }));

    // Sort by timestamp ascending (FlatList is inverted, so newest renders at bottom)
    items.sort((a, b) => {
      const ta = a.data.timestamp;
      const tb = b.data.timestamp;
      return ta - tb;
    });

    return items;
  }, [visibleChatMessages]);

  // Reverse for inverted FlatList (newest at bottom = first in array)
  const invertedItems = useMemo(() => [...interleaved].reverse(), [interleaved]);

  const lastMsg = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
  const isStreaming = lastMsg?.role === "user";

  const handleSend = async (content: string) => {
    if (!agent?.id || !id) return;
    const mentionsToSend = pendingMentions.length > 0 ? pendingMentions : undefined;
    setPendingMentions([]);
    try {
      await sendMessage(id, content, {
        ...(currentUser?.id ? { senderId: currentUser.id } : {}),
      });
      markThreadActive(id);
    } catch (e) {
      console.error("[ThreadChat] send failed:", e);
    }
  };

  const title = threadData?.title || "Conversation";

  const renderItem = ({ item }: { item: ListItem }) => {
    return (
      <WebContent>
        <ChatBubble message={item.data} showSystemMessages={showSystemMessages} />
      </WebContent>
    );
  };

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <View style={{ flex: 1, width: "100%" }}>
      {/* Header with back button + overflow menu */}
      <View
        className="flex-row items-center border-b border-neutral-200 dark:border-neutral-800 px-2"
        style={{ paddingTop: insets.top, height: insets.top + 56 }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="flex-row items-center flex-1 active:opacity-70"
        >
          <View className="p-2 mr-1">
            <ChevronLeft size={24} color={colors.foreground} />
          </View>
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex-1" numberOfLines={1}>
            {title}
          </Text>
        </Pressable>
        <View className="px-2">
          <HeaderContextMenu
            trigger={<MoreHorizontal size={22} color={colors.foreground} />}
            items={[
              {
                label: showSystemMessages ? "Hide System Messages" : "Show System Messages",
                onPress: () => setShowSystemMessages((current) => !current),
              },
            ]}
          />
        </View>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={invertedItems}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 12 }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center px-8 pt-32" style={{ transform: [{ scaleY: -1 }] }}>
              <Text className="text-lg font-semibold mb-2">No messages yet</Text>
              <Text className="text-neutral-400 text-center">
                Send a message to continue this conversation.
              </Text>
            </View>
          }
          ListHeaderComponent={
            isStreaming ? (
              <View className="ml-2 mb-2">
                <TypingIndicator />
              </View>
            ) : null
          }
        />

        {/* Input */}
        <WebContent>
          <ChatInput
            onSend={handleSend}
            mentions={mentionCandidates ?? []}
            onMentionsChange={setPendingMentions}
          />
        </WebContent>
      </KeyboardAvoidingView>
      </View>
    </View>
  );
}
