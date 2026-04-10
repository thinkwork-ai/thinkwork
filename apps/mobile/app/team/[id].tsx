import { View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useTeam } from "@/lib/hooks/use-teams";
import { Skeleton } from "@/components/ui/skeleton";
import { Muted } from "@/components/ui/typography";
import { ChevronLeft } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { TeamDetailView } from "@/components/team/team-detail-view";

export default function TeamDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const teamId = id as string;
  const [teamResult] = useTeam(teamId);
  const team = teamResult.data?.team ?? undefined;

  if (team === undefined && teamResult.fetching) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950 p-4">
        <Stack.Screen options={{ title: "Team" }} />
        <View className="gap-3">
          <Skeleton className="h-8 w-48 rounded-md" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </View>
      </View>
    );
  }

  if (!team) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950 items-center justify-center">
        <Stack.Screen options={{ title: "Team" }} />
        <Muted>Team not found</Muted>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <Stack.Screen
        options={{
          title: team.name,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} className="p-2 mr-2">
              <ChevronLeft size={24} color={colors.foreground} />
            </Pressable>
          ),
        }}
      />
      <TeamDetailView teamId={teamId} embedded />
    </View>
  );
}
