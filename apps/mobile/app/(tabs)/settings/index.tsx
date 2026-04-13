import { useState, useEffect, useMemo, type ReactNode } from "react";
import { View, Pressable, Platform, ActivityIndicator, Switch, ScrollView, Alert } from "react-native";
import { useColorScheme } from "nativewind";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { useAuth } from "@/lib/auth-context";
import { Moon, Sun, RefreshCw, Check, AlertCircle, ChevronRight } from "lucide-react-native";
import { useMe } from "@/lib/hooks/use-users";
import { useAgents } from "@/lib/hooks/use-agents";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useBiometricAuth, getBiometricName } from "@/hooks/useBiometricAuth";
import { useAppMode } from "@/lib/hooks/use-app-mode";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";

type ThemeOption = "light" | "dark";
const THEME_KEY = "@thinkwork/theme-preference";

function ThemeButton({
  option,
  current,
  onPress,
  colors,
  compact,
}: {
  option: ThemeOption;
  current: ThemeOption;
  onPress: () => void;
  colors: typeof COLORS.light;
  compact?: boolean;
}) {
  const isActive = current === option;
  const Icon = option === "light" ? Sun : Moon;
  const label = option === "light" ? "Light" : "Dark";

  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        className={`flex-row items-center gap-2 px-3 py-1.5 rounded-md border ${
          isActive
            ? "bg-sky-500 border-sky-500"
            : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
        }`}
      >
        <Icon size={16} color={isActive ? "#ffffff" : colors.foreground} />
        <Text className={`text-sm ${isActive ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 items-center justify-center py-2.5 rounded-lg border ${
        isActive
          ? "bg-sky-500 border-sky-500"
          : "bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
      }`}
    >
      <Icon size={20} color={isActive ? "#ffffff" : colors.foreground} />
      <Text className={`mt-1 text-sm font-medium ${isActive ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function SettingsNavRow({
  label,
  value,
  badge,
  onPress,
  colors,
  icon,
  isLast,
  disabled,
}: {
  label: string;
  value?: string;
  badge?: number;
  onPress: () => void;
  colors: typeof COLORS.light;
  icon?: ReactNode;
  isLast?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center justify-between py-3 active:opacity-70 ${isLast ? "" : "border-b border-neutral-200 dark:border-neutral-800"} ${disabled ? "opacity-40" : ""}`}
    >
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-base text-neutral-500 dark:text-neutral-400">{label}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        {value && <Text className="text-base text-neutral-900 dark:text-neutral-100">{value}</Text>}
        {badge != null && (
          <View className="bg-neutral-200 dark:bg-neutral-700 rounded-full px-2 py-0.5 min-w-[24px] items-center">
            <Text className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{badge}</Text>
          </View>
        )}
        <ChevronRight size={20} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "up-to-date" | "error";

function UpdateButton({ colors, compact }: { colors: typeof COLORS.light; compact?: boolean }) {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (Platform.OS === "web") return null;

  const checkForUpdates = async () => {
    try {
      setStatus("checking");
      setErrorMsg("");
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        setStatus("downloading");
        await Updates.fetchUpdateAsync();
        setStatus("ready");
      } else {
        setStatus("up-to-date");
        setTimeout(() => setStatus("idle"), 3000);
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Update check failed");
      setTimeout(() => setStatus("idle"), 5000);
    }
  };

  const applyUpdate = async () => {
    await Updates.reloadAsync();
  };

  if (compact) {
    return (
      <Pressable
        onPress={status === "ready" ? applyUpdate : checkForUpdates}
        disabled={status === "checking" || status === "downloading"}
        className="flex-row items-center gap-2"
      >
        {status === "checking" || status === "downloading" ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : status === "ready" ? (
          <Check size={16} color="#22c55e" />
        ) : status === "up-to-date" ? (
          <Check size={16} color="#22c55e" />
        ) : status === "error" ? (
          <AlertCircle size={16} color="#ef4444" />
        ) : (
          <RefreshCw size={16} color={colors.foreground} />
        )}
        <Text className={`text-sm ${
          status === "ready" || status === "up-to-date" ? "text-green-600" :
          status === "error" ? "text-red-500" : "text-neutral-900 dark:text-neutral-100"
        }`}>
          {status === "checking" ? "Checking..." :
           status === "downloading" ? "Downloading..." :
           status === "ready" ? "Install Update" :
           status === "up-to-date" ? "Up to date" :
           status === "error" ? "Error" : "Check"}
        </Text>
      </Pressable>
    );
  }

  // Mobile version
  return (
    <View className="mt-3 border-neutral-200 dark:border-neutral-800">
        <Pressable
          onPress={status === "ready" ? applyUpdate : checkForUpdates}
          disabled={status === "checking" || status === "downloading"}
          className={`flex-row items-center justify-center py-3 px-4 rounded-lg border ${
            status === "ready"
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
              : "bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700"
          }`}
        >
          {status === "checking" || status === "downloading" ? (
            <>
              <ActivityIndicator size="small" color={colors.foreground} />
              <Text className="ml-2 text-neutral-900 dark:text-neutral-100">
                {status === "checking" ? "Checking..." : "Downloading..."}
              </Text>
            </>
          ) : status === "ready" ? (
            <>
              <Check size={20} color="#22c55e" />
              <Text className="ml-2 text-green-600 dark:text-green-400 font-medium">Tap to Install Update</Text>
            </>
          ) : status === "up-to-date" ? (
            <>
              <Check size={20} color="#22c55e" />
              <Text className="ml-2 text-green-600 dark:text-green-400">Up to date!</Text>
            </>
          ) : status === "error" ? (
            <>
              <AlertCircle size={20} color="#ef4444" />
              <Text className="ml-2 text-red-500" numberOfLines={1}>{errorMsg || "Error"}</Text>
            </>
          ) : (
            <>
              <RefreshCw size={20} color={colors.foreground} />
              <Text className="ml-2 text-neutral-900 dark:text-neutral-100">Check for Updates</Text>
            </>
          )}
        </Pressable>
    </View>
  );
}

export default function SettingsScreen() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const { user } = useAuth();
  const router = useRouter();
  const { isWide } = useMediaQuery();

  const {
    isSupported: biometricSupported,
    isEnabled: biometricEnabled,
    biometricType,
    enableBiometric,
    disableBiometric,
    isLoading: biometricLoading
  } = useBiometricAuth();
  const { mode, setMode, isAdmin } = useAppMode();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data: meData }] = useMe();
  const currentUser = meData?.me;

  const tenantId = user?.tenantId;
  const [{ data: agentsData }] = useAgents(tenantId);
  const agents = agentsData?.agents ?? [];

  const activeAgent = useMemo(() => {
    const uid = user?.sub;
    const all = (agents as any[]).filter((a: any) => a.type !== "local");
    if (!uid) return null;
    const paired = all.filter((a: any) => a.humanPairId === uid);
    return paired.find((a: any) => a.role === "team") ?? paired[0] ?? null;
  }, [agents, user?.sub]);

  const [themePreference, setThemePreference] = useState<ThemeOption>("dark");
  const [signingOut, setSigningOut] = useState(false);
  const [togglingBiometric, setTogglingBiometric] = useState(false);

  const biometricName = getBiometricName(biometricType);


  const handleBiometricToggle = async (value: boolean) => {
    setTogglingBiometric(true);
    try {
      if (value) {
        await enableBiometric();
      } else {
        await disableBiometric();
      }
    } finally {
      setTogglingBiometric(false);
    }
  };

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((value) => {
      const normalizedTheme: ThemeOption = value === "light" ? "light" : "dark";
      setThemePreference(normalizedTheme);
      setColorScheme(normalizedTheme);
    });
  }, [setColorScheme]);

  const handleThemeChange = async (option: ThemeOption) => {
    setThemePreference(option);
    setColorScheme(option);
    await AsyncStorage.setItem(THEME_KEY, option);
  };

  return (
    <DetailLayout title="User Settings" showSidebar={isWide}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <WebContent bordered>
          <View className="px-4">
            <SettingsNavRow label="Account" value={currentUser?.email} onPress={() => router.push("/settings/account")} colors={colors} />
            {Platform.OS !== "web" && biometricSupported && !biometricLoading && (
              <View className="flex-row items-center justify-between py-3 border-b border-neutral-200 dark:border-neutral-800">
                <Text className="text-base text-neutral-500 dark:text-neutral-400">{biometricName}</Text>
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  disabled={togglingBiometric}
                  trackColor={{ false: "#d4d4d4", true: "#0ea5e9" }}
                  thumbColor="#ffffff"
                />
              </View>
            )}
            <SettingsNavRow
              label="Advanced Mode"
              value={isAdmin ? "On" : "Off"}
              onPress={() => router.push("/settings/advanced-mode")}
              colors={colors}
            />
<SettingsNavRow
              label="Usage & Costs"
              onPress={() => router.push("/settings/usage")}
              colors={colors}
            />
            <View className="flex-row items-center justify-between py-3">
              <Text className="text-base text-neutral-500 dark:text-neutral-400">Theme</Text>
              <View className="flex-row gap-2">
                <ThemeButton option="light" current={themePreference} onPress={() => handleThemeChange("light")} colors={colors} compact />
                <ThemeButton option="dark" current={themePreference} onPress={() => handleThemeChange("dark")} colors={colors} compact />
              </View>
            </View>
          </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
