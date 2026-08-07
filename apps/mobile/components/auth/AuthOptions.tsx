import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
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

      {display.showOAuthButtons && (
        <View
          className={
            display.oauthOptions.length > 1 ? "flex-row gap-3" : "gap-3"
          }
        >
          {display.oauthOptions.map((option) => (
            <Button
              key={option.key}
              variant={display.showPasswordForm ? "outline" : "default"}
              onPress={() => onPressOAuth?.(option)}
              disabled={disabled}
              className={display.oauthOptions.length > 1 ? "flex-1" : ""}
            >
              <View className="flex-row items-center gap-2">
                <ProviderIcon icon={option.icon} />
                <Text className="font-semibold">
                  {oauthProviderLabel(option)}
                </Text>
              </View>
            </Button>
          ))}
        </View>
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

function oauthProviderLabel(option: PublicOAuthOption): string {
  return option.label.replace(/^Continue with\s+/i, "");
}

function ProviderIcon({ icon }: { icon: PublicOAuthOption["icon"] }) {
  if (icon === "google") return <GoogleIcon />;
  return <MicrosoftIcon />;
}

function GoogleIcon() {
  return (
    <Svg viewBox="0 0 24 24" width={20} height={20}>
      <Path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
      />
      <Path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <Path
        fill="#FBBC05"
        d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z"
      />
      <Path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.8.51 3.84 1.5l2.86-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
      />
    </Svg>
  );
}

function MicrosoftIcon() {
  return (
    <Svg viewBox="0 0 24 24" width={20} height={20}>
      <Path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <Path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <Path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <Path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </Svg>
  );
}
