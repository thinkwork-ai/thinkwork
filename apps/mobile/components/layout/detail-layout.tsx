import { View, Pressable } from "react-native";
import { useRef } from "react";
import { useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { Sidebar } from "./sidebar";
import { COLORS } from "@/lib/theme";
import { Text } from "@/components/ui/typography";

interface DetailLayoutProps {
  title: React.ReactNode;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  showSidebar?: boolean;
  /** If provided, tapping the title area calls this instead of router.back() */
  onTitlePress?: (anchor: { x: number; y: number; width: number; height: number }) => void;
}

export function DetailLayout({ title, children, headerRight, showSidebar = true, onTitlePress }: DetailLayoutProps) {
  const router = useRouter();
  const { isWide } = useMediaQuery();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const titleRef = useRef<View>(null);

  // Header row (back button + title + optional right element)
  // NOTE: This is a JSX variable, not an inline component, to avoid
  // unmount/remount cycles that cause "state update before mount" errors.
  const headerContent = (
    <View
      className="h-14 flex-row items-center px-4 border-b border-neutral-200 dark:border-neutral-800"
      style={{ backgroundColor: colors.background }}
    >
      <Pressable onPress={() => router.back()} className="py-2 -ml-2 pr-2" hitSlop={8}>
        <ChevronLeft size={24} color={colors.foreground} />
      </Pressable>

      <Pressable
        ref={titleRef}
        onPress={() => {
          if (!onTitlePress) {
            router.back();
            return;
          }
          titleRef.current?.measureInWindow((x, y, width, height) => {
            onTitlePress({ x, y, width, height });
          });
        }}
        className="flex-1 min-w-0 mr-2 py-2"
        hitSlop={8}
      >
        {typeof title === "string" ? (
          <Text className="text-lg font-semibold" numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
      </Pressable>

      <View className="shrink-0">{headerRight}</View>
    </View>
  );

  // Wide screens: sidebar + content (no safe area needed - handled by sidebar)
  if (isWide && showSidebar) {
    return (
      <View className="flex-1 flex-row bg-white dark:bg-neutral-950">
        <Sidebar />
        <View className="flex-1">
          {headerContent}
          {children}
        </View>
      </View>
    );
  }

  // Narrow screens: SafeAreaView for top/bottom
  return (
    <SafeAreaView 
      className="flex-1 bg-white dark:bg-neutral-950" 
      edges={["top", "bottom"]}
      style={{ backgroundColor: colors.background }}
    >
      {headerContent}
      {children}
    </SafeAreaView>
  );
}
