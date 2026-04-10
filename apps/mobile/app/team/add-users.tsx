import { useState } from "react";
import { View, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/typography";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DetailLayout } from "@/components/layout/detail-layout";
import { COLORS } from "@/lib/theme";
import { Send } from "lucide-react-native";

// TODO: Replace with GraphQL mutation
// Previously: useAction(api.invitations_actions.sendInvite)

export default function InviteUserToTeamScreen() {
  const router = useRouter();
  const { teamId } = useLocalSearchParams<{ teamId: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // TODO: implement sendInvite via GraphQL mutation
  const sendInvite = async (_args: { email: string; teamId?: string }) => {
    throw new Error("TODO: implement sendInvite via GraphQL");
  };

  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setSending(true);
    setError(null);

    try {
      await sendInvite({ email: trimmed, teamId: teamId || undefined });
      setSent(true);
      setTimeout(() => router.back(), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send invite";
      setError(msg);
      if (Platform.OS !== "web") {
        Alert.alert("Error", msg);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <DetailLayout title="Invite User" onBack={() => router.back()}>
      <View className="p-4 gap-4">
        <Text className="text-neutral-600 dark:text-neutral-400">
          Send an email invitation to join your team. They'll create an account and be automatically added as a team member.
        </Text>

        <View className="gap-2">
          <Text className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
            Email Address
          </Text>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="colleague@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!sending && !sent}
          />
        </View>

        {error && (
          <Text className="text-red-500 text-sm">{error}</Text>
        )}

        {sent ? (
          <View className="flex-row items-center gap-2 py-3">
            <Send size={18} color={colors.primary} />
            <Text style={{ color: colors.primary }} className="font-medium">
              Invitation sent! Redirecting...
            </Text>
          </View>
        ) : (
          <Button onPress={handleSend} disabled={sending || !email.trim()}>
            {sending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Send size={18} color="#ffffff" />
            )}
            <Text className="text-white font-medium ml-2">
              {sending ? "Sending..." : "Send Invitation"}
            </Text>
          </Button>
        )}
      </View>
    </DetailLayout>
  );
}
