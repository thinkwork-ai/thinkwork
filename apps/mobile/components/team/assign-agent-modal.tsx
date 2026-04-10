import { useState } from "react";
import { View, Modal, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useColorScheme } from "nativewind";
import { useTeam } from "@/lib/hooks/use-teams";
import { X, Bot, Check, CircleMinus } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { COLORS } from "@/lib/theme";

interface AssignAgentModalProps {
  visible: boolean;
  teamId: string;
  userId: string;
  userName: string;
  currentAgentId?: string | null;
  onClose: () => void;
}

export function AssignAgentModal({
  visible,
  teamId,
  userId,
  userName,
  currentAgentId,
  onClose,
}: AssignAgentModalProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data: teamData }] = useTeam(visible ? teamId : '');
  const team = visible ? (teamData?.team ?? undefined) : undefined;
  // TODO: teamApi.listHumanMembers, assignAssistant, unassignAssistant not yet available via GraphQL
  const teamMembers: any[] | undefined = undefined;
  const assignAgent = async (_args: any) => {};
  const unassignAgent = async (_args: any) => {};

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const members = team?.members ?? [];

  // Build a map of agentId -> assigned userName
  const assignmentMap = new Map<string, string>();
  if (teamMembers) {
    for (const tm of teamMembers) {
      if (tm.assignedAgentId) {
        assignmentMap.set(tm.assignedAgentId, tm.displayName ?? "Someone");
      }
    }
  }

  const handleAssign = async (agentId: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await assignAgent({ teamId, userId, agentId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnassign = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await unassignAgent({ teamId, userId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-center items-center bg-black/60 px-6">
        <View
          className="w-full max-w-sm rounded-xl border"
          style={{ backgroundColor: colors.card, borderColor: colors.border, maxHeight: "80%" }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
            <View className="flex-1">
              <Text className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
                Assign Agent
              </Text>
              <Muted className="text-sm mt-0.5">for {userName}</Muted>
            </View>
            <Pressable onPress={onClose} className="p-2">
              <X size={20} color={colors.foreground} />
            </Pressable>
          </View>

          <ScrollView className="px-4 py-3" style={{ maxHeight: 400 }}>
            {/* Current assignment with unassign option */}
            {currentAgentId && (
              <View className="mb-4">
                <Pressable
                  onPress={handleUnassign}
                  disabled={submitting}
                  className="flex-row items-center justify-between py-3 px-3 rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20"
                >
                  <View className="flex-row items-center gap-2 flex-1">
                    <CircleMinus size={18} color="#ea580c" />
                    <Text className="text-sm font-medium text-orange-700 dark:text-orange-300">
                      Unassign current agent
                    </Text>
                  </View>
                  {submitting && <ActivityIndicator size="small" color="#ea580c" />}
                </Pressable>
              </View>
            )}

            {/* Agent list */}
            {members.length === 0 ? (
              <View className="py-8 items-center">
                <Muted>No agents in this team yet.</Muted>
              </View>
            ) : (
              <View className="gap-2">
                {members.map((member: any) => {
                  const agentId = member.agent?.id;
                  const isCurrentlyAssigned = agentId === currentAgentId;
                  const assignedTo = agentId ? assignmentMap.get(agentId) : null;
                  const isAvailable = !assignedTo || isCurrentlyAssigned;

                  return (
                    <Pressable
                      key={member.id}
                      onPress={() => {
                        if (isAvailable && agentId && !isCurrentlyAssigned) {
                          handleAssign(agentId);
                        }
                      }}
                      disabled={!isAvailable || isCurrentlyAssigned || submitting}
                      className={`flex-row items-center justify-between py-3 px-3 rounded-lg border ${
                        isCurrentlyAssigned
                          ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
                          : isAvailable
                            ? "border-neutral-200 dark:border-neutral-800 active:bg-neutral-50 dark:active:bg-neutral-800"
                            : "border-neutral-100 dark:border-neutral-900 opacity-50"
                      }`}
                    >
                      <View className="flex-row items-center gap-2 flex-1">
                        <Bot size={18} color={isCurrentlyAssigned ? "#16a34a" : colors.mutedForeground} />
                        <View className="flex-1">
                          <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {member.agent?.name ?? "Unknown"}
                          </Text>
                          <Muted className="text-xs">
                            {isCurrentlyAssigned
                              ? "Currently assigned"
                              : assignedTo
                                ? `Assigned to ${assignedTo}`
                                : "Available"}
                          </Muted>
                        </View>
                      </View>
                      <View className="flex-row items-center gap-2">
                        <StatusBadge
                          status={member.agent?.connectionStatus === "online" ? "online" : "offline"}
                        />
                        {isCurrentlyAssigned && <Check size={16} color="#16a34a" />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {error && (
              <View className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2">
                <Text className="text-xs text-red-600 dark:text-red-400">{error}</Text>
              </View>
            )}
          </ScrollView>

          <View className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800">
            <Pressable onPress={onClose} className="items-center py-2">
              <Text className="font-medium text-neutral-500 dark:text-neutral-400">Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
