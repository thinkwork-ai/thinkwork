import { useState, useCallback } from 'react';
import { View, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from 'nativewind';
import { Hexagon, Plus, Crown } from 'lucide-react-native';
import { Text, Muted } from '@/components/ui/typography';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MobileRow } from '@/components/ui/mobile-row';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { TabHeader } from '@/components/layout/tab-header';
import { WebContent } from '@/components/layout/web-content';
import { COLORS } from '@/lib/theme';
import { CreateTeamModal } from './create-team-modal';

interface Team {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  orchestratorId?: string;
}

interface TeamListViewProps {
  teams: Team[];
  plan: string;
}

export function TeamListView({ teams, plan }: TeamListViewProps) {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === 'dark' ? COLORS.dark : COLORS.light;
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <TabHeader
        title="Team"
        right={
          <Pressable onPress={() => setShowCreate(true)} className="flex-row items-center gap-1">
            <Plus size={18} color={colors.primary} />
            <Text style={{ color: colors.primary }} className="font-semibold text-base">
              Create
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-8"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <WebContent>
          {/* Colony Orchestrator Status Card */}
          {plan === 'enterprise' && (
            <View className="px-4 pt-4">
              <Card size="sm">
                <CardHeader>
                  <CardTitle>
                    <View className="flex-row items-center gap-2">
                      <Crown size={18} color={colors.primary} />
                      <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                        Colony Orchestrator
                      </Text>
                    </View>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Muted>
                    Cross-team routing is active. The Colony Orchestrator manages queries across all
                    teams.
                  </Muted>
                </CardContent>
              </Card>
            </View>
          )}

          {/* Team List */}
          {teams.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6 py-12">
              <Hexagon size={48} color={colors.mutedForeground} />
              <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mt-4">
                No Teams Yet
              </Text>
              <Muted className="text-center mt-2 mb-6">
                Create your first team to organize your team's agents.
              </Muted>
              <Button onPress={() => setShowCreate(true)}>
                <Plus size={18} color="#ffffff" />
                <Text className="text-white font-medium ml-2">Add New Team</Text>
              </Button>
            </View>
          ) : (
            <View className="mt-2">
              {teams.map((team, index) => (
                <MobileRow
                  key={team.id}
                  onPress={() => router.push(`/team/${team.id}`)}
                  isLast={index === teams.length - 1}
                  line1Left={
                    <>
                      <Hexagon size={16} color={colors.primary} />
                      <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                        {team.name}
                      </Text>
                    </>
                  }
                  line1Right={
                    <Badge variant="secondary">
                      {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
                    </Badge>
                  }
                  line2Left={
                    team.description ? (
                      <Muted className="text-sm" numberOfLines={1}>
                        {team.description}
                      </Muted>
                    ) : undefined
                  }
                />
              ))}
            </View>
          )}
        </WebContent>
      </ScrollView>

      <CreateTeamModal visible={showCreate} onClose={() => setShowCreate(false)} />
    </View>
  );
}
