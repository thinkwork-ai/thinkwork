import React, { useRef, useState, useCallback, useEffect } from "react";
import { View, FlatList, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { IconHistory } from "@tabler/icons-react-native";
import { Plus } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { useGatewayChat, type ChatMessage } from "@/hooks/useGatewayChat";
import { useGraphQLChat } from "@/hooks/useGraphQLChat";
import { ChatBubble } from "./ChatBubble";
import { ChatInput, type SelectedMention } from "./ChatInput";
import type { MentionCandidate } from "./MentionAutocomplete";
import { AgentPicker } from "./AgentPicker";
import { useColorScheme } from "nativewind";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { WebContent } from "@/components/layout/web-content";
import { COLORS } from "@/lib/theme";
import type { UiAction } from "@/lib/ui-envelope-types";

interface ChatScreenProps {
  baseUrl: string;
  token: string;
  agentType?: string;
  agentName?: string;
  agents?: any[];
  selectedAgentId?: string;
  onSelectAgent?: (agent: any) => void;
  agentId?: string;
  threadId?: string;
  tenantId?: string;
  caller?: { name?: string; email?: string; role?: string };
  sessionKey?: string;
  title?: string;
  onNewChat?: () => void;
  onFirstExchange?: (userMsg: string, assistantMsg: string) => void;
  mentionCandidates?: MentionCandidate[];
  /** Hide the built-in header (agent name, history, + New). Used when rendered inside ChatSheet. */
  hideHeader?: boolean;
}

interface ChatViewProps {
  messages: ChatMessage[];
  send: (text: string, mentions?: SelectedMention[]) => void;
  connectionStatus: "connecting" | "connected" | "disconnected" | "error";
  isStreaming: boolean;
  historyLoaded: boolean;
  agentName?: string;
  agents?: any[];
  selectedAgentId?: string;
  onSelectAgent?: (agent: any) => void;
  title?: string;
  onNewChat?: () => void;
  mentionCandidates?: MentionCandidate[];
  hideHeader?: boolean;
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text size="xl" weight="semibold" className="mb-2">
        👋 Welcome to Team
      </Text>
      <Text variant="muted" className="text-center">
        Send a message to start a conversation with your agent.
      </Text>
    </View>
  );
}

function GraphQLChatScreen(props: Omit<ChatScreenProps, "baseUrl" | "token">) {
  const { messages, sendMessage, isConnected, isStreaming, historyLoaded } = useGraphQLChat(
    props.selectedAgentId ?? "",
    props.threadId,
    props.tenantId,
    props.caller,
  );
  return (
    <ChatView
      messages={messages}
      send={sendMessage}
      connectionStatus={isConnected ? "connected" : "disconnected"}
      isStreaming={isStreaming}
      historyLoaded={historyLoaded}
      agentName={props.agentName}
      agents={props.agents}
      selectedAgentId={props.selectedAgentId}
      onSelectAgent={props.onSelectAgent}
      title={props.title}
      onNewChat={props.onNewChat}
      mentionCandidates={props.mentionCandidates}
      hideHeader={props.hideHeader}
    />
  );
}

function GatewayChatScreen(props: ChatScreenProps) {
  const useDeviceAuth = props.agentType === "local";
  const { messages, send, connectionStatus, isStreaming, historyLoaded } = useGatewayChat(
    props.baseUrl,
    props.token,
    {
      useDeviceAuth,
      caller: props.caller,
      sessionKey: props.sessionKey,
      onFirstExchange: props.onFirstExchange,
    }
  );
  return (
    <ChatView
      messages={messages}
      send={send}
      connectionStatus={connectionStatus}
      isStreaming={isStreaming}
      historyLoaded={historyLoaded}
      agentName={props.agentName}
      agents={props.agents}
      selectedAgentId={props.selectedAgentId}
      onSelectAgent={props.onSelectAgent}
      title={props.title}
      onNewChat={props.onNewChat}
      mentionCandidates={props.mentionCandidates}
      hideHeader={props.hideHeader}
    />
  );
}

export function ChatScreen(props: ChatScreenProps) {
  // GraphQL path for default Team chat unless an explicit
  // session key is provided (thread-bound gateway session mode).
  if (!props.sessionKey) {
    return (
      <GraphQLChatScreen
        selectedAgentId={props.selectedAgentId}
        agentName={props.agentName}
        agentType={props.agentType}
        agents={props.agents}
        onSelectAgent={props.onSelectAgent}
        threadId={props.threadId}
        tenantId={props.tenantId}
        caller={props.caller}
        title={props.title}
        onNewChat={props.onNewChat}
        mentionCandidates={props.mentionCandidates}
        hideHeader={props.hideHeader}
      />
    );
  }

  return <GatewayChatScreen {...props} />;
}

function ChatView({
  messages,
  send,
  connectionStatus,
  isStreaming,
  historyLoaded,
  agentName,
  agents = [],
  selectedAgentId = "",
  onSelectAgent,
  title,
  onNewChat,
  mentionCandidates = [],
  hideHeader,
}: ChatViewProps) {
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const insets = useSafeAreaInsets();
  const [pendingMentions, setPendingMentions] = useState<SelectedMention[]>([]);
  const { colorScheme } = useColorScheme();
  const { isWide } = useMediaQuery();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();

  // Track IDs present at initial load so we only animate truly new messages
  const initialIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (historyLoaded && initialIds.current === null) {
      initialIds.current = new Set(messages.map((m) => m.id));
    }
  }, [historyLoaded, messages]);


  // Handle UI envelope actions — sends a system-instruction message to invoke the tool
  const handleEnvelopeAction = useCallback(
    (action: UiAction, context?: Record<string, unknown>) => {
      if (action.action.type === "tool.invoke" && action.action.tool) {
        // Extract display metadata (UI-only, not sent to tool)
        const displayLabel = context?._displayLabel as string | undefined;
        const fieldLabel = context?._fieldLabel as string | undefined;
        const { _displayLabel, _fieldLabel, ...cleanContext } = (context ?? {}) as Record<string, unknown>;
        const mergedArgs = {
          ...action.action.presetArgs,
          ...action.action.args,
          ...cleanContext,
        };

        // Build a human-readable interaction message that persists in the thread
        // Prefer the entity arg (e.g. "lead", "opportunity", "task") for a clean label
        const entityArg = mergedArgs.entity as string | undefined;
        const typeName = entityArg
          ? entityArg.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
          : action.action.tool
              .replace(/_graphql$/, "")
              .replace(/_schema$/, "")
              .replace(/_detail$/, "")
              .replace(/_list$/, "")
              .replace(/_update$/, "")
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c: string) => c.toUpperCase());
        let interactionText = "";
        if (fieldLabel) {
          // Came from a select/dropdown — this is a mutation
          interactionText = displayLabel
            ? `Update ${fieldLabel.toLowerCase()} to ${displayLabel}`
            : `Update ${fieldLabel.toLowerCase()}`;
        } else if (displayLabel) {
          interactionText = `Fetch ${typeName}: ${displayLabel}`;
        } else {
          interactionText = `Fetch ${typeName}`;
        }

        const argsStr = Object.entries(mergedArgs)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(", ");
        const interactionTag = interactionText ? `[INTERACTION]${interactionText}[/INTERACTION]\n` : "";
        const instruction = `${interactionTag}[SYSTEM INSTRUCTION]\nACTION REQUIRED: Call the ${action.action.tool} tool with these arguments: ${argsStr}\n[/SYSTEM INSTRUCTION]`;
        send(instruction);
      }
    },
    [send],
  );
  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-neutral-950"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      {/* Header — hidden when rendered inside ChatSheet */}
      {!hideHeader && (
        <View
          style={isWide ? undefined : { paddingTop: insets.top }}
          className="bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800"
        >
          <View
            className="flex-row items-center justify-between px-4"
            style={isWide ? { height: 55 } : { paddingVertical: 6 }}
          >
            {/* Agent name (tappable to switch) + New button */}
            <View className="flex-row items-center gap-3">
              {agents && agents.length > 1 ? (
                <AgentPicker
                  agents={agents}
                  selectedId={selectedAgentId}
                  onSelect={(a) => onSelectAgent?.(a)}
                >
                  <View className="flex-row items-center gap-2" hitSlop={8}>
                    <Text size={isWide ? "lg" : "xl"} weight="bold">{agentName || "Agent"}</Text>
                  </View>
                </AgentPicker>
              ) : (
                <Text size={isWide ? "lg" : "xl"} weight="bold">{agentName || "Agent"}</Text>
              )}
              {title ? (
                <Text size="sm" variant="muted">{title}</Text>
              ) : null}
              <Pressable
                onPress={() => router.push("/threads")}
                hitSlop={8}
              >
                <IconHistory size={22} strokeWidth={1.5} color={colors.primary} />
              </Pressable>
            </View>
            {/* New chat button */}
            {onNewChat && (
              <Pressable
                onPress={onNewChat}
                className="flex-row items-center gap-1"
                hitSlop={8}
              >
                <Plus size={18} color={colors.primary} />
                <Text style={{ color: colors.primary }} className="font-semibold text-base">New</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {!historyLoaded ? (
        <View className="flex-1" />
      ) : messages.length === 0 && !isStreaming ? (
        <EmptyState />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          inverted
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <WebContent centered>
              <ChatBubble
                message={item}
                onEnvelopeAction={handleEnvelopeAction}
                animate={initialIds.current !== null && !initialIds.current.has(item.id)}
              />
            </WebContent>
          )}
          contentContainerStyle={{ paddingVertical: 12 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
        />
      )}

      <WebContent centered>
        <ChatInput
          onSend={(text) => {
            let enrichedText = text;
            if (pendingMentions.length > 0) {
              const assistantMentions = pendingMentions.filter((m) => m.type === "assistant");
              if (assistantMentions.length > 0) {
                const instructions = assistantMentions.map((m) =>
                  `ACTION REQUIRED: The user mentioned @${m.name}. You MUST call the request_assistant tool to delegate to them. Use targetAssistantId="${m.id}", parentTicketId from your current thread context. Compose a clear request message based on what the user asked. Do NOT just describe what you would do — actually call the tool.`
                ).join("\n");
                enrichedText = `${text}\n\n[SYSTEM INSTRUCTION]\n${instructions}\n[/SYSTEM INSTRUCTION]`;
              }
            }
            send(enrichedText, pendingMentions.length > 0 ? pendingMentions : undefined);
            setPendingMentions([]);
          }}
          disabled={connectionStatus !== "connected"}
          mentions={mentionCandidates ?? []}
          onMentionsChange={setPendingMentions}
        />
      </WebContent>

    </KeyboardAvoidingView>
  );
}
