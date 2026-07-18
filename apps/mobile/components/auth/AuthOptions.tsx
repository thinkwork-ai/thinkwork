import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
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
  onPressOAuth,
  disabled,
}: {
  state: AuthOptionsUiState;
  onRetry: () => void;
  onPressOAuth?: (option: PublicOAuthOption) => void;
  disabled?: boolean;
}) {
  const display = deriveAuthOptionsDisplay(state);

  return (
    <View className="gap-4">
      {state.loading && (
        <View className="gap-3" accessibilityLabel="Loading sign-in options">
          <View className="h-14 rounded-xl bg-neutral-200 dark:bg-neutral-800" />
          <View className="h-4 w-28 self-center rounded-full bg-neutral-200 dark:bg-neutral-800" />
        </View>
      )}

      {display.showOAuthButtons &&
        display.oauthOptions.map((option) => (
          <Button
            key={option.key}
            variant={display.showPasswordForm ? "outline" : "default"}
            onPress={() => onPressOAuth?.(option)}
            disabled={disabled}
          >
            <Text className="mr-2 font-semibold">
              {option.icon === "google" ? "G" : "⊞"}
            </Text>
            {option.label}
          </Button>
        ))}

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
