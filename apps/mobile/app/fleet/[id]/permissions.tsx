import { useState } from "react";
import { View, ScrollView, ActivityIndicator, Switch } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { Text, Muted } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { useAgent } from "@/lib/hooks/use-agents";

const ALL_TOOLS = [
  { name: "web_search", label: "Web Search", risk: "low" },
  { name: "shell", label: "Shell", risk: "high" },
  { name: "browser", label: "Browser", risk: "medium" },
  { name: "file", label: "File Read", risk: "low" },
  { name: "file_write", label: "File Write", risk: "medium" },
  { name: "code_execution", label: "Code Execution", risk: "medium" },
] as const;

const ALWAYS_BLOCKED = ["install_skill", "load_extension", "eval"];

export default function FleetPermissionsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [agentResult] = useAgent(id);
  const agent = agentResult.data?.agent ?? undefined;

  // Permission profile is managed via SSM through the agentcore-admin Lambda.
  // For now, show the profile name and a static tool list for reference.
  const profileName = (agent as any)?.permissionProfile || "basic";

  if (agent === undefined && agentResult.fetching) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const riskColors = {
    low: "text-green-600 dark:text-green-400",
    medium: "text-amber-600 dark:text-amber-400",
    high: "text-red-600 dark:text-red-400",
  };

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <Stack.Screen options={{ title: "Permissions" }} />

      <ScrollView className="flex-1 px-4 pt-4">
        <View className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <Text className="text-lg font-semibold">Profile: {profileName}</Text>
          <Muted className="mt-1">
            Permission profiles are stored in AWS SSM Parameter Store and
            enforced at runtime via Plan A (system prompt) and Plan E (audit).
          </Muted>
        </View>

        <Text className="mb-3 text-base font-semibold">Available Tools</Text>
        <View className="gap-2 pb-4">
          {ALL_TOOLS.map((tool) => (
            <View
              key={tool.name}
              className="flex-row items-center justify-between rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <View>
                <Text className="font-medium">{tool.label}</Text>
                <Text className={`text-xs ${riskColors[tool.risk]}`}>
                  {tool.risk} risk
                </Text>
              </View>
              <Muted className="text-xs">{tool.name}</Muted>
            </View>
          ))}
        </View>

        <Text className="mb-3 text-base font-semibold">Always Blocked</Text>
        <View className="gap-2 pb-8">
          {ALWAYS_BLOCKED.map((tool) => (
            <View
              key={tool}
              className="flex-row items-center rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950"
            >
              <Text className="font-medium text-red-700 dark:text-red-400">
                {tool}
              </Text>
              <Muted className="ml-auto text-xs">blocked (security)</Muted>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
