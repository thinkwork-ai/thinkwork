import { useMemo, useState, useEffect } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

// TODO: Replace with GraphQL queries/mutations
// Previously: useQuery(api.connectorCredentials.list)
// Previously: useAction(api.connectorCredentialsActions.update)
// Previously: useAction(api.connectorCredentialsActions.remove)

type CredentialMeta = {
  id: string;
  name: string;
  type: "apiKey" | "basic";
  usernameHint?: string;
};

export default function BasicCredentialDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: Replace with GraphQL query
  const credentials: CredentialMeta[] | undefined = undefined; // TODO: implement connectorCredentials.list via GraphQL
  const updateCredential = async (_args: { credentialId: string; name: string; username?: string; password?: string }) => {
    throw new Error("TODO: implement updateCredential via GraphQL");
  };
  const removeCredential = async (_args: { credentialId: string }) => {
    throw new Error("TODO: implement removeCredential via GraphQL");
  };

  const credential = useMemo(
    () => ((credentials || []) as CredentialMeta[]).find((c) => c.id === id && c.type === "basic"),
    [credentials, id]
  );

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (credential) {
      setName(credential.name || "");
    }
  }, [credential]);

  const hasNewUsername = username.trim().length > 0;
  const hasNewPassword = password.length > 0;
  const isSecretUpdateValid = hasNewUsername === hasNewPassword;
  const canSave = name.trim().length > 0 && isSecretUpdateValid;

  const handleSave = async () => {
    if (!credential || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      await updateCredential({
        credentialId: credential.id,
        name: name.trim(),
        ...(hasNewUsername && hasNewPassword
          ? { username: username.trim(), password }
          : {}),
      });
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credential");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!credential) return;
    Alert.alert(
      "Delete credential?",
      "This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await removeCredential({ credentialId: credential.id });
              router.back();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to delete credential");
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  if (credentials === undefined) {
    return (
      <DetailLayout title="Basic Credential" onBack={() => router.back()}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </DetailLayout>
    );
  }

  if (!credential) {
    return (
      <DetailLayout title="Basic Credential" onBack={() => router.back()}>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-neutral-900 dark:text-neutral-100">Credential not found.</Text>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      title="Basic Credential"
      onBack={() => router.back()}
      headerRight={
        <Pressable onPress={confirmDelete} disabled={deleting} className="p-1" style={{ opacity: deleting ? 0.5 : 1 }}>
          <Trash2 size={18} color="#ef4444" />
        </Pressable>
      }
    >
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ paddingTop: 0, paddingBottom: 24, alignItems: Platform.OS === "web" ? "flex-start" : "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mt-4 px-4 gap-4 w-full" style={{ maxWidth: 768 }}>
          <Input label="Name" value={name} onChangeText={setName} placeholder="Last Mile Production" autoCapitalize="words" />
          <Input
            label="New Username (optional)"
            value={username}
            onChangeText={setUsername}
            placeholder={credential.usernameHint || "username"}
            autoCapitalize="none"
          />
          <Input label="New Password (optional)" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry autoCapitalize="none" />

          {!isSecretUpdateValid && (
            <View className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
              <Text className="text-sm text-amber-700 dark:text-amber-400">Enter both username and password when rotating secrets.</Text>
            </View>
          )}

          {error && (
            <View className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
              <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
            </View>
          )}

          <View className="mt-2">
            <Pressable
              onPress={handleSave}
              disabled={!canSave || saving || deleting}
              className="flex-row items-center justify-center px-5 rounded-lg bg-orange-500 border border-orange-500"
              style={{ opacity: !canSave || saving || deleting ? 0.5 : 1, height: 44 }}
            >
              {saving ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text className="ml-2 text-white font-semibold text-sm">Saving...</Text>
                </>
              ) : (
                <Text className="text-white font-semibold text-sm">Save Changes</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </DetailLayout>
  );
}
