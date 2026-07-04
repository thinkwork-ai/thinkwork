import React, { useRef, useMemo, useState, useEffect, useCallback } from "react";
import {
  Alert,
  View,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, MoreHorizontal } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import {
  MessageInputFooter,
  type MessageInputMention,
} from "@/components/input/MessageInputFooter";
import {
  type SendMessageGoalMode,
  useNewMessageSubscription,
  useThread,
} from "@thinkwork/react-native-sdk";
import { useMutation, useQuery } from "urql";
import { useMessages as useLocalMessages } from "@/lib/hooks/use-messages";
import {
  SendMessageMutation,
  ThreadMentionTargetsQuery,
  MyApprovedModelCatalogQuery,
} from "@/lib/graphql-queries";
import { parseThreadJsonRenderFallbacks } from "@/lib/genui-registry";
import { useMe } from "@/lib/hooks/use-users";
import { useTurnCompletion } from "@/lib/hooks/use-turn-completion";
import {
  mentionCandidatesForTargets,
} from "@/lib/thread-mentions";
import { buildThreadConversationSendVariables } from "@/lib/thread-conversation-send";
import {
  applyGoalIntent,
  cancelGoalIntent,
  clearGoalIntent,
  emptyGoalIntentDraft,
  type GoalIntentDraft,
} from "@/lib/composer-goal-intent";
import type { ApprovedComposerModel } from "@/lib/composer-model-selection";
import { pickImage } from "@/lib/agent/capture-image";
import {
  launchCamera,
  launchImagePicker,
} from "@/lib/agent/tools/image-picker";
import {
  launchDocumentPicker,
  type PickedDocument,
} from "@/lib/agent/tools/file-picker";
import type { ImagePart } from "@/lib/agent/types";
import type { ChatMessage } from "@/hooks/useGatewayChat";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { WebContent } from "@/components/layout/web-content";
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

  const { thread: threadData } = useThread(id);

  const [{ data: messagesData }, reexecuteMessages] = useLocalMessages(id);

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

  const [, executeSendMessage] = useMutation(SendMessageMutation);
  const [{ data: meData }] = useMe();
  const currentUser = meData?.me;
  const [{ data: mentionTargetsData }] = useQuery({
    query: ThreadMentionTargetsQuery,
    variables: { threadId: id ?? "" },
    pause: !id,
  });
  const [{ data: modelCatalogData }] = useQuery({
    query: MyApprovedModelCatalogQuery,
  });
  const mentionCandidates = useMemo(
    () =>
      mentionCandidatesForTargets(
        (mentionTargetsData?.threadMentionTargets ?? [])
          .filter((target) =>
            ["USER", "AGENT"].includes(String(target.targetType)),
          )
          .map((target) => ({
            id: target.id,
            targetType: target.targetType as "USER" | "AGENT",
            targetId: target.targetId,
            displayName: target.displayName,
            aliases: target.aliases,
            isDefaultAgent: target.isDefaultAgent,
            avatarUrl: target.avatarUrl,
            role: target.role,
            email: target.email,
            description: target.description,
          })),
      ),
    [mentionTargetsData?.threadMentionTargets],
  );
  const [messageText, setMessageText] = useState("");
  const [pendingMentions, setPendingMentions] = useState<
    MessageInputMention[]
  >([]);
  const [attachedImage, setAttachedImage] = useState<ImagePart | null>(null);
  const [attachedImageUri, setAttachedImageUri] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<PickedDocument | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [goalDraft, setGoalDraft] = useState<GoalIntentDraft>(
    emptyGoalIntentDraft,
  );
  const [activeGoalMode, setActiveGoalMode] =
    useState<SendMessageGoalMode | null>(null);
  const [showSystemMessages, setShowSystemMessages] = useState(false);
  const approvedModels = useMemo<ApprovedComposerModel[] | null>(() => {
    const models = modelCatalogData?.myApprovedModelCatalog;
    return models ? [...models] : null;
  }, [modelCatalogData?.myApprovedModelCatalog]);
  const selectedModel = useMemo(
    () =>
      approvedModels?.find((model) => model.modelId === selectedModelId) ??
      null,
    [approvedModels, selectedModelId],
  );

  // Convert messages to ChatMessage type with timestamp. SDK returns role as
  // the uppercase enum literal ("USER" | "ASSISTANT" | ...) whereas the
  // local ChatMessage type expects lowercase; normalize here.
  const chatMessages: ChatMessage[] = useMemo(() => {
    const edges = (messagesData?.messages?.edges ?? []) as any[];
    return edges.map((edge) => {
      const m = edge.node;
      const normalizedRole = String(m.role || "").toLowerCase();
      let toolResults: Array<Record<string, unknown>> | null = null;
      if (m.toolResults) {
        try {
          const parsed =
            typeof m.toolResults === "string"
              ? JSON.parse(m.toolResults)
              : m.toolResults;
          if (Array.isArray(parsed) && parsed.length > 0) toolResults = parsed;
        } catch {}
      }

      return {
        id: m.id,
        role: (normalizedRole === "user"
          ? "user"
          : "assistant") as ChatMessage["role"],
        content: (m.content ?? "").trim(),
        durableArtifact: m.durableArtifact ?? null,
        toolResults,
        genuiFallbacks: parseThreadJsonRenderFallbacks(m.parts),
        timestamp: new Date(m.createdAt).getTime(),
        isStreaming: false,
      };
    });
  }, [messagesData]);

  const visibleChatMessages = useMemo(
    () =>
      showSystemMessages
        ? chatMessages
        : chatMessages.filter((message) => !isSystemMessage(message)),
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
  const invertedItems = useMemo(
    () => [...interleaved].reverse(),
    [interleaved],
  );

  const lastMsg =
    chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
  const isStreaming = lastMsg?.role === "user";

  const handleAttach = useCallback(() => {
    Alert.alert("Attach image", undefined, [
      {
        text: "Photo Library",
        onPress: async () => {
          const img = await pickImage(launchImagePicker);
          if (img) {
            setAttachedImage(img);
            setAttachedImageUri(`data:image/${img.format};base64,${img.data}`);
          }
        },
      },
      {
        text: "Camera",
        onPress: async () => {
          const img = await pickImage(launchCamera);
          if (img) {
            setAttachedImage(img);
            setAttachedImageUri(`data:image/${img.format};base64,${img.data}`);
          }
        },
      },
      {
        text: "File",
        onPress: async () => {
          const result = await launchDocumentPicker();
          const file = result.canceled ? null : result.assets?.[0];
          if (file) setAttachedFile(file);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const handleSend = async () => {
    if (!id) return;
    const content = messageText.trim();
    const image = attachedImage;
    const file = attachedFile;
    if (!content && !image && !file) return;

    const userText =
      content ||
      (file ? `Attached file: ${file.name}.` : "Attached image for this turn.");
    setMessageText("");
    setAttachedImage(null);
    setAttachedImageUri(null);
    setAttachedFile(null);
    setPendingMentions([]);
    Keyboard.dismiss();

    try {
      await executeSendMessage(
        buildThreadConversationSendVariables({
          threadId: id,
          content: userText,
          currentUserId: currentUser?.id,
          mentions: pendingMentions,
          modelId: selectedModel?.modelId,
          goalMode: activeGoalMode,
        }) as any,
      );
      markThreadActive(id);
      if (activeGoalMode) {
        const next = clearGoalIntent();
        setGoalDraft(next.draft);
        setActiveGoalMode(next.activeGoalMode);
      }
    } catch (e) {
      console.error("[ThreadChat] send failed:", e);
    }
  };

  const title = threadData?.title || "Conversation";

  const renderItem = ({ item }: { item: ListItem }) => {
    return (
      <WebContent>
        <ChatBubble
          message={item.data}
          showSystemMessages={showSystemMessages}
        />
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
            <Text
              className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 flex-1"
              numberOfLines={1}
            >
              {title}
            </Text>
          </Pressable>
          <View className="px-2">
            <HeaderContextMenu
              trigger={<MoreHorizontal size={22} color={colors.foreground} />}
              items={[
                {
                  label: showSystemMessages
                    ? "Hide System Messages"
                    : "Show System Messages",
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
              <View
                className="flex-1 items-center justify-center px-8 pt-32"
                style={{ transform: [{ scaleY: -1 }] }}
              >
                <Text className="text-lg font-semibold mb-2">
                  No messages yet
                </Text>
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
            <MessageInputFooter
              value={messageText}
              onChangeText={setMessageText}
              onSubmit={handleSend}
              colors={colors}
              isDark={colorScheme === "dark"}
              onAttach={handleAttach}
              mentionCandidates={mentionCandidates ?? []}
              selectedMentions={pendingMentions}
              onMentionsChange={setPendingMentions}
              attachedImageUri={attachedImageUri}
              attachedFileName={attachedFile?.name ?? null}
              onRemoveAttachment={() => {
                setAttachedImage(null);
                setAttachedImageUri(null);
                setAttachedFile(null);
              }}
              modelOptions={approvedModels}
              selectedModelId={selectedModelId}
              onModelSelect={(model) => setSelectedModelId(model.modelId)}
              goalDraft={goalDraft}
              goalActive={Boolean(activeGoalMode)}
              onGoalDraftChange={setGoalDraft}
              onGoalApply={(draft) => {
                const next = applyGoalIntent(
                  { draft: goalDraft, activeGoalMode },
                  draft,
                );
                setGoalDraft(next.draft);
                setActiveGoalMode(next.activeGoalMode);
              }}
              onGoalCancel={() => {
                const next = cancelGoalIntent({
                  draft: goalDraft,
                  activeGoalMode,
                });
                setGoalDraft(next.draft);
                setActiveGoalMode(next.activeGoalMode);
              }}
              onGoalClear={() => {
                const next = clearGoalIntent();
                setGoalDraft(next.draft);
                setActiveGoalMode(next.activeGoalMode);
              }}
            />
          </WebContent>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}
