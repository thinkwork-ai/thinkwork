import { View, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useAgent } from "@/lib/hooks/use-agents";
import { Text, Muted } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Shield, FileText, CheckCircle, ChevronRight } from "lucide-react-native";

export default function FleetAgentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data: agentData, fetching }] = useAgent(id);
  const assistant = agentData?.agent;

  if (fetching) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!assistant) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
        <Text>AgentCore agent not found</Text>
      </View>
    );
  }

  const statusColor =
    assistant.status === "active"
      ? "text-green-600 dark:text-green-400"
      : assistant.status === "error"
        ? "text-red-600 dark:text-red-400"
        : "text-amber-600 dark:text-amber-400";

  const navItems = [
    {
      label: "Permissions",
      icon: Shield,
      path: `/fleet/${id}/permissions`,
    },
    {
      label: "Audit Log",
      icon: FileText,
      path: `/fleet/${id}/audit`,
    },
    {
      label: "Inbox",
      icon: CheckCircle,
      path: `/fleet/${id}/inbox`,
    },
  ];

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <Stack.Screen options={{ title: assistant.name }} />

      <ScrollView className="flex-1 px-4 pt-4">
        {/* Header card */}
        <View className="mb-6 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <Text className="text-xl font-bold">{assistant.name}</Text>
          <Muted className="mt-1">Stack: {(assistant as any).stackName || "\u2014"}</Muted>
          <View className="mt-3 flex-row items-center gap-3">
            <View className="rounded-full bg-neutral-200 px-3 py-1 dark:bg-neutral-800">
              <Text className="text-xs font-medium">agentcore</Text>
            </View>
            <Text className={`text-sm font-medium capitalize ${statusColor}`}>
              {assistant.status || "unknown"}
            </Text>
          </View>
          {(assistant as any).permissionProfile && (
            <Muted className="mt-2">
              Permission profile: {(assistant as any).permissionProfile}
            </Muted>
          )}
          {assistant.model && (
            <Muted className="mt-1">Model: {assistant.model}</Muted>
          )}
        </View>

        {/* Navigation */}
        <View className="gap-2 pb-8">
          {navItems.map((item) => (
            <Pressable
              key={item.label}
              className="flex-row items-center rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              onPress={() => router.push(item.path as any)}
            >
              <item.icon size={20} color={colors.mutedForeground} />
              <Text className="ml-3 flex-1 font-medium">{item.label}</Text>
              <ChevronRight size={18} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
