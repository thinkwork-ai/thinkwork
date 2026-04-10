import { useState } from "react";
import { View, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";
import { Text, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { TabHeader } from "@/components/layout/tab-header";
import { FleetAgentCard } from "@/components/fleet/fleet-agent-card";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Plus, Server } from "lucide-react-native";

export default function FleetScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  // TODO: api.agentcoreAdmin.getAgentCoreAssistants — using useAgents with type filter as approximation
  const [{ data: agentsData, fetching: agentsFetching }] = useAgents(tenantId, { type: "fleet" });
  const assistants = agentsData?.agents ?? [];

  // TODO: inboxItems query — no GraphQL hook yet
  const pendingInboxItems: any[] = [];

  if (agentsFetching) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        <TabHeader title="Fleet" />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  const pendingCount = pendingInboxItems?.length ?? 0;

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <TabHeader
        title="Fleet"
        rightElement={
          <Button
            variant="ghost"
            size="icon"
            onPress={() => router.push("/fleet/register")}
          >
            <Plus size={20} color={colors.foreground} />
          </Button>
        }
      />

      <ScrollView className="flex-1 px-4 pt-4">
        {pendingCount > 0 && (
          <Pressable
            className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
            onPress={() => router.push("/fleet/inbox")}
          >
            <Text className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {pendingCount} pending item{pendingCount > 1 ? "s" : ""} — tap to review
            </Text>
          </Pressable>
        )}

        {assistants.length === 0 ? (
          <View className="items-center justify-center py-16">
            <Server size={48} color={colors.mutedForeground} />
            <Text className="mt-4 text-lg font-semibold">No Fleet Agents</Text>
            <Muted className="mt-2 text-center">
              Register an OpenClaw fleet agent to get started with
              multi-tenant enterprise deployment.
            </Muted>
            <Button
              className="mt-6"
              onPress={() => router.push("/fleet/register")}
            >
              <Text className="text-white">Register Fleet Agent</Text>
            </Button>
          </View>
        ) : (
          <View className="gap-3 pb-8">
            {assistants.map((agent) => (
              <FleetAgentCard
                key={agent.id}
                agent={{ ...agent, _id: agent.id } as any}
                onPress={() => router.push(`/fleet/${agent.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
