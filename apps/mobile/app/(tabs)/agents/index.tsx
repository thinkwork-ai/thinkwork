import { View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { useTenant } from '@/lib/hooks/use-tenants';
import { useTeams } from '@/lib/hooks/use-teams';
import { Skeleton } from '@/components/ui/skeleton';
import { TabHeader } from '@/components/layout/tab-header';
import { TeamDetailView } from '@/components/team/team-detail-view';
import { TeamListView } from '@/components/team/team-list-view';

export default function TeamScreen() {
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [{ data: tenantData, fetching: tenantFetching }] = useTenant(tenantId);
  const tenant = tenantData?.tenant;

  const [{ data: teamsData, fetching: teamsFetching }] = useTeams(tenantId);
  const teams = teamsData?.teams ?? [];

  // Loading
  if (tenantFetching || teamsFetching) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950">
        <TabHeader title="Team" />
        <View className="p-4 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </View>
      </View>
    );
  }

  const plan = tenant?.plan || 'pro';
  const canCreateMultipleTeams = plan === 'business' || plan === 'enterprise';

  // Show list view only if Business+ AND actually has multiple teams
  const content =
    canCreateMultipleTeams && teams.length > 1 ? (
      <TeamListView teams={teams} plan={plan} />
    ) : (
      <TeamDetailView
        teamId={(teams[0] ?? null)?.id ?? null}
        canCreateMultipleTeams={canCreateMultipleTeams}
      />
    );

  return content;
}
