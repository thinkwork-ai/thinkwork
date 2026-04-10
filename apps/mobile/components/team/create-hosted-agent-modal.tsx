import { useState } from "react";
import { View, Modal, Pressable, ScrollView } from "react-native";
import { useCreateAgent } from "@/lib/hooks/use-agents";
import { X, Server } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

interface CreateHostedAgentModalProps {
  visible: boolean;
  onClose: () => void;
  runtimeProfile?: "standard" | "code_factory" | "chat" | "code";
}

export function CreateHostedAgentModal({ visible, onClose, runtimeProfile: initialProfile = "standard" }: CreateHostedAgentModalProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [, executeCreateAgent] = useCreateAgent();
  const [name, setName] = useState("");
  const [runtimeProfile, setRuntimeProfile] = useState(initialProfile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Please enter a name for the agent");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await executeCreateAgent({ name: name.trim(), runtimeProfile });
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err: any) {
      setError(err.message || "Failed to create agent");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setName("");
      setRuntimeProfile(initialProfile);
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
            {runtimeProfile === "code_factory" ? "New Code Factory" : runtimeProfile === "chat" ? "New Chat Agent" : runtimeProfile === "code" ? "New Code Agent" : "New Hosted Agent"}
          </Text>
          <Pressable onPress={handleClose} className="p-2" disabled={loading}>
            <X size={24} color="#737373" />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 py-6">
          <View className="gap-6">
            <View className="flex-row items-center gap-3">
              <Server size={20} color={colors.mutedForeground} />
              <Muted className="text-sm leading-5 flex-1">
                {runtimeProfile === "code_factory"
                  ? "Create a Code Factory agent with autonomous multi-agent coding workflow controls."
                  : runtimeProfile === "chat"
                  ? "Create a chat agent powered by AgentCore Runtime with Firecracker isolation. Ready instantly."
                  : runtimeProfile === "code"
                  ? "Create a code agent with GitHub CLI, D2, Claude Code, and development tools. Ready instantly."
                  : "Create a cloud-hosted agent powered by Thinkwork infrastructure. It will be ready in about 2 minutes."}
              </Muted>
            </View>

            {initialProfile === "standard" && (
              <View className="gap-2">
                <Text size="sm" weight="medium" className="text-neutral-700 dark:text-neutral-300">Runtime</Text>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => setRuntimeProfile("standard")}
                    className={`flex-1 rounded-lg border px-3 py-2.5 ${
                      runtimeProfile === "standard"
                        ? "border-primary bg-primary/10"
                        : "border-neutral-200 dark:border-neutral-700"
                    }`}
                  >
                    <Text size="sm" weight="medium" className={runtimeProfile === "standard" ? "text-primary" : ""}>
                      Cloud (ECS)
                    </Text>
                    <Text size="xs" variant="muted">Dedicated container</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setRuntimeProfile("chat")}
                    className={`flex-1 rounded-lg border px-3 py-2.5 ${
                      runtimeProfile === "chat"
                        ? "border-primary bg-primary/10"
                        : "border-neutral-200 dark:border-neutral-700"
                    }`}
                  >
                    <Text size="sm" weight="medium" className={runtimeProfile === "chat" ? "text-primary" : ""}>
                      Chat (AgentCore)
                    </Text>
                    <Text size="xs" variant="muted">Multi-tenant, isolated</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <Input
              label="Agent Name"
              placeholder={runtimeProfile === "code_factory" ? "e.g. Platform Code Factory" : "e.g. Operations, Research, Support"}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoFocus
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
                  Agent is being provisioned... It will appear in your list shortly.
                </Text>
              </View>
            )}

            <Button onPress={handleCreate} loading={loading} size="lg" disabled={success || !name.trim()}>
              {success ? "Provisioning..." : runtimeProfile === "code_factory" ? "Create Code Factory" : runtimeProfile === "chat" ? "Create Chat Agent" : runtimeProfile === "code" ? "Create Code Agent" : "Create Agent"}
            </Button>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
