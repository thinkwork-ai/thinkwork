import { Tabs } from "expo-router";
import { View } from "react-native";
import { ListTodo, CheckSquare, Settings } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { Sidebar } from "@/components/layout/sidebar";
import { COLORS } from "@/lib/theme";

export default function TabsLayout() {
  const { isWide } = useMediaQuery();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const tabContent = (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { display: "none" },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
          marginTop: 2,
        },
        headerStyle: {
          backgroundColor: colors.background,
          ...(isWide ? {
            height: 56,
            borderBottomWidth: 1,
            borderBottomColor: isDark ? "rgba(255,255,255,0.1)" : "#e5e5e5",
          } : {}),
        },
        headerTitleStyle: {
          color: colors.foreground,
          fontWeight: "600",
          fontSize: 18,
        },
        headerShadowVisible: false,
      }}
    >
      {/* ── Main 2 tabs ─────────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Threads",
          tabBarIcon: isWide
            ? undefined
            : ({ focused }) => (
                <ListTodo
                  size={22}
                  color={focused ? colors.primary : colors.mutedForeground}
                />
              ),
        }}
      />
      <Tabs.Screen
        name="tasks/index"
        options={{
          title: "Tasks",
          tabBarIcon: isWide
            ? undefined
            : ({ focused }) => (
                <CheckSquare
                  size={22}
                  color={focused ? colors.primary : colors.mutedForeground}
                />
              ),
        }}
      />
      <Tabs.Screen
        name="settings/index"
        options={{
          title: "Settings",
          tabBarIcon: isWide
            ? undefined
            : ({ focused }) => (
                <Settings
                  size={22}
                  color={focused ? colors.primary : colors.mutedForeground}
                />
              ),
        }}
      />

      {/* ── Hidden routes (still registered for deep links / back-compat) ── */}
      <Tabs.Screen name="threads/index" options={{ href: null }} />
      <Tabs.Screen name="agents/index" options={{ href: null }} />
      <Tabs.Screen name="team/index" options={{ href: null }} />
      <Tabs.Screen name="routines/index" options={{ href: null }} />
      <Tabs.Screen name="heartbeats" options={{ href: null }} />

      <Tabs.Screen name="skills" options={{ href: null }} />
      <Tabs.Screen name="fleet" options={{ href: null }} />
      <Tabs.Screen name="activity/index" options={{ href: null }} />
    </Tabs>
  );

  if (isWide) {
    return (
      <View className="flex-1 flex-row bg-white dark:bg-neutral-950">
        <Sidebar />
        <View className="flex-1">{tabContent}</View>
      </View>
    );
  }

  return tabContent;
}
