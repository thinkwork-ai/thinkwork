// Polyfill crypto.getRandomValues for amazon-cognito-identity-js SRP auth
// Must run before any Cognito import
import { getRandomValues } from "expo-crypto";
if (typeof globalThis.crypto === "undefined") {
  (globalThis as any).crypto = { getRandomValues };
} else if (!globalThis.crypto.getRandomValues) {
  (globalThis.crypto as any).getRandomValues = getRandomValues;
}

import { useEffect, useState, useRef } from "react";
import { LogBox } from "react-native";
LogBox.ignoreLogs(["Cannot update a component", "[AppSync WS] Subscription error"]);
import { View, Platform, AppState, AppStateStatus, Alert } from "react-native";
import { Stack, useRouter, useSegments, useRootNavigationState } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "@react-navigation/native";
import { useColorScheme } from "nativewind";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { GraphQLProvider } from "@/lib/graphql/provider";
import { NAV_THEME } from "@/lib/theme";
import { useAgents } from "@/lib/hooks/use-agents";
import { usePushNotifications } from "@/lib/hooks/use-push-notifications";
import { TurnCompletionProvider } from "@/lib/hooks/use-turn-completion";
import { useThreadTurnUpdatedSubscription } from "@/lib/hooks/use-subscriptions";
import { useBiometricAuth, getBiometricName } from "@/hooks/useBiometricAuth";
import { BiometricLockScreen } from "@/components/BiometricLockScreen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "../global.css";

function RootLayoutNav() {
  const { isLoading, isAuthenticated, user, signOut, didActiveLogin } = useAuth();
  const {
    isEnabled: biometricEnabled,
    isSupported: biometricSupported,
    biometricType,
    isLoading: biometricLoading,
    disableBiometric,
    enableBiometricFlag,
    clearStoredCredentials,
  } = useBiometricAuth();
  const { colorScheme } = useColorScheme();
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const navigationReady = !!navigationState?.key;

  const tenantId = user?.tenantId;
  const hasTenant = !!tenantId;

  // Register turn subscription early at root level so it's active before home tab mounts
  useThreadTurnUpdatedSubscription(tenantId);

  const [{ data: agentsData }] = useAgents(tenantId);
  const agents = agentsData?.agents;

  // Push notifications — registers token after auth
  const { unregisterToken: unregisterPushToken } = usePushNotifications(isAuthenticated);

  // Biometric lock state
  const [isUnlocked, setIsUnlocked] = useState(false);
  const isAuthenticating = useRef(false);

  // Lock when app goes to background
  useEffect(() => {
    if (Platform.OS === "web") return;

    const subscription = AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
      if (
        (nextAppState === "inactive" || nextAppState === "background") &&
        biometricEnabled &&
        isAuthenticated &&
        !isAuthenticating.current
      ) {
        setIsUnlocked(false);
      }
    });

    return () => subscription.remove();
  }, [biometricEnabled, isAuthenticated]);

  // Track login transitions: auto-unlock when user just signed in with password
  const wasAuthenticated = useRef(false);
  const didInitialUnlockCheck = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsUnlocked(false);
      wasAuthenticated.current = false;
      didInitialUnlockCheck.current = false;
    } else if (!wasAuthenticated.current && isAuthenticated) {
      wasAuthenticated.current = true;
      // Don't decide on unlock yet — wait for biometric loading to finish
    }
  }, [isAuthenticated]);

  // Once both auth and biometric state are resolved, decide unlock
  useEffect(() => {
    if (!isAuthenticated || biometricLoading || didInitialUnlockCheck.current) return;
    didInitialUnlockCheck.current = true;

    if (!biometricEnabled || didActiveLogin) {
      // No biometric configured, or user just signed in with password — unlock immediately
      setIsUnlocked(true);
    }
    // If biometric is enabled and session was auto-restored, lock screen will show
  }, [isAuthenticated, biometricLoading, biometricEnabled, didActiveLogin]);

  // Prompt to enable biometric after active login (moved from sign-in screen
  // because navigation dismisses the Alert before user can interact)
  const didPromptBiometric = useRef(false);
  useEffect(() => {
    if (
      !didActiveLogin ||
      !isAuthenticated ||
      !hasTenant ||
      biometricLoading ||
      biometricEnabled ||
      !biometricSupported ||
      didPromptBiometric.current ||
      Platform.OS === "web"
    ) return;

    didPromptBiometric.current = true;
    const name = getBiometricName(biometricType);

    Alert.alert(
      `Enable ${name}?`,
      `Sign in faster next time using ${name}.`,
      [
        {
          text: "Not Now",
          style: "cancel",
          onPress: () => { clearStoredCredentials(); },
        },
        {
          text: `Enable ${name}`,
          onPress: () => { enableBiometricFlag(); },
        },
      ]
    );
  }, [didActiveLogin, isAuthenticated, hasTenant, biometricLoading, biometricEnabled, biometricSupported]);

  // Routing guard
  useEffect(() => {
    if (isLoading || !navigationReady) return;

    const publicRoutes = ["sign-in", "sign-up", "verify", "demo", "onboarding", "invite", "forgot-password", "auth"];
    const isPublicRoute = publicRoutes.includes(segments[0] as string);

    if (!isAuthenticated && !isPublicRoute) {
      router.replace("/sign-in");
    } else if (isAuthenticated && !hasTenant && !isPublicRoute) {
      // User authenticated but JWT has no tenantId
      disableBiometric().catch(() => {});
      setIsUnlocked(true);
      router.replace("/sign-in");
    } else if (isAuthenticated && segments[0] === "sign-in") {
      if (hasTenant) {
        router.replace("/");
      }
    } else if (isAuthenticated && hasTenant) {
      const beacon = agents?.find((a: any) => a.role === "team");
      const isProvisioning = beacon && (beacon.status as string) === "provisioning";
      const isOnComplete = segments.join("/").includes("onboarding/complete");

      if (isProvisioning && !isOnComplete && !isPublicRoute) {
        router.replace("/onboarding/complete");
      }
    }
  }, [isLoading, isAuthenticated, segments, hasTenant, navigationReady, agents]);

  const handleBiometricUnlock = () => {
    isAuthenticating.current = false;
    setIsUnlocked(true);
  };

  const handleStartAuth = () => {
    isAuthenticating.current = true;
  };

  const handleEndAuth = () => {
    isAuthenticating.current = false;
  };

  const handleLoginScreen = async () => {
    await signOut();
    setIsUnlocked(true);
    router.replace("/sign-in");
  };

  // Show biometric lock screen: user is authed but hasn't unlocked with Face ID yet
  const needsBiometricUnlock =
    isAuthenticated &&
    hasTenant &&
    !isUnlocked &&
    biometricEnabled &&
    !biometricLoading &&
    Platform.OS !== "web";

  if (!navigationReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <TurnCompletionProvider tenantId={tenantId}>
    <ThemeProvider value={NAV_THEME[colorScheme === "dark" ? "dark" : "light"]}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-in" options={{ animationTypeForReplace: "pop" }} />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="verify" />
        <Stack.Screen name="onboarding/verify-email" />
        <Stack.Screen name="onboarding/verify-code" />
        <Stack.Screen name="onboarding/payment" />
        <Stack.Screen name="onboarding/complete" />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="demo" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="thread/[threadId]" options={{ headerShown: false }} />
        <Stack.Screen name="chat/index" options={{ headerShown: false }} />
        <Stack.Screen name="threads" />
        <Stack.Screen name="routines/[id]/index" />
        <Stack.Screen name="routines/[id]/runs" />
        <Stack.Screen name="settings/index" options={{ headerShown: false }} />
        <Stack.Screen name="settings/account" />
        <Stack.Screen name="settings/team" />
        <Stack.Screen name="settings/profile" />
        <Stack.Screen name="settings/connectors" />
        <Stack.Screen name="settings/integrations" />
        <Stack.Screen name="settings/integration-detail" />
        <Stack.Screen name="settings/usage" />
        <Stack.Screen name="invite/[token]" />
        <Stack.Screen name="team/[id]" />
        <Stack.Screen name="team/add-users" />
        <Stack.Screen name="team/edit-member" />
        <Stack.Screen name="team/pick-user" />
        <Stack.Screen name="agents/[id]/files" />
        <Stack.Screen name="agents/[id]/file-view" />
        <Stack.Screen name="agents/[id]/skills" />
        <Stack.Screen name="agents/[id]/model" />
        <Stack.Screen name="places/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="opportunities/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="leads/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="artifacts/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="memory/index" options={{ headerShown: false }} />
        <Stack.Screen name="memory/list" options={{ headerShown: false }} />
        <Stack.Screen name="memory/[file]" options={{ headerShown: false }} />
        <Stack.Screen name="memory/edit-file" options={{ headerShown: false }} />
        <Stack.Screen name="heartbeats/new" />
        <Stack.Screen name="heartbeats/[id]" />
        <Stack.Screen name="routines/new" />
        <Stack.Screen name="routines/builder" />
        <Stack.Screen name="routines/builder-chat" />
      </Stack>

      {needsBiometricUnlock && (
        <BiometricLockScreen
          onUnlock={handleBiometricUnlock}
          onLoginScreen={handleLoginScreen}
          onStartAuth={handleStartAuth}
          onEndAuth={handleEndAuth}
        />
      )}
    </ThemeProvider>
    </TurnCompletionProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();

  // Default to dark mode on first load
  useEffect(() => {
    if (colorScheme !== "dark") {
      setColorScheme("dark");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isDark = colorScheme === "dark";

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? "light" : "dark"} />
      <AuthProvider>
        <GraphQLProvider>
          <View
            style={{ flex: 1, backgroundColor: NAV_THEME[isDark ? "dark" : "light"].colors.background }}
          >
            <RootLayoutNav />
          </View>
        </GraphQLProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
