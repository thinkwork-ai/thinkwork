import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { useAuth } from "@/lib/auth-context";
import {
  parseWorkosCallbackParams,
  parseWorkosCallbackUrl,
} from "@/lib/workos-auth";

export default function WorkosCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    workos_bridge?: string | string[];
    next?: string | string[];
  }>();
  const { completeSignInWithSSOBridge } = useAuth();
  const handledRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    async function complete() {
      try {
        let bridgeCode: string | null = null;
        try {
          bridgeCode = parseWorkosCallbackParams(params).bridgeCode;
        } catch {
          const initialUrl = await Linking.getInitialURL();
          if (initialUrl) {
            bridgeCode = parseWorkosCallbackUrl(initialUrl).bridgeCode;
          }
        }

        if (!bridgeCode) {
          throw new Error("No WorkOS bridge code in callback URL.");
        }

        await completeSignInWithSSOBridge(bridgeCode);
        router.replace("/");
      } catch (err) {
        console.error("[WorkosCallback] sign-in failed:", err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message || "Unable to complete sign-in.");
      }
    }

    void complete();
  }, [completeSignInWithSSOBridge, params, router]);

  return (
    <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-neutral-950">
      {error ? (
        <View className="w-full max-w-sm gap-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <Text size="sm" className="text-destructive">
            {error}
          </Text>
          <Button variant="outline" onPress={() => router.replace("/sign-in")}>
            Back to sign-in
          </Button>
        </View>
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
