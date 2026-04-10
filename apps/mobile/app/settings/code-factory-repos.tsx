import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { View, Pressable, ScrollView, ActionSheetIOS, Platform, Alert } from "react-native";
import { useColorScheme } from "nativewind";
import * as Linking from "expo-linking";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { ActionSheet } from "@/components/ui/action-sheet";
import { COLORS } from "@/lib/theme";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";

type Repo = {
  id: string;
  agentId: string;
  repoFullName: string;
  status: "connected" | "needs_reauth" | "revoked";
  authMethod?: "github_app" | "pat";
};

type Agent = {
  id: string;
  name: string;
  runtimeProfile?: string;
};

export default function CodeFactoryReposSettingsScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;

  const [{ data: agentsData }] = useAgents(tenantId);
  const agents = agentsData?.agents as Agent[] | undefined;

  // TODO: GitHub repo connections not yet available via GraphQL — return empty for now
  const repos: Repo[] | undefined = [];

  const [showAgentPicker, setShowAgentPicker] = useState(false);

  const codeFactoryAgents = useMemo(
    () => (agents || []).filter((agent) => (agent as any).runtimeProfile === "code_factory"),
    [agents],
  );

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    (agents || []).forEach((agent) => map.set(agent.id, agent.name));
    return map;
  }, [agents]);

  const sortedRepos = useMemo(() => {
    return [...(repos || [])].sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
  }, [repos]);

  const startInstallForAgent = async (agentId: string) => {
    // TODO: startGitHubInstall mutation not yet available via GraphQL
    try {
      Alert.alert("Code Factory", "GitHub App install not yet available via GraphQL.");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to start GitHub App install";
      Alert.alert("Code Factory", message);
    }
  };

  const onAdd = () => {
    if (codeFactoryAgents.length === 0) {
      Alert.alert("Code Factory Repositories", "Create a Code Factory agent first, then connect repositories.");
      return;
    }

    if (codeFactoryAgents.length === 1) {
      void startInstallForAgent(codeFactoryAgents[0]!.id);
      return;
    }

    if (Platform.OS === "ios") {
      const options = ["Cancel", ...codeFactoryAgents.map((agent) => agent.name)];
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 0 },
        (buttonIndex) => {
          const selected = codeFactoryAgents[buttonIndex - 1];
          if (selected) void startInstallForAgent(selected.id);
        },
      );
      return;
    }

    setShowAgentPicker(true);
  };

  return (
    <DetailLayout
      title="Code Factory Repositories"
      headerRight={
        <Pressable onPress={onAdd}>
          <Text style={{ color: colors.primary }} className="font-semibold text-base">+ New</Text>
        </Pressable>
      }
    >
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-8">
        {agents === undefined ? null : sortedRepos.length === 0 ? (
          <View className="mt-1">
          <View className="rounded-xl border border-dashed border-neutral-300 px-3 py-3 dark:border-neutral-700">
            <Muted className="text-sm">No GitHub repos configured yet.</Muted>
          </View>
          </View>
        ) : (
          <View className="mt-1 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            {sortedRepos.map((repo, idx) => (
              <Pressable
                key={repo.id}
                onPress={() => {
                  if (repo.status !== "connected") return;
                  router.push(`/agents/${repo.agentId}/code-factory?repo=${encodeURIComponent(repo.repoFullName)}`);
                }}
                className={`px-3 py-3 ${idx < sortedRepos.length - 1 ? "border-b border-neutral-100 dark:border-neutral-800" : ""}`}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="font-medium text-neutral-900 dark:text-neutral-100 flex-1" numberOfLines={1}>
                    {repo.repoFullName}
                  </Text>
                  <Badge variant={repo.status === "connected" ? "success" : "outline"}>
                    {repo.status === "connected" ? "Connected" : repo.status === "needs_reauth" ? "Needs Re-auth" : "Revoked"}
                  </Badge>
                </View>
                <Muted className="mt-1 text-xs">
                  {(agentNameById.get(repo.agentId) || "Unknown Agent") + " · " + (repo.authMethod === "github_app" ? "GitHub App" : "PAT")}
                  {repo.status === "connected" ? " · Tap to create task" : ""}
                </Muted>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <ActionSheet
        visible={showAgentPicker}
        onClose={() => setShowAgentPicker(false)}
        actions={codeFactoryAgents.map((agent) => ({
          label: agent.name,
          onPress: () => {
            setShowAgentPicker(false);
            void startInstallForAgent(agent.id);
          },
        }))}
      />
    </DetailLayout>
  );
}
