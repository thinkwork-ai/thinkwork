import { View } from "react-native";
import { BookOpenText } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { Muted, Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

export function WikiSegmentPlaceholder() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
      <BookOpenText size={34} color={colors.mutedForeground} />
      <Text className="text-base font-semibold">Wiki</Text>
      <Muted className="text-center">Coming soon</Muted>
    </View>
  );
}
