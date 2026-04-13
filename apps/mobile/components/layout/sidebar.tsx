import * as React from "react";
import { View, Text, Pressable, ScrollView, Image, Linking } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks/use-tenants";
import { ListTodo, CheckSquare } from "lucide-react-native";
import { IconSettings } from "@tabler/icons-react-native";
import { cn } from "@/lib/utils";
import { COLORS } from "@/lib/theme";
interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<any>;
  size?: number;
  badge?: number;
}

function SidebarMenuButton({ item, isActive, colors }: { item: NavItem; isActive: boolean; colors: typeof COLORS.light }) {
  const router = useRouter();
  const Icon = item.icon;

  return (
    <Pressable
      onPress={() => router.push(item.href)}
      className={cn(
        "flex-row items-center gap-3 rounded-md px-3 py-2",
        isActive
          ? "bg-neutral-100 dark:bg-neutral-800"
          : "active:bg-neutral-100 dark:active:bg-neutral-800"
      )}
    >
      <Icon
        size={item.size ?? 20}
        strokeWidth={1.5}
        color={isActive ? colors.foreground : colors.mutedForeground}
      />
      <Text
        className={cn(
          "text-sm flex-1",
          isActive
            ? "font-medium text-neutral-900 dark:text-neutral-100"
            : "text-neutral-500 dark:text-neutral-400"
        )}
      >
        {item.title}
      </Text>
      {item.badge != null && item.badge > 0 && (
        <View className="bg-amber-500 rounded-full px-1.5 py-0.5 min-w-[20px] items-center">
          <Text className="text-[10px] font-bold text-white">{item.badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { colorScheme } = useColorScheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [{ data: tenantData }] = useTenant(tenantId);
  const tenant = tenantData?.tenant;
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const navItems: NavItem[] = [
    { title: "Threads", href: "/(tabs)", icon: ListTodo },
    { title: "Tasks", href: "/(tabs)/tasks", icon: CheckSquare },
    { title: "Settings", href: "/(tabs)/settings", icon: IconSettings },
  ];

  const isActive = (href: string) => {
    if (href === "/(tabs)" || href === "/(tabs)/index") {
      return pathname === "/" || pathname === "/(tabs)" || pathname === "/(tabs)/index";
    }
    return pathname.startsWith(href.replace("/(tabs)", ""));
  };

  return (
    <View
      className="h-full bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 w-64"
      style={{ paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="px-4 border-b border-neutral-200 dark:border-neutral-800 justify-center" style={{ height: 56 }}>
        <View className="flex-row items-center gap-3">
          <Image
            source={require("@/assets/logo.png")}
            style={{ width: 28, height: 28, borderRadius: 6 }}
          />
          <View className="flex-1 gap-0">
            <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100 leading-tight">
              ThinkWork
            </Text>
            <Text className="text-xs text-neutral-500 dark:text-neutral-400 leading-tight" numberOfLines={1}>
              {user?.email ?? ""}
            </Text>
          </View>
        </View>
      </View>

      {/* Navigation */}
      <ScrollView className="flex-1 p-3">
        <View className="gap-1">
          {navItems.map((item) => (
            <SidebarMenuButton
              key={item.href}
              item={item}
              isActive={isActive(item.href)}
              colors={colors}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
