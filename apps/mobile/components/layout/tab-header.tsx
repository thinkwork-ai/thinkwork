import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { COLORS } from "@/lib/theme";
import { Text } from "@/components/ui/typography";

interface TabHeaderProps {
  title: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function TabHeader({ title, left, right }: TabHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const { isWide } = useMediaQuery();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  return (
    <View
      style={isWide ? undefined : { paddingTop: insets.top }}
      className="bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800"
    >
      <View
        className="flex-row items-center justify-between px-4"
        style={isWide ? { height: 55 } : { paddingVertical: 6 }}
      >
        <View className="flex-row items-center gap-1">
          {left}
          <Text size={isWide ? "lg" : "xl"} weight={isWide ? "semibold" : "bold"}>{title}</Text>
        </View>
        {right}
      </View>
    </View>
  );
}
