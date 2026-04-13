import { useState, useCallback, useMemo } from "react";
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { MobileRow } from "@/components/ui/mobile-row";
import { WebContent } from "@/components/layout/web-content";
import { ArrowLeft, ChevronRight, X } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";

type EnvField = { key: string; label: string; secret: boolean; defaultValue?: string };

const SKILL_ENV_DEFAULTS: Record<string, Record<string, string>> = {};

export default function SkillDetailScreen() {
  const { skillId } = useLocalSearchParams<{ skillId: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;

  // TODO: Skill catalog not yet available via GraphQL — stub empty arrays
  const catalog: any[] | undefined = [];
  const skill = catalog?.find((s: any) => s.skillId === skillId);
  const [{ data: agentsData }] = useAgents(tenantId);
  const agents = agentsData?.agents;
  // TODO: Skill bindings not yet available via GraphQL
  const allBindings: any[] | undefined = [];

  const [configAgent, setConfigAgent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [envFormValues, setEnvFormValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);

  const skillBindings = allBindings?.filter((b: any) => b.skillId === skillId) ?? [];
  const installedAgentIds = new Set(skillBindings.map((b: any) => String(b.agentId)));

  // Unified list: all agents sorted alphabetically, each with configured status
  const agentRows = useMemo(() => {
    if (!agents) return [];
    return [...agents]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({
        ...a,
        configured: installedAgentIds.has(String(a.id)),
      }));
  }, [agents, installedAgentIds]);

  const handleOpenConfig = useCallback(
    (agentId: string, agentName: string) => {
      if (!skill) return;
      const skillDefaults = SKILL_ENV_DEFAULTS[skill.skillId] ?? {};
      const initial: Record<string, string> = {};
      for (const field of skill.requiresEnv) {
        initial[field.key] = field.defaultValue ?? skillDefaults[field.key] ?? "";
      }
      setEnvFormValues(initial);
      setConfigAgent({ id: agentId, name: agentName });
    },
    [skill]
  );

  const handleRowPress = (agentId: string, name: string, configured: boolean) => {
    if (configured) {
      router.push({
        pathname: "/skills/configure",
        params: { skillId: skillId!, assistantId: agentId },
      });
    } else {
      handleOpenConfig(agentId, name);
    }
  };

  const isFormComplete = useMemo(
    () => skill?.requiresEnv.every((f: EnvField) => envFormValues[f.key]?.trim()) ?? true,
    [skill, envFormValues]
  );

  const handleInstall = async () => {
    if (!configAgent || !skill) return;
    setInstalling(true);
    try {
      // TODO: installSkill action not yet available via GraphQL
      throw new Error("Skill installation not yet available via GraphQL");
    } catch (err: any) {
      const errMsg = err?.message ?? "Failed to install skill";
      if (Platform.OS === "web") {
        window.alert(errMsg);
      } else {
        Alert.alert("Install Failed", errMsg);
      }
    } finally {
      setInstalling(false);
    }
  };

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <View
        style={{ paddingTop: insets.top }}
        className="border-b border-neutral-200 dark:border-neutral-800"
      >
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center px-4 py-3 gap-3 active:opacity-70"
        >
          <ArrowLeft size={20} color={colors.foreground} />
          <Text size="lg" weight="semibold" className="flex-1" numberOfLines={1}>
            {skill?.name ?? skillId}
          </Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <WebContent>
          {/* Skill description */}
          {skill?.description ? (
            <View className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
              <Muted>{skill.description}</Muted>
            </View>
          ) : null}

          {/* Assistants list */}
          <View className="px-4 py-3">
            <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              Agents
            </Text>
          </View>

          {agentRows.length > 0 ? (
            <View className="bg-neutral-50 dark:bg-neutral-900">
              {agentRows.map((agent, idx) => (
                <MobileRow
                  key={agent.id}
                  isLast={idx === agentRows.length - 1}
                  onPress={() =>
                    handleRowPress(agent.id, agent.name, agent.configured)
                  }
                  line1Left={
                    <Text weight="medium" className="text-neutral-900 dark:text-neutral-100">
                      {agent.name}
                    </Text>
                  }
                  line1Right={
                    <View className="flex-row items-center gap-2">
                      <Badge variant={agent.configured ? "success" : "outline"}>
                        {agent.configured ? "configured" : "not configured"}
                      </Badge>
                      <ChevronRight size={16} color={colors.mutedForeground} />
                    </View>
                  }
                  line2Left={
                    (agent as any).instanceId ? (
                      <Muted className="text-sm">
                        {(agent as any).instanceId}
                      </Muted>
                    ) : undefined
                  }
                />
              ))}
            </View>
          ) : agents !== undefined ? (
            <View className="items-center py-10 px-6">
              <Muted className="text-center">No agents available</Muted>
            </View>
          ) : null}
        </WebContent>
      </ScrollView>

      {/* Configure & Install Modal */}
      <Modal
        visible={configAgent !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setConfigAgent(null)}
      >
        <View className="flex-1 bg-white dark:bg-neutral-950">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
            <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              {skill?.name ?? "Configure Skill"}
            </Text>
            <Pressable onPress={() => setConfigAgent(null)} className="p-1">
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            <View className="px-4 py-4">
              <Muted className="mb-4">
                Installing on{" "}
                <Text weight="semibold" className="text-neutral-900 dark:text-neutral-100">
                  {configAgent?.name}
                </Text>
              </Muted>

              {(skill?.requiresEnv ?? []).map((field: EnvField) => (
                <View key={field.key} className="mb-4">
                  <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                    {field.label}
                  </Text>
                  <TextInput
                    value={envFormValues[field.key] ?? ""}
                    onChangeText={(text) =>
                      setEnvFormValues((prev) => ({ ...prev, [field.key]: text }))
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
                onPress={handleInstall}
                disabled={!isFormComplete || installing}
                className={`rounded-lg py-3 items-center mt-2 ${
                  isFormComplete ? "bg-sky-500" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                {installing ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className="text-white font-semibold text-base">Install Skill</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
