import { View } from "react-native";
import { Slot } from "expo-router";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { Sidebar } from "./sidebar";

interface ResponsiveLayoutProps {
  children?: React.ReactNode;
}

/**
 * Responsive layout that shows:
 * - Sidebar on wide screens (>= 768px)
 * - Just content (with tab bar handled by tabs layout) on narrow screens
 */
export function ResponsiveLayout({ children }: ResponsiveLayoutProps) {
  const { isWide } = useMediaQuery();

  if (isWide) {
    return (
      <View className="flex-1 flex-row bg-white dark:bg-neutral-950">
        <Sidebar />
        <View className="flex-1">{children ?? <Slot />}</View>
      </View>
    );
  }

  // On narrow screens, just render children - the tab bar is handled by the tabs layout
  return <View className="flex-1 bg-white dark:bg-neutral-950">{children ?? <Slot />}</View>;
}

/**
 * Content wrapper that adds proper padding and max-width constraints
 */
export function ContentWrapper({ children }: { children: React.ReactNode }) {
  const { isWide, lg, xl } = useMediaQuery();

  return (
    <View
      className="flex-1"
      style={{
        paddingHorizontal: isWide ? 24 : 16,
        maxWidth: xl ? 1400 : lg ? 1200 : undefined,
        alignSelf: isWide ? "center" : undefined,
        width: "100%",
      }}
    >
      {children}
    </View>
  );
}
