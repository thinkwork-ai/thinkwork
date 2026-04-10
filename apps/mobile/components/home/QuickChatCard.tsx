import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { MessageCircle, ChevronDown } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { AgentPicker } from "@/components/chat/AgentPicker";

interface QuickChatCardProps {
  agents: Array<{ _id: string; id?: string; name: string; role?: string; connectionStatus?: string }>;
  selectedAgent: { _id: string; id?: string; name: string } | null;
  onSelectAgent: (agent: any) => void;
  onPress: () => void;
}

export function QuickChatCard({ agents, selectedAgent, onSelectAgent, onPress }: QuickChatCardProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  return (
    <View className="mx-4 mt-4">
      <View className="flex-row items-center gap-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl px-4 py-3">
        {/* Agent avatar / picker */}
        {agents.length > 1 ? (
          <AgentPicker
            agents={agents}
            selectedId={selectedAgent?._id ?? ""}
            onSelect={onSelectAgent}
          >
            <View className="flex-row items-center gap-1">
              <View className="w-8 h-8 rounded-full bg-primary/20 items-center justify-center">
                <Text className="text-primary text-sm font-semibold">
                  {(selectedAgent?.name ?? "A").charAt(0).toUpperCase()}
                </Text>
              </View>
              <ChevronDown size={14} color={colors.mutedForeground} />
            </View>
          </AgentPicker>
        ) : (
          <View className="w-8 h-8 rounded-full bg-primary/20 items-center justify-center">
            <Text className="text-primary text-sm font-semibold">
              {(selectedAgent?.name ?? "A").charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Input trigger */}
        <Pressable onPress={onPress} className="flex-1 active:opacity-70">
          <Muted className="text-sm">Ask {selectedAgent?.name ?? "your agent"} anything...</Muted>
        </Pressable>

        <MessageCircle size={20} color={colors.primary} />
      </View>
    </View>
  );
}
