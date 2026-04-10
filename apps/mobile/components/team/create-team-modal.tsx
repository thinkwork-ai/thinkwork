import { useState } from "react";
import { View, Modal, Pressable, ScrollView } from "react-native";
import { useAgents } from "@/lib/hooks/use-agents";
import { useCreateTeam } from "@/lib/hooks/use-teams";
import { useAuth } from "@/lib/auth-context";
import { X } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CreateTeamModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CreateTeamModal({ visible, onClose }: CreateTeamModalProps) {
  const { user } = useAuth();
  const tenantId = (user as any)?.tenantId;
  const [, executeCreateTeam] = useCreateTeam();
  const [{ data: agentsData }] = useAgents(tenantId);
  const assistants = agentsData?.agents ?? [];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Pick first available agent as lead
  const availableAgents = (assistants ?? []).filter(
    (a: any) => a.connectionStatus !== "revoked"
  );

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Please enter a team name");
      return;
    }
    if (!availableAgents.length) {
      setError("No agents available to be lead");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await executeCreateTeam({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || "Failed to create team");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setName("");
      setDescription("");
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
            Add New Team
          </Text>
          <Pressable onPress={handleClose} className="p-2" disabled={loading}>
            <X size={24} color="#737373" />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 py-6">
          <View className="gap-6">
            <Muted className="text-sm leading-5">
              A team is a team of agents that can communicate and route queries to each other.
            </Muted>

            <Input
              label="Team Name"
              placeholder="e.g. Operations, Sales, Engineering"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoFocus
            />

            <Input
              label="Description (optional)"
              placeholder="What does this team handle?"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              style={{ height: 80, textAlignVertical: "top" }}
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
                  Team created!
                </Text>
              </View>
            )}

            <Button onPress={handleCreate} loading={loading} size="lg" disabled={success}>
              {success ? "Created!" : "Add New Team"}
            </Button>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
