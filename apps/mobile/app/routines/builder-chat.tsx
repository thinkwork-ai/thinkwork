import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks/use-tenants";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import type { ChatMessage } from "@/hooks/useGatewayChat";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";

const WELCOME_ROUTINE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Tell me what you'd like this routine to do, and I'll help you plan it out.\n\nFor example:\n- \"Check weather in Honolulu every morning\"\n- \"Send a Slack message when a webhook fires\"\n- \"Fetch data from an API and summarize it\"",
  timestamp: Date.now(),
  isStreaming: false,
};

const WELCOME_EDIT_ROUTINE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "I've loaded the existing routine code and documentation. What changes would you like to make?",
  timestamp: Date.now(),
  isStreaming: false,
};

// -- Main screen --

export default function BuilderChatScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  // -- Route params --
  const params = useLocalSearchParams<{
    routineName?: string;
    editSlug?: string;
    routineDescription?: string;
    routineId?: string;
    autoStart?: string;
    existingThreadId?: string;
    pendingQuestions?: string;
  }>();
  const routineName = params.routineName;
  const editSlug = params.editSlug;
  const existingThreadId = params.existingThreadId;
  const pendingQuestions: string[] = useMemo(() => {
    try {
      return params.pendingQuestions ? JSON.parse(params.pendingQuestions) : [];
    } catch { return []; }
  }, [params.pendingQuestions]);

  // -- Tenant context --
  const [{ data: tenantData }] = useTenant(tenantId);
  const tenant = tenantData?.tenant;
  const tenantSlug = tenant?.slug ?? "";
  const tenantRepo = tenantSlug ? `thinkwork-ai/tenant-${tenantSlug}` : "";

  // -- Code factory (no assistant needed) --
  // TODO: Migrate api.codeFactoryChat.createSession to GraphQL
  // TODO: Migrate api.codeFactoryChat.sendMessage to GraphQL
  // TODO: Migrate api.codeFactoryChat.listMessages to GraphQL

  const [building, setBuilding] = useState(false);
  const [sessionThreadId, setSessionThreadId] = useState<string | null>(null);

  // Create session on mount (or use existing thread)
  const sessionCreated = useRef(false);
  useEffect(() => {
    if (sessionCreated.current) return;
    if (existingThreadId) {
      sessionCreated.current = true;
      setSessionThreadId(existingThreadId);
      return;
    }
    sessionCreated.current = true;
    // TODO: Migrate createSession to GraphQL
    // For now, just set a placeholder
    Alert.alert("Not Ready", "Builder Chat session creation not yet migrated to GraphQL.");
  }, [existingThreadId]);

  // Subscribe to messages
  // TODO: Migrate api.codeFactoryChat.listMessages to GraphQL
  const rawMessages = undefined as any[] | undefined; // Stub

  const serverMessages: ChatMessage[] = (rawMessages ?? []).map((m: any) => ({
    id: m.id,
    role: (m.role ?? "user") as ChatMessage["role"],
    content: m.content,
    timestamp: m.createdAt ? new Date(m.createdAt).getTime() : Date.now(),
    isStreaming: (m.status === "pending" || m.status === "processing") && m.role === "user",
  }));

  const welcomeMsg = useMemo(() => {
    if (editSlug) return WELCOME_EDIT_ROUTINE;
    if (pendingQuestions.length > 0) {
      const questionText = pendingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n");
      return {
        ...WELCOME_ROUTINE,
        content: `I need a bit more information before I can build this routine:\n\n${questionText}`,
      };
    }
    return WELCOME_ROUTINE;
  }, [editSlug, pendingQuestions]);

  const messages = [welcomeMsg, ...serverMessages];

  const lastServerMsg = serverMessages[serverMessages.length - 1];
  const isPending =
    !!lastServerMsg && lastServerMsg.role === "user" && (lastServerMsg.isStreaming ?? false);

  const hasConversation = serverMessages.length > 0;
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const handleSend = async (content: string) => {
    if (!sessionThreadId) {
      Alert.alert("Not Ready", "Builder Chat is still starting up. Please wait a moment.");
      return;
    }
    // TODO: Migrate sendMessage to GraphQL
    Alert.alert("Not Ready", "Message sending not yet migrated to GraphQL.");
  };

  const handleBuild = useCallback(async () => {
    if (!sessionThreadId || !tenantRepo || building) return;
    setBuilding(true);
    try {
      const routineSlug = editSlug || (routineName || "routine")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      // TODO: Migrate sendMessage (build) to GraphQL

      // Navigate to routine detail to see build progress
      if (params.routineId) {
        router.replace(`/routines/${params.routineId}`);
      } else {
        router.replace("/(tabs)/routines");
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to send build request");
      setBuilding(false);
    }
  }, [sessionThreadId, tenantRepo, building, editSlug, routineName, params.routineId]);

  const notReady = !sessionThreadId || !tenantRepo;

  return (
    <DetailLayout
      title={editSlug && routineName ? `Edit: ${routineName}` : "Routine Builder"}
      headerRight={
        hasConversation && tenantRepo ? (
          <Pressable onPress={handleBuild} disabled={building || notReady}>
            <Text
              style={{ color: building ? colors.mutedForeground : "#0ea5e9" }}
              className="font-semibold text-base"
            >
              {building ? "Building..." : "Build"}
            </Text>
          </Pressable>
        ) : null
      }
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {!sessionThreadId ? (
          <View className="flex-1 items-center justify-center">
            <Text variant="muted" className="mt-3 text-center">
              Starting routine builder...
            </Text>
          </View>
        ) : (
          <>
            <FlatList
              ref={listRef}
              data={[...messages].reverse()}
              inverted
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <WebContent>
                  <ChatBubble message={item} />
                </WebContent>
              )}
              ListHeaderComponent={isPending ? <TypingIndicator /> : null}
              contentContainerStyle={{ paddingVertical: 12 }}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              className="flex-1"
            />
          </>
        )}

        <WebContent>
          <ChatInput onSend={handleSend} disabled={notReady} />
        </WebContent>
      </KeyboardAvoidingView>
    </DetailLayout>
  );
}
