import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useAgent } from "@/lib/hooks/use-agents";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { MobileRow } from "@/components/ui/mobile-row";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { COLORS } from "@/lib/theme";
import { User, Users, Check } from "lucide-react-native";

export default function PickUserScreen() {
  const { assistantId, teamId } = useLocalSearchParams<{
    assistantId: string;
    teamId: string;
  }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: teamApi.listHumanMembers, reassignAssistant, assignToTeam not yet available via GraphQL
  const teamMembers: any[] | undefined = undefined;
  const [{ data: agentData }] = useAgent(assistantId ?? '');
  const assistant = agentData?.agent ?? undefined;
  const reassign = async (_args: any) => {};
  const assignTeam = async (_args: any) => {};

  const [assigning, setAssigning] = useState<string | null>(null);
  const [assigningTeam, setAssigningTeam] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmReassign = async (userId: string) => {
    if (!assistantId) return;
    setAssigning(userId);
    setError(null);
    try {
      await reassign({
        assistantId,
        newOwnerId: userId,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setAssigning(null);
    }
  };

  const handlePickUser = (userId: string) => {
    const selectedMember = teamMembers?.find((member: any) => member.userId === userId);
    const memberName = selectedMember?.displayName ?? "Unknown";
    const agentName = (assistant as any)?.name ?? "Agent";

    Alert.alert(
      "Reassign Agent",
      `Assign ${agentName} to ${memberName}? This will update their workspace profile.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Reassign",
          style: "destructive",
          onPress: () => {
            void confirmReassign(userId);
          },
        },
      ]
    );
  };

  const currentOwnerType = (assistant as any)?.ownerType ?? null;
  const currentOwnerId = (assistant as any)?.ownerId ?? null;

  const handlePickTeam = () => {
    if (!assistantId) return;
    const agentName = (assistant as any)?.name ?? "Agent";
    Alert.alert(
      "Assign to Team",
      `Assign ${agentName} as a shared team agent? It will no longer be tied to an individual user.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Assign to Team",
          onPress: async () => {
            setAssigningTeam(true);
            setError(null);
            try {
              await assignTeam({ assistantId });
              router.back();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Something went wrong");
              setAssigningTeam(false);
            }
          },
        },
      ]
    );
  };

  return (
    <DetailLayout title="Assign User">
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerClassName="pb-8"
      >
        <WebContent>
          <View className="px-4 py-3">
            <Muted>
              Select a team member to assign to this agent.
            </Muted>
          </View>

          {error && (
            <View className="mx-4 mb-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
              <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
            </View>
          )}

          {!teamMembers ? (
            <View className="px-4 py-8 items-center">
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <View className="px-4">
              {/* Team Assistant -- first item in the list */}
              {(() => {
                const isTeam = currentOwnerType === "team";
                return (
                  <MobileRow
                    onPress={handlePickTeam}
                    disabled={assigningTeam}
                    isLast={teamMembers.length === 0}
                    line1Left={
                      <>
                        <Users size={16} color={colors.mutedForeground} />
                        <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100 ml-2">
                          Team Agent
                        </Text>
                        {isTeam && (
                          <Badge variant="success">Current</Badge>
                        )}
                      </>
                    }
                    line1Right={
                      assigningTeam ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : isTeam ? (
                        <Check size={18} color="#22c55e" />
                      ) : null
                    }
                    line2Left={
                      <Muted className="text-sm">Shared across all team members</Muted>
                    }
                  />
                );
              })()}
              {teamMembers.map((member: any, index: number) => {
                const isCurrentOwner = member.userId === currentOwnerId;
                const isAssigning = assigning === member.userId;
                return (
                  <MobileRow
                    key={member.id}
                    onPress={() => handlePickUser(member.userId)}
                    disabled={isAssigning}
                    isLast={index === teamMembers.length - 1}
                    line1Left={
                      <>
                        <User size={16} color={colors.mutedForeground} />
                        <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100 ml-2">
                          {member.displayName ?? "Unknown"}
                        </Text>
                        {isCurrentOwner && (
                          <Badge variant="success">Current</Badge>
                        )}
                      </>
                    }
                    line1Right={
                      isAssigning ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : isCurrentOwner ? (
                        <Check size={18} color="#22c55e" />
                      ) : null
                    }
                    line2Left={
                      <Muted className="text-sm">
                        {member.role === "admin" ? "Admin" : "Member"}
                      </Muted>
                    }
                  />
                );
              })}
            </View>
          )}
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
