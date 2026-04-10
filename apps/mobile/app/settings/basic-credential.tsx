import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";

// TODO: Replace with GraphQL mutation
// Previously: useAction(api.connectorCredentialsActions.create)

export default function BasicCredentialScreen() {
  const router = useRouter();

  // TODO: implement createCredential via GraphQL mutation
  const createCredential = async (_args: { name: string; type: string; username: string; password: string }) => {
    throw new Error("TODO: implement createCredential via GraphQL");
  };

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && username.trim().length > 0 && password.length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await createCredential({
        name: name.trim(),
        type: "basic",
        username: username.trim(),
        password,
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credential");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DetailLayout title="Basic Credential" onBack={() => router.back()}>
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ paddingTop: 0, paddingBottom: 24, alignItems: Platform.OS === "web" ? "flex-start" : "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mt-4 px-4 gap-4 w-full" style={{ maxWidth: 768 }}>
          <Input
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="Last Mile Production"
            autoCapitalize="words"
          />
          <Input
            label="Username"
            value={username}
            onChangeText={setUsername}
            placeholder="username"
            autoCapitalize="none"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
          />

          {error && (
            <View className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
              <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
            </View>
          )}

          <View className="mt-2">
            <Pressable
              onPress={handleSave}
              disabled={!canSave || saving}
              className="flex-row items-center justify-center px-5 rounded-lg bg-orange-500 border border-orange-500"
              style={{ opacity: !canSave || saving ? 0.5 : 1, height: 44 }}
            >
              {saving ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text className="ml-2 text-white font-semibold text-sm">Saving...</Text>
                </>
              ) : (
                <Text className="text-white font-semibold text-sm">Save Credential</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
