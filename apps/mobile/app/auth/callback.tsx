import { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Text } from "@/components/ui/typography";
import * as auth from "@/lib/auth";
import { setAuthToken } from "@/lib/graphql/client";

export default function AuthCallbackScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    // On native, Google OAuth completes inside WebBrowser.openAuthSessionAsync
    // (handled by handleSignInWithGoogle in auth-context). Expo Router ALSO
    // routes the redirect deep link to this screen; if we exchange the code
    // here we race the in-context handler. Even with the wrong redirect_uri
    // (`undefined/auth/callback` on native, since window.location is absent),
    // the call can still invalidate the single-use code, leaving the
    // legitimate in-context exchange to fail with `invalid_grant`. Bail out on
    // native and let the routing guard + AuthProvider drive navigation.
    if (Platform.OS !== "web") return;
    if (!code || handledRef.current) return;
    handledRef.current = true;

    const redirectUri = window.location.origin + "/auth/callback";

    auth
      .exchangeCodeForTokens(code, redirectUri)
      .then((tokens) => {
        auth.storeOAuthTokens(tokens);
        setAuthToken(tokens.id_token);
        // Full reload so AuthProvider picks up the stored session
        window.location.href = "/";
      })
      .catch((err) => {
        console.error("[AuthCallback] token exchange failed:", err);
        setError("Sign-in failed. Please try again.");
      });
  }, [code]);

  return (
    <View className="flex-1 items-center justify-center bg-white dark:bg-neutral-950">
      {error ? (
        <Text className="text-destructive">{error}</Text>
      ) : (
        <>
          <ActivityIndicator size="large" />
          <Text className="mt-4" variant="muted">
            Completing sign-in...
          </Text>
        </>
      )}
    </View>
  );
}
