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
import { useUpdateRoutine } from "@/lib/hooks/use-routines";
import { ROUTINE_BUILDER_CF_PROMPT } from "@/prompts/routine-builder-cf";

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

  const [, executeUpdateRoutine] = useUpdateRoutine();
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
      // Set build status to building
      await executeUpdateRoutine({ id: routineId, buildStatus: "building" });

      // Create a chat session for this edit
      const threadId = await createSession({
        assistantId: chatAgentId,
        title: `Edit: ${routineName}`,
      });

      const repoDir = tenantRepo.replace("/", "--");
      const repoContext = `\nTarget repository: ${tenantRepo} (available at /oc/${repoDir}/)`;
      const routineContext = `\nRoutine name: "${routineName}"`;
      const editContext = `\nEditing existing routine at: /oc/${repoDir}/routines/${editSlug}/routine.py`;
      const tenantContext = tenantSlug
        ? `\nTenant: ${tenantSlug}\nTenant repository: ${tenantRepo}`
        : "";

      const buildMessage = `[SYSTEM CONTEXT -- not visible to user]\n\n${ROUTINE_BUILDER_CF_PROMPT}${repoContext}${routineContext}${editContext}${tenantContext}\n\nRoutine ID: ${routineId}\nRoutine slug: ${editSlug}\n\nThis is an UPDATE to an existing routine. The sub-agent MUST:\n1. Read the existing routine code first\n2. Apply the requested changes\n3. Update the diagram if the workflow changed\n4. Append a changelog entry to the README\n\nAfter pushing to main, the sub-agent MUST run this command to mark the build complete:\ncurl -X POST "$THINKWORK_API_URL/api/routines/build-status" -H "Authorization: Bearer $MC_API_TOKEN" -H "Content-Type: application/json" -d '{"routineId":"${routineId}","buildStatus":"completed"}'\n\nYou have enough information. Build this update now. Do NOT ask questions. [END SYSTEM] Update routine: ${trimmedDesc}`;

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
          <ActivityIndicator size="large" color="#f97316" />
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
                  backgroundColor: canSave && !notReady ? "#f97316" : "#525252",
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
