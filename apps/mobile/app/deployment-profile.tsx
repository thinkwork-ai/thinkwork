import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { Button } from "@/components/ui/button";
import { Text, H2, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { setupEnvironmentFromDeploymentProfileLink } from "@/lib/environments/setup-flow";
import { useAuth } from "@/lib/auth-context";

/**
 * Deep-link target for the web "Set up mobile" QR
 * (thinkwork://deployment-profile?profile=<base64url>). Imports the payload
 * as a saved environment and lands on its login screen. Environments carry
 * their own sessions, so no sign-out is required and the raw payload is
 * never shown.
 */
export default function DeploymentProfileScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const params = useLocalSearchParams<{
    profile?: string | string[];
    json?: string | string[];
  }>();
  const { rescopeAuthForEnvironmentChange } = useAuth();
  const payload = useMemo(() => profilePayloadFromParams(params), [params]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImport = useCallback(async () => {
    if (!payload) {
      setError("This setup link is missing its environment data.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      await setupEnvironmentFromDeploymentProfileLink(payload);
      const restored = await rescopeAuthForEnvironmentChange();
      router.replace(restored ? "/" : "/sign-in");
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Environment setup failed.",
      );
    } finally {
      setImporting(false);
    }
  }, [payload, rescopeAuthForEnvironmentChange, router]);

  useEffect(() => {
    void handleImport();
  }, [handleImport]);

  return (
    <View className="flex-1 items-center justify-center bg-white p-6 dark:bg-neutral-950">
      <View className="w-full max-w-md items-center gap-6">
        <Image
          source={require("@/assets/logo.png")}
          style={{ width: 96, height: 78 }}
          resizeMode="contain"
        />
        <H2 className="text-center">Add environment</H2>

        {importing && (
          <View className="items-center gap-3">
            <ActivityIndicator size="small" color={colors.mutedForeground} />
            <Muted className="text-center">Setting up your environment…</Muted>
          </View>
        )}

        {!importing && error && (
          <View className="w-full gap-4">
            <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
              <Text size="sm" className="text-destructive">
                {error}
              </Text>
            </View>
            <Button onPress={() => void handleImport()}>Try again</Button>
          </View>
        )}

        <Pressable
          className="py-2"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/sign-in")
          }
        >
          <Text size="sm" variant="muted" className="text-center">
            Back to sign in
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function profilePayloadFromParams(params: {
  profile?: string | string[];
  json?: string | string[];
}): string {
  const profile = firstParam(params.profile);
  const json = firstParam(params.json);
  if (profile) return `thinkwork://deployment-profile?profile=${profile}`;
  return json ?? "";
}

function firstParam(value?: string | string[]): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
