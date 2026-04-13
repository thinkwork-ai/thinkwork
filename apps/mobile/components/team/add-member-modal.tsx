import { useState } from "react";
import { View, Modal, Pressable, ScrollView } from "react-native";
import { useAgents } from "@/lib/hooks/use-agents";
import { useTeam, useAddTeamAgent } from "@/lib/hooks/use-teams";
import { useAuth } from "@/lib/auth-context";
import { X, Check } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COLORS } from "@/lib/theme";

interface AddMemberModalProps {
  visible: boolean;
  teamId: string;
  onClose: () => void;
}

export function AddMemberModal({ visible, teamId, onClose }: AddMemberModalProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;

  const [, executeAddTeamAgent] = useAddTeamAgent();
  const [{ data: agentsData }] = useAgents(tenantId);
  const assistants = agentsData?.agents ?? [];
  const [{ data: teamData }] = useTeam(teamId);
  const team = teamData?.team ?? undefined;

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const role = "worker" as const;
  const [humanRole, setHumanRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Filter out already-added members
  const existingMemberIds = new Set(
    (team?.members ?? []).map((m: any) => m.assistantId)
  );
  const availableAgents = (assistants ?? []).filter(
    (a: any) => a.connectionStatus !== "revoked" && !existingMemberIds.has(a.id)
  );

  const handleAdd = async () => {
    if (!selectedAgentId) {
      setError("Please select an agent");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await executeAddTeamAgent({
        teamId,
        agentId: selectedAgentId,
      });
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || "Failed to add member");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setSelectedAgentId(null);
      setHumanRole("");
      setError(null);
      setSuccess(false);
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-white dark:bg-neutral-950">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Add Member
          </Text>
          <Pressable onPress={handleClose} className="p-2" disabled={loading}>
            <X size={24} color="#737373" />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 py-6">
          <View className="gap-6">
            {/* Assistant Picker */}
            <View>
              <Text className="mb-2 text-base font-medium text-neutral-900 dark:text-neutral-100">
                Select Agent
              </Text>
              {availableAgents.length === 0 ? (
                <Muted>No available agents to add.</Muted>
              ) : (
                <View className="gap-2">
                  {availableAgents.map((a: any) => {
                    const isSelected = selectedAgentId === a.id;
                    return (
                      <Pressable
                        key={a.id}
                        onPress={() => setSelectedAgentId(a.id)}
                        className={`flex-row items-center justify-between px-4 py-3 rounded-xl border ${
                          isSelected
                            ? "border-sky-500 bg-sky-50 dark:bg-sky-900/20"
                            : "border-neutral-200 dark:border-neutral-800"
                        }`}
                      >
                        <View className="flex-row items-center gap-2">
                          <Text className="text-neutral-900 dark:text-neutral-100 font-medium">
                            {a.name}
                          </Text>
                          <Badge variant="outline">
                            {a.type === "local" ? "Local" : "Hosted"}
                          </Badge>
                        </View>
                        {isSelected && <Check size={18} color={colors.primary} />}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Human Role */}
            <Input
              label="Human Role (optional)"
              placeholder="e.g. Operations Manager, Sales Rep"
              value={humanRole}
              onChangeText={setHumanRole}
              autoCapitalize="words"
            />

            {error && (
              <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                <Text size="sm" className="text-destructive text-center">
                  {error}
                </Text>
              </View>
            )}

            {success && (
              <View className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-4 py-3">
                <Text size="sm" className="text-green-700 dark:text-green-300 text-center">
                  Member added!
                </Text>
              </View>
            )}

            <Button onPress={handleAdd} loading={loading} size="lg" disabled={success || !selectedAgentId}>
              {success ? "Added!" : "Add Member"}
            </Button>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
