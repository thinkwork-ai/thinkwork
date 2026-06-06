import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Upload } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/ui/typography";
import { useAuth } from "@/lib/auth-context";

export default function DeploymentProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    profile?: string | string[];
    json?: string | string[];
  }>();
  const { importDeploymentProfile, deploymentConfig } = useAuth();
  const initialPayload = useMemo(
    () => profilePayloadFromParams(params),
    [params],
  );
  const [profileInput, setProfileInput] = useState(initialPayload);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleImport = useCallback(
    async (input = profileInput) => {
      if (!input.trim()) {
        setError("Paste a deployment profile first");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await importDeploymentProfile(input);
        router.replace("/sign-in");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || "Deployment profile import failed.");
      } finally {
        setLoading(false);
      }
    },
    [importDeploymentProfile, profileInput, router],
  );

  useEffect(() => {
    if (!initialPayload) return;
    void handleImport(initialPayload);
  }, [handleImport, initialPayload]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-neutral-950"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card className="w-[90%] max-w-md">
          <CardHeader>
            <CardTitle>Deployment</CardTitle>
            <Text size="sm" variant="muted">
              {deploymentConfig.deployment.displayName}
            </Text>
          </CardHeader>
          <CardContent className="gap-4">
            <TextInput
              value={profileInput}
              onChangeText={setProfileInput}
              placeholder="Deployment profile JSON or link"
              placeholderTextColor="#a3a3a3"
              multiline
              numberOfLines={8}
              className="min-h-40 rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:text-neutral-100"
              style={
                Platform.OS === "android"
                  ? { textAlignVertical: "top" as const }
                  : undefined
              }
            />
            {error && (
              <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                <Text size="sm" className="text-destructive">
                  {error}
                </Text>
              </View>
            )}
            <Button onPress={() => void handleImport()} loading={loading}>
              <Upload size={18} color="white" />
              <Text className="font-semibold text-primary-foreground">
                Import
              </Text>
            </Button>
            <Button
              variant="ghost"
              onPress={() => router.replace("/sign-in")}
              disabled={loading}
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
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
