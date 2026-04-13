import { useState, useEffect, useRef } from "react";
import { View, AppState, AppStateStatus, Image, Pressable } from "react-native";
import { Scan, Lock } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useBiometricAuth } from "@/hooks/useBiometricAuth";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";

interface BiometricLockScreenProps {
  onUnlock: () => void;
  onLoginScreen: () => void;
  onStartAuth?: () => void;
  onEndAuth?: () => void;
}

export function BiometricLockScreen({
  onUnlock,
  onLoginScreen,
  onStartAuth,
  onEndAuth,
}: BiometricLockScreenProps) {
  const { biometricType, authenticate, isLoading } = useBiometricAuth();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [authenticating, setAuthenticating] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const appState = useRef(AppState.currentState);

  // Auto-trigger authentication on mount
  useEffect(() => {
    if (!isLoading) {
      handleAuthenticate();
    }
  }, [isLoading]);

  // Auto-trigger authentication when app comes to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === "active" &&
        !authenticating
      ) {
        handleAuthenticate();
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [authenticating]);

  const handleAuthenticate = async () => {
    if (authenticating) return;

    setAuthenticating(true);
    setShowHint(false);
    onStartAuth?.();

    const success = await authenticate();

    onEndAuth?.();

    if (success) {
      onUnlock();
    } else {
      setShowHint(true);
    }

    setAuthenticating(false);
  };

  return (
    <View
      className="bg-white dark:bg-neutral-950 items-center justify-center p-6"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}
    >
      <View className="items-center max-w-sm">
        {/* Logo */}
        <Image
          source={require("@/assets/logo.png")}
          style={{ width: 130, height: 105, marginBottom: 8 }}
          resizeMode="contain"
        />
        <Text
          className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1 tracking-tight"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
          style={{ fontSize: 24 }}
        >
          ThinkWork
        </Text>
        <Text className="text-neutral-500 dark:text-neutral-400 mb-8">
          Locked
        </Text>

        {/* Tappable biometric icon — retry on tap */}
        <Pressable
          onPress={handleAuthenticate}
          disabled={authenticating}
          className="w-20 h-20 rounded-full bg-neutral-100 dark:bg-neutral-800 items-center justify-center mb-3"
        >
          {biometricType === "facial" ? (
            <Scan size={40} color={colors.foreground} />
          ) : (
            <Lock size={40} color={colors.foreground} />
          )}
        </Pressable>

        {showHint && !authenticating && (
          <Text className="text-neutral-500 dark:text-neutral-400 text-sm mb-3">
            Tap to unlock
          </Text>
        )}
        {!showHint && <View style={{ height: 20, marginBottom: 12 }} />}

        <Button variant="link" onPress={onLoginScreen}>
          <Text className="text-neutral-400 dark:text-neutral-400">Login Screen</Text>
        </Button>
      </View>
    </View>
  );
}
