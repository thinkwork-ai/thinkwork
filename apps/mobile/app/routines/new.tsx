import { useState, useCallback } from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks/use-tenants";
import { useCreateRoutine } from "@/lib/hooks/use-routines";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { callMcpTool } from "@/lib/mcp-client";

type BuildPhase = "form" | "evaluating";

export default function NewRoutineScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<BuildPhase>("form");

  const [, createRoutine] = useCreateRoutine();

  // TODO: Migrate api.routines.updateBuildStatus to GraphQL
  // TODO: Migrate api.routines.linkBuilderThread to GraphQL
  // TODO: Migrate api.codeFactoryChat.createSession to GraphQL
  // TODO: Migrate api.codeFactoryChat.sendMessage to GraphQL

  // Resolve tenant for repo context
  const [{ data: tenantData }] = useTenant(tenantId);
  const tenant = tenantData?.tenant;
  const tenantSlug = tenant?.slug ?? "";
  const tenantRepo = tenantSlug ? `thinkwork-ai/tenant-${tenantSlug}` : "";

  const canSave = name.trim().length > 0 && description.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!canSave || phase !== "form" || !tenantRepo) return;

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    setPhase("evaluating");

    try {
      // Step 1: Ask the LLM whether we have enough info to build
      const evaluation = await callMcpTool<{
        decision: "build" | "ask";
        message: string;
        questions?: string[];
      }>("evaluate_routine", { name: trimmedName, description: trimmedDesc });

      // Step 2: Create the draft routine
      const result = await createRoutine({
        input: {
          name: trimmedName,
          description: trimmedDesc,
          tenantId: tenantId!,
          type: "durable",
        },
      });
      const routineId = result.data?.createRoutine?.id;
      if (!routineId) throw new Error("Failed to create routine");

      // TODO: Migrate createSession + linkBuilderThread + updateBuildStatus + sendMessage to GraphQL
      // For now, navigate to routine detail
      if (evaluation.decision === "build") {
        router.replace(`/routines/${routineId}`);
      } else {
        router.replace({
          pathname: "/routines/builder-chat",
          params: {
            routineName: trimmedName,
            routineId,
            pendingQuestions: JSON.stringify(evaluation.questions ?? []),
          },
        });
      }
    } catch (err: any) {
      setPhase("form");
      Alert.alert("Error", err?.message || "Failed to create routine");
    }
  }, [canSave, phase, tenantRepo, name, description]);

  const inputBg = colorScheme === "dark" ? "#171717" : "#f5f5f5";
  const inputBorder = colorScheme === "dark" ? "#262626" : "#e5e5e5";
  const inputText = colorScheme === "dark" ? "#fafafa" : "#0a0a0a";
  const placeholderColor = colorScheme === "dark" ? "#525252" : "#a3a3a3";

  const notReady = !tenantRepo;

  // -- Evaluating phase: full-screen loading overlay --
  if (phase === "evaluating") {
    return (
      <DetailLayout title="New Routine">
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color="#f97316" />
          <Muted className="mt-4 text-center">
            Evaluating your routine...
          </Muted>
        </View>
      </DetailLayout>
    );
  }

  // -- Form phase --
  return (
    <DetailLayout title="New Routine">
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
              Describe what you want to automate and we'll build it for you.
            </Muted>

            <Input
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Check Weather in Austin"
              autoCapitalize="words"
              autoFocus
            />

            <View className="gap-1.5">
              <Text weight="medium" className="text-sm text-neutral-700 dark:text-neutral-300">
                What do you want to do?
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. Fetch the current weather in Austin, TX and return it as a formatted string"
                placeholderTextColor={placeholderColor}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
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
                  Save
                </Text>
              </Pressable>
            </View>
          </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
