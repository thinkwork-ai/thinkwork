import { useState, useMemo, useCallback } from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks/use-tenants";
import { useAgents } from "@/lib/hooks/use-agents";
import { useRoutine } from "@/lib/hooks/use-routines";
import { ROUTINE_BUILDER_PROMPT } from "@/prompts/routine-builder";

type EditPhase = "form" | "evaluating";

export default function EditRoutineScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;

  const params = useLocalSearchParams<{
    routineId: string;
    routineName: string;
    routineDescription: string;
    editSlug: string;
    prefill: string;
  }>();
  const routineId = params.routineId!;
  const editSlug = params.editSlug ?? "";

  const [description, setDescription] = useState(params.prefill ?? "");
  const [phase, setPhase] = useState<EditPhase>("form");

  // Load the routine's current published version markdown summary so the
  // chat agent has prior intent in context. Phase C U10 retargeted the
  // edit flow to the ASL chat builder; the legacy Python code-factory
  // path that read `routine.code` is gone, replaced by the markdown
  // summary that publishRoutineVersion regenerates on every publish.
  const [{ data: routineData }] = useRoutine(routineId);
  const existingRoutine = routineData?.routine as
    | { documentationMd?: string | null; currentVersion?: number | null }
    | undefined;
  // TODO: messages.createChatSession and sendChatToSession not yet available via GraphQL
  const createSession = async (_args: any): Promise<string> => "stub-thread-id";
  const sendToSession = async (_args: any) => {};

  // Resolve tenant for repo context
  const [{ data: tenantData }] = useTenant(tenantId ?? '');
  const tenant = tenantData?.tenant ?? undefined;
  const tenantSlug = (tenant as any)?.slug ?? "";
  const tenantRepo = tenantSlug ? `thinkwork-ai/tenant-${tenantSlug}` : "";

  // Resolve code-factory agent
  const [{ data: agentsData }] = useAgents(tenantId);
  const allAgents = agentsData?.agents ?? undefined;
  const chatAgent = useMemo(() => {
    if (!allAgents) return undefined;
    const all = allAgents as any[];
    return (
      all.find((a: any) => a.runtimeProfile === "code_main") ??
      all.find((a: any) => a.runtimeProfile === "code_factory") ??
      all.find((a: any) => a.role === "team") ??
      null
    );
  }, [allAgents]);
  const chatAgentId = chatAgent?.id as string | undefined;

  const canSave = description.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!canSave || phase !== "form" || !chatAgentId || !tenantRepo) return;

    const trimmedDesc = description.trim();
    const routineName = params.routineName ?? editSlug;
    setPhase("evaluating");

    try {
      // Phase C U10: dropped the buildStatus mutation. The legacy
      // code-factory flow tracked sub-agent progress via a buildStatus
      // field on routines that no longer exists in the GraphQL schema.
      // ASL publish is atomic — there is no in-flight state to track.
      // Create a chat session for this edit
      const threadId = await createSession({
        assistantId: chatAgentId,
        title: `Edit: ${routineName}`,
      });

      const summaryContext = existingRoutine?.documentationMd
        ? `\n\nEXISTING ROUTINE SUMMARY (markdown):\n${existingRoutine.documentationMd}`
        : "";
      const versionContext =
        typeof existingRoutine?.currentVersion === "number" &&
        existingRoutine.currentVersion > 0
          ? `\n\nCurrent published version: ${existingRoutine.currentVersion}`
          : "";

      const buildMessage = `[SYSTEM CONTEXT -- not visible to user]\n\n${ROUTINE_BUILDER_PROMPT}\n\nRoutine ID: ${routineId}\nRoutine name: "${routineName}"\nRoutine slug: ${editSlug}\n\nThis is an EDIT of an existing routine. Preserve existing behavior unless the user asks to change it. When the user clicks BUILD, call publishRoutineVersion exactly once with the updated ASL + markdown summary + step manifest.${summaryContext}${versionContext}\n\nYou have enough information to proceed. Discuss the change with the operator, then publish a new version when they confirm. [END SYSTEM] Update routine: ${trimmedDesc}`;

      await sendToSession({
        threadId: threadId,
        assistantId: chatAgentId,
        content: buildMessage,
      });

      router.replace("/(tabs)/routines");
    } catch (err: any) {
      setPhase("form");
      Alert.alert("Error", err?.message || "Failed to update routine");
    }
  }, [canSave, phase, chatAgentId, tenantRepo, description, tenantSlug, routineId, editSlug]);

  const inputBg = colorScheme === "dark" ? "#171717" : "#f5f5f5";
  const inputBorder = colorScheme === "dark" ? "#262626" : "#e5e5e5";
  const inputText = colorScheme === "dark" ? "#fafafa" : "#0a0a0a";
  const placeholderColor = colorScheme === "dark" ? "#525252" : "#a3a3a3";

  const notReady = !chatAgentId || !tenantRepo;

  if (phase === "evaluating") {
    return (
      <DetailLayout title="Edit Routine">
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color="#0ea5e9" />
          <Muted className="mt-4 text-center">
            Updating your routine...
          </Muted>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout title={`Edit: ${params.routineName ?? editSlug}`}>
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{
          paddingBottom: 40,
          alignItems: Platform.OS === "web" ? "flex-start" : undefined,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <WebContent>
          <View className="mt-4 px-4 gap-5" style={{ maxWidth: 640 }}>
            <Muted className="text-sm">
              Describe what you want to change and we'll update the routine.
            </Muted>

            <View className="gap-1.5">
              <Text weight="medium" className="text-sm text-neutral-700 dark:text-neutral-300">
                What do you want to change?
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Add error handling for API timeouts, change the output format to include humidity"
                placeholderTextColor={placeholderColor}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                autoFocus
                style={{
                  backgroundColor: inputBg,
                  borderWidth: 1,
                  borderColor: inputBorder,
                  borderRadius: 10,
                  padding: 12,
                  paddingTop: 12,
                  minHeight: 120,
                  color: inputText,
                  fontSize: 15,
                }}
              />
            </View>

            <View className="mt-2 flex-row justify-end gap-3">
              <Pressable
                onPress={() => router.back()}
                className="px-5 py-2.5 rounded-xl"
              >
                <Text weight="medium" className="text-neutral-500">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={!canSave || notReady}
                className="px-6 py-2.5 rounded-xl flex-row items-center gap-2"
                style={{
                  backgroundColor: canSave && !notReady ? "#0ea5e9" : "#525252",
                }}
              >
                <Text weight="semibold" className="text-white">
                  Update
                </Text>
              </Pressable>
            </View>
          </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
