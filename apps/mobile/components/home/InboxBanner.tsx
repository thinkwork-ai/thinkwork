import { View, Pressable } from "react-native";
import { Inbox } from "lucide-react-native";
import { Text } from "@/components/ui/typography";

interface InboxBannerProps {
  count: number;
  onPress: () => void;
}

export function InboxBanner({ count, onPress }: InboxBannerProps) {
  if (count <= 0) return null;

  return (
    <Pressable
      onPress={onPress}
      className="mx-4 mt-3 flex-row items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 active:opacity-70"
    >
      <Inbox size={20} color="#f59e0b" />
      <Text className="text-sm font-medium text-amber-600 dark:text-amber-400 flex-1">
        {count} {count === 1 ? "item needs" : "items need"} your attention
      </Text>
      <View className="bg-amber-500 rounded-full px-2 py-0.5 min-w-[22px] items-center">
        <Text className="text-xs font-bold text-white">{count}</Text>
      </View>
    </Pressable>
  );
}
