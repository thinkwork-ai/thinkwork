import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useColorScheme } from "nativewind";
import { Shield } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import {
  FALLBACK_AUTH_OPTIONS,
  deriveAuthOptionsDisplay,
  fetchAuthOptionsForActiveEnvironment,
  type AuthOptionsUiState,
  type PublicOAuthOption,
} from "@/lib/auth-options";

export function useAuthOptions(reloadKey: string): {
  state: AuthOptionsUiState;
  retry: () => void;
} {
  const [state, setState] = useState<AuthOptionsUiState>({
    loading: true,
    failed: false,
    options: FALLBACK_AUTH_OPTIONS,
  });
  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    void fetchAuthOptionsForActiveEnvironment().then((result) => {
      if (cancelled) return;
      setState({
        loading: false,
        failed: result.failed,
        options: result.options,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, retryCounter]);

  const retry = useCallback(() => {
    setRetryCounter((value) => value + 1);
  }, []);

  return { state, retry };
}

export function AuthOptions({
  state,
  onRetry,
  onPressSso,
  disabled,
}: {
  state: AuthOptionsUiState;
  onRetry: () => void;
  onPressSso?: (option: PublicOAuthOption) => void;
  disabled?: boolean;
}) {
  const display = deriveAuthOptionsDisplay(state);
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  return (
    <View className="gap-4">
      {state.loading && (
        <View className="gap-3" accessibilityLabel="Loading sign-in options">
          <View className="h-14 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
          <View className="h-4 w-28 self-center rounded-full bg-neutral-200 dark:bg-neutral-800" />
        </View>
      )}

      {display.ssoOption && display.showSsoButton && (
        <Button
          variant={display.showPasswordForm ? "outline" : "default"}
          onPress={() => onPressSso?.(display.ssoOption!)}
          disabled={disabled}
        >
          <Shield size={20} color={colors.foreground} />
          Continue with SSO
        </Button>
      )}

      {display.showDivider && (
        <View className="my-1 flex-row items-center">
          <View className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          <Text className="mx-4 text-sm text-neutral-400 dark:text-neutral-500">
            or
          </Text>
          <View className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        </View>
      )}

      {display.showRetry && (
        <View className="items-center gap-1">
          <Text size="xs" variant="muted" className="text-center">
            Couldn't load sign-in options.
          </Text>
          <Pressable onPress={onRetry} hitSlop={8}>
            <Text size="sm" className="font-medium text-sky-500">
              Retry
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
