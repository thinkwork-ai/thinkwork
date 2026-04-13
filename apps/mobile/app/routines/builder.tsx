import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, FlatList, KeyboardAvoidingView, Platform, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { useRoutine } from "@/lib/hooks/use-routines";
import { COLORS } from "@/lib/theme";
import { Text } from "@/components/ui/typography";
import type { ChatMessage } from "@/hooks/useGatewayChat";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatInput } from "@/components/chat/ChatInput";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { ROUTINE_BUILDER_PROMPT } from "@/prompts/routine-builder";

const NEW_WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Describe what you want your routine to do and I'll build it for you.\n\nFor example:\n- \"Fetch data from an API every hour and send a Slack summary\"\n- \"When a webhook fires, validate the payload and store it\"\n- \"Check our status page and notify me if anything is down\"",
  timestamp: Date.now(),
  isStreaming: false,
};

const EDIT_WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "I've loaded the existing routine code and documentation. What changes would you like to make?",
  timestamp: Date.now(),
  isStreaming: false,
};

const ERROR_WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "I've loaded the routine code and the error from the last run. Add any context you'd like, then send to start fixing.",
  timestamp: Date.now(),
  isStreaming: false,
};

export default function RoutineBuilderScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const params = useLocalSearchParams<{
    name: string;
    triggerType: string;
    assistantId: string;
    routineId: string;
    edit: string;
    errorContext: string;
  }>();

  const assistantId = params.assistantId!;
  const isEditMode = params.edit === "true";
  const hasErrorContext = isEditMode && !!params.errorContext;
  const [building, setBuilding] = useState(false);
  const buildingStartedAt = useRef<number | null>(null);

  // Fetch existing routine for edit mode
  const [{ data: existingRoutineData }] = useRoutine(
    isEditMode && params.routineId ? params.routineId : ''
  );
  const existingRoutine = isEditMode ? (existingRoutineData?.routine ?? undefined) : undefined;

  // Watch routine record while building -- when code appears, save is complete
  const [{ data: routineRecordData }] = useRoutine(
    building && params.routineId ? params.routineId : ''
  );
  const routineRecord = building ? (routineRecordData?.routine ?? undefined) : undefined;

  useEffect(() => {
    if (!building || !routineRecord) return;
    const rt = routineRecord as any;
    console.log("[RoutineBuilder] Watching routine record:", {
      hasCode: !!rt.code,
      updatedAt: rt.updatedAt,
      buildingStartedAt: buildingStartedAt.current,
    });
    // Check if code was updated after we started building
    if (rt.code && rt.updatedAt > (buildingStartedAt.current ?? 0)) {
      console.log("[RoutineBuilder] Code detected! Build complete.");
      setBuilding(false);
      router.replace("/(tabs)/routines");
    }
  }, [building, routineRecord]);

  // Timeout after 60s
  useEffect(() => {
    if (!building) return;
    const timer = setTimeout(() => {
      setBuilding(false);
      Alert.alert("Timeout", "Routine save is taking too long. The agent may still be working -- check back shortly.");
    }, 60000);
    return () => clearTimeout(timer);
  }, [building]);

  const [sessionThreadId, setSessionThreadId] = useState<string | null>(null);

  // TODO: messages.createChatSession and messages.sendChatToSession not yet available via GraphQL
  const createSession = async (_args: any): Promise<string> => {
    // TODO: Replace with GraphQL mutation when available
    return "stub-thread-id";
  };
  const sendToSession = async (_args: any) => {};

  // Create a fresh session on mount (but don't send a seed message)
  const sessionCreated = useRef(false);
  useEffect(() => {
    if (sessionCreated.current) return;
    if (!assistantId) return; // Wait for assistantId
    sessionCreated.current = true;

    (async () => {
      const threadId = await createSession({
        assistantId,
        title: `Routine: ${params.name}`,
      });
      setSessionThreadId(threadId);
    })();
  }, []);

  // TODO: messages.listChatSession not yet available via GraphQL
  const rawMessages: any[] | undefined = undefined;

  const serverMessages: ChatMessage[] = (rawMessages ?? []).map((m: any) => {
    // Strip system context prefix from user messages so it's not visible
    let content = m.content;
    const systemEnd = "[END SYSTEM] ";
    const idx = content.indexOf(systemEnd);
    if (idx !== -1) {
      content = content.slice(idx + systemEnd.length);
    }
    return {
      id: m.id,
      role: (m.role ?? "user") as ChatMessage["role"],
      content,
      timestamp: m.createdAt,
      isStreaming: m.status === "pending" && m.role === "user",
    };
  });

  // Prepend the welcome message, then server messages
  const welcomeMsg = hasErrorContext ? ERROR_WELCOME : isEditMode ? EDIT_WELCOME : NEW_WELCOME;
  const messages = [welcomeMsg, ...serverMessages];

  const isPending = serverMessages.some((m) => m.role === "user" && m.isStreaming);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const handleSend = async (content: string) => {
    if (!sessionThreadId) return;
    // Prefix the first user message with routine context (hidden from display)
    const isFirstMessage = serverMessages.length === 0;
    let systemPrefix = "";
    if (isFirstMessage) {
      const baseContext = `[SYSTEM CONTEXT -- not visible to user]\n\n${ROUTINE_BUILDER_PROMPT}\n\nRoutine ID: ${params.routineId}. Name: "${params.name}". Trigger: ${params.triggerType}. TWO-PHASE FLOW: Phase 1 (now) -- discuss and design the routine with the user. Do NOT build yet. Phase 2 -- when you receive a "user clicked BUILD" message, THEN generate final code + documentation using the update_routine tool.`;
      if (isEditMode && existingRoutine) {
        const codeSection = (existingRoutine as any).code
          ? `\n\nEXISTING CODE:\n\`\`\`python\n${(existingRoutine as any).code}\n\`\`\``
          : "";
        const docsSection = (existingRoutine as any).documentation
          ? `\n\nEXISTING DOCUMENTATION:\n${(existingRoutine as any).documentation}`
          : "";
        systemPrefix = `${baseContext}\n\nThis is an EDIT of an existing routine. Preserve existing behavior unless the user asks to change it. Update the documentation with any changes you make.${codeSection}${docsSection} [END SYSTEM] `;
      } else {
        systemPrefix = `${baseContext} [END SYSTEM] `;
      }
    }
    const finalContent = isFirstMessage ? `${systemPrefix}${content}` : content;

    await sendToSession({
      threadId: sessionThreadId,
      assistantId,
      content: finalContent,
    });
  };

  return (
    <DetailLayout
      title="Routine Builder"
      headerRight={
        <Pressable
          onPress={async () => {
            if (!sessionThreadId || building) return;
            console.log("[RoutineBuilder] Build clicked", {
              sessionThreadId,
              assistantId: params.assistantId,
              routineId: params.routineId,
            });
            setBuilding(true);
            buildingStartedAt.current = Date.now();
            try {
              // Send finalize signal to assistant
              console.log("[RoutineBuilder] Sending finalize message...");
              await sendToSession({
                threadId: sessionThreadId,
                assistantId,
                content: `[SYSTEM CONTEXT -- not visible to user] The user clicked BUILD. Generate the final Python code, documentation, and a short description NOW based on our entire conversation. IMPORTANT: You MUST use ONLY the update_routine tool. Call update_routine with: routineId="${params.routineId}", code, documentation, and description. ONE tool call only. Do NOT ask the user anything. [END SYSTEM] Build routine`,
              });
              console.log("[RoutineBuilder] Finalize message sent successfully");
            } catch (err) {
              console.error("[RoutineBuilder] Error sending finalize:", err);
              setBuilding(false);
              Alert.alert("Error", `Failed to build: ${err}`);
            }
          }}
          disabled={!sessionThreadId || building}
        >
          <Text style={{ color: building ? colors.mutedForeground : "#0ea5e9" }} className="font-semibold text-base">
            {building ? "Building..." : "Build"}
          </Text>
        </Pressable>
      }
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        {building ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text variant="muted" className="mt-3 text-center text-base">
              Building routine...
            </Text>
          </View>
        ) : !sessionThreadId ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text variant="muted" className="mt-3 text-center">
              Starting routine builder...
            </Text>
          </View>
        ) : (
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
            ListHeaderComponent={
              isPending ? <TypingIndicator /> : null
            }
            contentContainerStyle={{ paddingVertical: 12 }}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
          />
        )}

        <WebContent>
          <ChatInput
            onSend={handleSend}
            disabled={!sessionThreadId}
            initialValue={params.errorContext ?? undefined}
          />
        </WebContent>
      </KeyboardAvoidingView>
    </DetailLayout>
  );
}
