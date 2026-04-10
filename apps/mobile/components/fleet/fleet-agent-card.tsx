import { View, Pressable } from "react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Server } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

interface FleetAgentCardProps {
  agent: {
    id: string;
    name: string;
    runtimeStatus?: string;
    stackName?: string;
    permissionProfile?: string;
    model?: string;
    connectionStatus?: string;
  };
  onPress: () => void;
}

export function FleetAgentCard({
  agent,
  onPress,
}: FleetAgentCardProps) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const status = agent.runtimeStatus || "unknown";
  const statusDotColor =
    status === "active"
      ? "bg-green-500"
      : status === "error"
        ? "bg-red-500"
        : status === "deploying"
          ? "bg-amber-500"
          : "bg-neutral-400";

  return (
    <Pressable
      className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      onPress={onPress}
    >
      <View className="flex-row items-center">
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
          <Server size={20} color={colors.mutedForeground} />
        </View>
        <View className="flex-1">
          <Text className="font-semibold">{agent.name}</Text>
          <View className="mt-1 flex-row items-center gap-2">
            <View className={`h-2 w-2 rounded-full ${statusDotColor}`} />
            <Muted className="text-xs capitalize">{status}</Muted>
            {agent.stackName && (
              <Muted className="text-xs">
                | {agent.stackName}
              </Muted>
            )}
          </View>
        </View>
        <View className="items-end">
          <Text className="text-xs text-neutral-500">
            {agent.permissionProfile || "basic"}
          </Text>
          {agent.model && (
            <Muted className="mt-1 text-xs">
              {agent.model.split(".").pop()?.split(":")[0] || agent.model}
            </Muted>
          )}
        </View>
      </View>
    </Pressable>
  );
}
