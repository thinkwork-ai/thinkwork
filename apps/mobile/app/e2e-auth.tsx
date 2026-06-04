import { useEffect, useState } from "react";
import { ActivityIndicator, DevSettings, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";

import { Text } from "@/components/ui/typography";
import * as auth from "@/lib/auth";
import { setAuthToken } from "@/lib/graphql/client";

const STORED_TENANT_ID_KEY = "thinkwork_stored_tenant_id";

export default function E2EAuthScreen() {
  const { source } = useLocalSearchParams<{ source?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setError("Missing token source.");
      return;
    }

    let cancelled = false;

    async function importSession() {
      try {
        const response = await fetch(source);
        if (!response.ok)
          throw new Error(`Token source returned ${response.status}`);
        const tokens = (await response.json()) as {
          idToken: string;
          accessToken: string;
          refreshToken: string;
          tenantId?: string;
        };

        auth.storeOAuthTokens({
          id_token: tokens.idToken,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        if (tokens.tenantId) {
          await SecureStore.setItemAsync(STORED_TENANT_ID_KEY, tokens.tenantId);
        }
        setAuthToken(tokens.idToken);

        if (!cancelled) {
          setTimeout(() => DevSettings.reload(), 250);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Session import failed.",
          );
        }
      }
    }

    void importSession();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950 px-8">
      {error ? (
        <Text className="text-destructive text-center">{error}</Text>
      ) : (
        <>
          <ActivityIndicator size="large" />
          <Text className="mt-4 text-center" variant="muted">
            Importing E2E session...
          </Text>
        </>
      )}
    </View>
  );
}
