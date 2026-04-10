import { useState } from "react";
import { View, ScrollView, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks/use-tenants";
import { useTeams, useTeam } from "@/lib/hooks/use-teams";
import { Text, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { TabHeader } from "@/components/layout/tab-header";
import { TeamDetailView } from "@/components/team/team-detail-view";
import { TeamListView } from "@/components/team/team-list-view";
import { AgentDetailContent } from "@/components/agents/agent-detail";
import { CreateTeamModal } from "@/components/team/create-team-modal";

import { CreateHostedAgentModal } from "@/components/team/create-hosted-agent-modal";

import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { Bot, Hexagon, Plus, Users } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { useMediaQuery } from "@/lib/hooks/use-media-query";

export default function TeamScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { isWide } = useMediaQuery();
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [{ data: tenantData }] = useTenant(tenantId);
  const tenant = tenantData?.tenant;

  const [{ data: teamsData, fetching: teamsFetching }] = useTeams(tenantId);
  const teams = teamsData?.teams ?? [];

  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [showHostedAgent, setShowHostedAgent] = useState(false);


  const plan = tenant?.plan || "pro";
  const isMultiTeam = plan === "business" || plan === "enterprise";
  const firstTeam = teams?.[0];

  // Check team composition
  const [{ data: firstTeamData }] = useTeam(firstTeam?.id);
  const firstTeamDetail = firstTeamData?.team;

  // TODO: api.teamApi.listHumanMembers — using team.users from useTeam as approximation
  const teamMembers = firstTeamDetail?.users ?? [];
  const agentCount = firstTeamDetail?.agents?.length ?? 0;
  const humanCount = teamMembers?.length ?? 0;
  const myRole = (firstTeamDetail as any)?.myRole as string | undefined;
  const isNonAdmin = myRole !== "admin" && myRole !== "owner";
  const isSimpleTeam = agentCount <= 1 && humanCount <= 1;
  const firstAgentId = firstTeamDetail?.agents?.[0]?.agentId;
  const memberRows = (firstTeamDetail?.agents ?? []) as any[];
  const openableAgents = memberRows.filter((m) => m?.assistant?.capabilities?.canOpenDetail);
  const teamOnlyAgents = memberRows.filter(
    (m) => m?.assistant?.ownerType !== "user" && !m?.assistant?.capabilities?.canEdit,
  );

  // Loading: keep header stable, show centered spinner in content only
  if (teamsFetching) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        <TabHeader title="Team" />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  const addButton = (
    <HeaderContextMenu
      items={[
        {
          label: "Add Agent",
          icon: Bot,
          onPress: () => setShowHostedAgent(true),
        },
        {
          label: "Invite User",
          icon: Users,
          onPress: () => firstTeam && router.push(`/team/add-users?teamId=${firstTeam.id}`),
        },
        ...(isMultiTeam
          ? [
              {
                label: "Create New Team",
                icon: Hexagon,
                onPress: () => setShowCreateTeam(true),
              },
            ]
          : []),
      ]}
    />
  );

  const modals = (
    <>
      <CreateTeamModal
        visible={showCreateTeam}
        onClose={() => setShowCreateTeam(false)}
      />
      <CreateHostedAgentModal
        visible={showHostedAgent}
        onClose={() => setShowHostedAgent(false)}
      />
    </>
  );

  // No teams yet — empty state
  if (teams.length === 0) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        <TabHeader title="Team" />
        <View className="py-12 items-center px-4">
          <Hexagon size={48} color={colors.mutedForeground} />
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mt-4">
            Set Up Your Team
          </Text>
          <Muted className="text-center mt-2 mb-6">
            Create a team to enable orchestration between your agents.
          </Muted>
          <Button onPress={() => setShowCreateTeam(true)}>
            <Plus size={18} color="#ffffff" />
            <Text className="text-white font-medium ml-2">Add New Team</Text>
          </Button>
          {modals}
        </View>
      </View>
    );
  }

  // Non-owner with exactly one editable assistant and no additional team assistants → jump to detail
  if (teams.length === 1 && isNonAdmin && openableAgents.length === 1 && teamOnlyAgents.length === 0) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        <TabHeader title="Team" right={undefined} />
        <View className="pt-4" style={{ flex: 1 }}>
          <AgentDetailContent gatewayId={openableAgents[0].assistant?.id ?? openableAgents[0].assistant?._id} />
        </View>
      </View>
    );
  }

  // Single team with simple composition — show agent detail directly (owner/admin)
  if (teams.length === 1 && !isNonAdmin && isSimpleTeam && firstAgentId) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        <TabHeader title="Team" right={addButton} />
        <View className="pt-4" style={{ flex: 1 }}>
          <AgentDetailContent gatewayId={firstAgentId} />
        </View>
        {modals}
      </View>
    );
  }

  // Single team with multiple members — full team detail
  if (teams.length === 1) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        <TabHeader title={firstTeam!.name || "Team"} right={isNonAdmin ? undefined : addButton} />
        {isWide ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 12 }}>
            <View style={{ width: "100%", maxWidth: Platform.OS === "web" ? 768 : 720, borderWidth: 1, borderColor: colorScheme === "dark" ? "#262626" : "#e5e5e5", borderRadius: 12, overflow: "hidden" }}>
              <TeamDetailView teamId={firstTeam!.id} embedded scrollEnabled={false} viewerRole={myRole} />
            </View>
          </ScrollView>
        ) : (
          <TeamDetailView teamId={firstTeam!.id} embedded viewerRole={myRole} />
        )}
        {modals}
      </View>
    );
  }

  // Multiple teams — list view
  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <TabHeader title="Teams" right={isNonAdmin ? undefined : addButton} />
      {isWide ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 12, alignItems: Platform.OS === "web" ? "flex-start" : "center" }}>
          <View style={{ width: "100%", maxWidth: Platform.OS === "web" ? 768 : 720, borderWidth: 1, borderColor: colorScheme === "dark" ? "#262626" : "#e5e5e5", borderRadius: 12, overflow: "hidden" }}>
            <TeamListView teams={teams as any[]} plan={plan} />
          </View>
        </ScrollView>
      ) : (
        <View className="flex-1">
          <TeamListView teams={teams as any[]} plan={plan} />
        </View>
      )}
      {modals}
    </View>
  );
}
