import { useState, useCallback } from 'react';
import { View, ScrollView, Pressable, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTeam } from '@/lib/hooks/use-teams';
import { useColorScheme } from 'nativewind';
import {
  Hexagon,
  Plus,
  ChevronDown,
  ChevronUp,
  Bot,
  Users,
  DollarSign,
} from 'lucide-react-native';
import { Text, Muted } from '@/components/ui/typography';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MobileRow } from '@/components/ui/mobile-row';
import { TabHeader } from '@/components/layout/tab-header';
import { WebContent } from '@/components/layout/web-content';
import { COLORS } from '@/lib/theme';
import { AddMemberModal } from './add-member-modal';
import { CreateTeamModal } from './create-team-modal';

interface TeamDetailViewProps {
  teamId: string | null;
  embedded?: boolean;
  canCreateMultipleTeams?: boolean;
  scrollEnabled?: boolean;
  viewerRole?: string;
}

function formatCurrency(cents: number | null | undefined): string {
  if (cents == null) return '--';
  return `$${(cents / 100).toFixed(2)}`;
}

function agentTypeLabel(type?: string | null): string {
  switch (type) {
    case 'GATEWAY': return 'Gateway';
    case 'SUPERVISOR': return 'Supervisor';
    default: return 'Agent';
  }
}

function agentStatusVariant(status?: string | null): 'success' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'IDLE': return 'success';
    case 'BUSY': return 'outline';
    case 'ERROR': return 'destructive';
    default: return 'secondary';
  }
}

export function TeamDetailView({
  teamId,
  embedded,
  scrollEnabled = true,
  viewerRole,
}: TeamDetailViewProps) {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === 'dark' ? COLORS.dark : COLORS.light;

  const [{ data: teamData, fetching }] = useTeam(teamId ?? '');
  const team = teamId ? (teamData?.team ?? undefined) : undefined;

  const [refreshing, setRefreshing] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [teamExpanded, setTeamExpanded] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [infoExpanded, setInfoExpanded] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  // No team yet — show empty state with create option
  if (teamId === null) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        {!embedded && <TabHeader title="Team" />}
        <View className="flex-1 items-center justify-center px-6">
          <Hexagon size={48} color={colors.mutedForeground} />
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mt-4">
            No Team Yet
          </Text>
          <Muted className="text-center mt-2 mb-6">
            Create your first team to start orchestrating your agents.
          </Muted>
          <Button onPress={() => setShowCreateTeam(true)}>
            <Plus size={18} color="#ffffff" />
            <Text className="text-white font-medium ml-2">Add New Team</Text>
          </Button>
          <CreateTeamModal visible={showCreateTeam} onClose={() => setShowCreateTeam(false)} />
        </View>
      </View>
    );
  }

  // Loading
  if (fetching && team === undefined) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        {!embedded && <TabHeader title="Team" />}
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!team) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        {!embedded && <TabHeader title="Team" />}
        <View className="flex-1 items-center justify-center">
          <Muted>Team not found.</Muted>
        </View>
      </View>
    );
  }

  const teamAgents = team.agents ?? [];
  const teamUsers = team.users ?? [];

  const effectiveRole = viewerRole ?? 'member';
  const isNonAdmin = effectiveRole !== 'admin' && effectiveRole !== 'owner';

  // Budget totals — agent-level budgets now live in budgetPolicy, not inline fields
  const totalBudget = team.budgetMonthlyCents ?? 0;
  const totalSpend = 0;
  const remaining = Math.max(0, totalBudget - totalSpend);
  const costTitle = `Usage (${formatCurrency(totalSpend)})`;

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      {!embedded && (
        <TabHeader
          title={team.name || 'Team'}
          right={
            isNonAdmin ? undefined : (
              <Pressable
                onPress={() => setShowAddMember(true)}
                className="flex-row items-center gap-1"
              >
                <Plus size={18} color={colors.primary} />
                <Text style={{ color: colors.primary }} className="font-semibold text-base">
                  Add
                </Text>
              </Pressable>
            )
          }
        />
      )}
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-0"
        scrollEnabled={scrollEnabled}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <WebContent>
          {/* Agents Section */}
          <Pressable
            onPress={() => setAgentsExpanded(!agentsExpanded)}
            className="flex-row items-center justify-between px-4 py-3"
          >
            <View className="flex-row items-center gap-2">
              <Bot size={16} color={colors.mutedForeground} />
              <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                Agents ({teamAgents.length})
              </Text>
            </View>
            {agentsExpanded ? (
              <ChevronUp size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={colors.mutedForeground} />
            )}
          </Pressable>

          {agentsExpanded && teamAgents.length === 0 ? (
            <View className="px-4 py-8 items-center">
              <Muted className="text-center mb-4">No agents yet.</Muted>
              {!isNonAdmin && (
                <Button size="sm" onPress={() => setShowAddMember(true)}>
                  <Plus size={16} color="#ffffff" />
                  <Text className="text-white font-medium ml-1 text-sm">Add Agent</Text>
                </Button>
              )}
            </View>
          ) : agentsExpanded ? (
            <View>
              {teamAgents.map((ha, index) => {
                const agent = ha.agent;
                return (
                  <MobileRow
                    key={ha.id}
                    onPress={() => {
                      if (agent?.id) {
                        router.push(`/agents/${agent.id}`);
                      }
                    }}
                    isLast={index === teamAgents.length - 1}
                    line1Left={
                      <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                        {agent?.name ?? 'Unknown'}
                      </Text>
                    }
                    line1Right={
                      <View className="flex-row items-center gap-2">
                        <Badge variant={agentStatusVariant(agent?.status)}>
                          {agent?.status ?? 'OFFLINE'}
                        </Badge>
                        <Badge variant="success">
                          {agentTypeLabel(agent?.type)}
                        </Badge>
                      </View>
                    }
                    line2Left={
                      <Muted className="text-sm" numberOfLines={1}>
                        {ha.role || 'member'}
                      </Muted>
                    }
                    line2Right={undefined}
                  />
                );
              })}
            </View>
          ) : null}

          {/* Team Members Section */}
          <Pressable
            onPress={() => setTeamExpanded(!teamExpanded)}
            className="flex-row items-center justify-between px-4 py-3 border-t border-neutral-200 dark:border-neutral-800"
          >
            <View className="flex-row items-center gap-2">
              <Users size={16} color={colors.mutedForeground} />
              <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                Team Members ({teamUsers.length})
              </Text>
            </View>
            {teamExpanded ? (
              <ChevronUp size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={colors.mutedForeground} />
            )}
          </Pressable>

          {teamExpanded && teamUsers.length === 0 ? (
            <View className="px-4 py-8 items-center">
              <Muted className="text-center">
                No team members yet. Use the + button to add users.
              </Muted>
            </View>
          ) : teamExpanded ? (
            <View>
              {teamUsers.map((hu, index) => (
                <MobileRow
                  key={hu.id}
                  onPress={() => {
                    if (isNonAdmin) return;
                    router.push(`/team/edit-member?teamId=${teamId}&userId=${hu.userId}`);
                  }}
                  isLast={index === teamUsers.length - 1}
                  line1Left={
                    <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                      {hu.user?.name ?? hu.user?.email ?? 'Unknown'}
                    </Text>
                  }
                  line1Right={
                    <Badge variant={hu.role === 'admin' || hu.role === 'owner' ? 'default' : 'outline'}>
                      {hu.role === 'admin' ? 'Admin' : hu.role === 'owner' ? 'Owner' : 'Member'}
                    </Badge>
                  }
                  line2Left={
                    hu.user?.email ? (
                      <Muted className="text-sm" numberOfLines={1}>{hu.user.email}</Muted>
                    ) : undefined
                  }
                />
              ))}
            </View>
          ) : null}

          {/* Usage Section */}
          <Pressable
            onPress={() => setInfoExpanded(!infoExpanded)}
            className="flex-row items-center justify-between px-4 py-3 border-t border-neutral-200 dark:border-neutral-800"
          >
            <View className="flex-row items-center gap-2">
              <DollarSign size={16} color={colors.mutedForeground} />
              <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                {costTitle}
              </Text>
            </View>
            {infoExpanded ? (
              <ChevronUp size={18} color={colors.mutedForeground} />
            ) : (
              <ChevronDown size={18} color={colors.mutedForeground} />
            )}
          </Pressable>

          {infoExpanded && (
            <View className="px-4 pt-2 pb-4 gap-3 bg-neutral-50 dark:bg-neutral-900">
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Muted className="text-xs mb-0.5">Team Budget</Muted>
                  <Text className="text-base font-semibold">{formatCurrency(totalBudget)}</Text>
                </View>
                <View className="flex-1">
                  <Muted className="text-xs mb-0.5">Team Spend</Muted>
                  <Text className="text-base font-semibold">{formatCurrency(totalSpend)}</Text>
                </View>
                <View className="flex-1">
                  <Muted className="text-xs mb-0.5">Remaining</Muted>
                  <Text className="text-base font-semibold">{formatCurrency(remaining)}</Text>
                </View>
              </View>
            </View>
          )}
        </WebContent>
      </ScrollView>

      {!isNonAdmin && (
        <AddMemberModal
          visible={showAddMember}
          teamId={teamId}
          onClose={() => setShowAddMember(false)}
        />
      )}
    </View>
  );
}
