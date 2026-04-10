import { useState, useMemo } from "react";
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { WebContent } from "@/components/layout/web-content";
import { ArrowLeft } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { useAgents, useAgent } from "@/lib/hooks/use-agents";

type EnvField = { key: string; label: string; secret: boolean; defaultValue?: string };

export default function SkillConfigureScreen() {
  const { skillId, assistantId } = useLocalSearchParams<{
    skillId: string;
    assistantId: string;
  }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // TODO: Skill catalog not yet available via GraphQL — stub empty array
  const catalog: any[] | undefined = [];
  const skill = catalog?.find((s: any) => s.skillId === skillId);
  // TODO: Skill bindings not yet available via GraphQL
  const agentSkills: any[] | undefined = [];
  const binding = agentSkills?.find((s: any) => s.skillId === skillId);
  const [{ data: agentData }] = useAgent(assistantId);
  const agent = agentData?.agent;

  const [envFormValues, setEnvFormValues] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Initialize form from existing envHints when binding loads
  const formValues = useMemo(() => {
    if (envFormValues !== null) return envFormValues;
    if (!binding || !skill) return {};
    const hints = (binding.envHints ?? {}) as Record<string, string>;
    const initial: Record<string, string> = {};
    for (const field of skill.requiresEnv) {
      initial[field.key] = hints[field.key] ?? "";
    }
    return initial;
  }, [envFormValues, binding, skill]);

  const isFormComplete = useMemo(
    () => skill?.requiresEnv.every((f: EnvField) => formValues[f.key]?.trim()) ?? true,
    [skill, formValues]
  );

  const handleSave = async () => {
    if (!assistantId || !skillId) return;
    setSaving(true);
    try {
      // TODO: updateSkillCredentials action not yet available via GraphQL
      throw new Error("Credential update not yet available via GraphQL");
    } catch (err: any) {
      const errMsg = err?.message ?? "Failed to update credentials";
      if (Platform.OS === "web") {
        window.alert(errMsg);
      } else {
        Alert.alert("Error", errMsg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = () => {
    const doRemove = async () => {
      setRemoving(true);
      try {
        // TODO: uninstallSkill action not yet available via GraphQL
        throw new Error("Skill removal not yet available via GraphQL");
      } catch (err: any) {
        const errMsg = err?.message ?? "Failed to remove skill";
        if (Platform.OS === "web") {
          window.alert(errMsg);
        } else {
          Alert.alert("Error", errMsg);
        }
        setRemoving(false);
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm(`Remove "${skill?.name}" from ${agent?.name}?`)) {
        doRemove();
      }
    } else {
      Alert.alert(
        "Remove Skill",
        `Remove "${skill?.name}" from ${agent?.name}? This will delete the stored credentials.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: doRemove },
        ]
      );
    }
  };

  const title = agent?.name
    ? `${skill?.name ?? skillId} \u2014 ${agent.name}`
    : skill?.name ?? skillId ?? "Configure";

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <View
        style={{ paddingTop: insets.top }}
        className="border-b border-neutral-200 dark:border-neutral-800"
      >
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center gap-3 flex-1 active:opacity-70"
          >
            <ArrowLeft size={20} color={colors.foreground} />
            <Text size="lg" weight="semibold" className="flex-1" numberOfLines={1}>
              {title}
            </Text>
          </Pressable>
          <Pressable onPress={handleRemove} disabled={removing} className="ml-3">
            {removing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={{ color: colors.primary }} className="font-semibold text-base">Remove</Text>
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <WebContent>
          {skill?.description ? (
            <View className="px-4 pt-4 pb-2">
              <Muted>{skill.description}</Muted>
            </View>
          ) : null}

          <View className="px-4 py-3">
            <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              Credentials
            </Text>
          </View>

          <View className="px-4">
            {(skill?.requiresEnv ?? []).map((field: EnvField) => (
              <View key={field.key} className="mb-4">
                <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  {field.label}
                </Text>
                <TextInput
                  value={formValues[field.key] ?? ""}
                  onChangeText={(text) =>
                    setEnvFormValues((prev) => ({
                      ...(prev ?? formValues),
                      [field.key]: text,
                    }))
                  }
                  secureTextEntry={field.secret}
                  placeholder={field.label}
                  placeholderTextColor="#a3a3a3"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="border border-neutral-300 dark:border-neutral-700 rounded-lg text-neutral-900 dark:text-neutral-100 bg-white dark:bg-neutral-900"
                  style={{
                    height: 44,
                    paddingHorizontal: 12,
                    fontSize: 16,
                    lineHeight: 20,
                  }}
                />
              </View>
            ))}

            <Pressable
              onPress={handleSave}
              disabled={!isFormComplete || saving}
              className={`rounded-lg py-3 items-center mt-2 ${
                isFormComplete ? "bg-orange-500" : "bg-neutral-300 dark:bg-neutral-700"
              }`}
            >
              {saving ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-white font-semibold text-base">
                  Save Credentials
                </Text>
              )}
            </Pressable>
          </View>
        </WebContent>
      </ScrollView>
    </View>
  );
}
