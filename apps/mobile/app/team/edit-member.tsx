import { useState, useEffect } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { Input } from "@/components/ui/input";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { useUser } from "@/lib/hooks/use-users";
import { useUpdateUserProfile } from "@/lib/hooks/use-users";

// TODO: Replace teamApi.getUserProfile and teamApi.updateUserProfile with GraphQL equivalents
// The useUser hook fetches basic user info; updateUserProfile handles profile-specific fields

export default function EditMemberScreen() {
  const { teamId, userId } = useLocalSearchParams<{ teamId: string; userId: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const isLargeScreen = useIsLargeScreen();

  const [userResult] = useUser(userId);
  const profile = userResult.data?.user ?? undefined;
  const [, executeUpdateProfile] = useUpdateUserProfile();

  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("");
  const [bio, setBio] = useState("");
  const [preferences, setPreferences] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName((profile as any).displayName ?? profile.name ?? "");
      setTitle((profile as any).title ?? "");
      setDepartment((profile as any).department ?? "");
      setPhone(profile.phone ?? "");
      setTimezone((profile as any).timezone ?? "");
      setBio((profile as any).bio ?? "");
      setPreferences((profile as any).preferences ?? "");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!userId) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await executeUpdateProfile({
        userId,
        input: {
          displayName: displayName.trim() || undefined,
          // TODO: title, department, timezone, bio, preferences — extend GraphQL input type if needed
        },
      });
      setSuccess("Profile saved successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DetailLayout
      title="Edit Member"
      headerRight={
        <Pressable onPress={handleSave} disabled={submitting}>
          {submitting ? (
            <ActivityIndicator size="small" color="#0ea5e9" />
          ) : (
            <Text style={{ color: "#0ea5e9", fontWeight: "600", fontSize: 17 }}>Save</Text>
          )}
        </Pressable>
      }
    >
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ paddingTop: 0, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <WebContent>
          <View className="mt-4 px-4">
            {/* Read-only user info */}
            {profile && (
              <View className="mb-4 rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
                <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {profile.name ?? "Unknown"}
                </Text>
                {profile.email && (
                  <Muted className="mt-1">{profile.email}</Muted>
                )}
              </View>
            )}

            <Muted className="mb-4">
              Edit this team member's profile information.
            </Muted>

            <View className={`gap-4 ${isLargeScreen ? "rounded-lg border border-neutral-200 dark:border-neutral-800 p-4" : ""}`}>
              <Input
                compact={isLargeScreen}
                label="Display Name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Display name"
                autoCapitalize="words"
              />
              <Input
                compact={isLargeScreen}
                label="Title"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Engineering Lead"
                autoCapitalize="words"
              />
              <Input
                compact={isLargeScreen}
                label="Department"
                value={department}
                onChangeText={setDepartment}
                placeholder="e.g. Engineering"
                autoCapitalize="words"
              />
              <Input
                compact={isLargeScreen}
                label="Phone"
                value={phone}
                onChangeText={setPhone}
                placeholder="+1 234 567 8900"
                keyboardType="phone-pad"
              />
              <Input
                compact={isLargeScreen}
                label="Timezone"
                value={timezone}
                onChangeText={setTimezone}
                placeholder="e.g. America/Chicago"
                autoCapitalize="none"
              />
              <Input
                compact={isLargeScreen}
                label="Bio"
                value={bio}
                onChangeText={setBio}
                placeholder="About this team member..."
                multiline
                numberOfLines={3}
                style={{ minHeight: 80, textAlignVertical: "top" }}
              />
              <Input
                compact={isLargeScreen}
                label="Preferences"
                value={preferences}
                onChangeText={setPreferences}
                placeholder="Communication preferences, working hours, etc."
                multiline
                numberOfLines={3}
                style={{ minHeight: 80, textAlignVertical: "top" }}
              />
            </View>

            {error && (
              <View className="mt-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3">
                <Text className="text-sm text-red-600 dark:text-red-400">{error}</Text>
              </View>
            )}
            {success && (
              <View className="mt-4 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3">
                <Text className="text-sm text-green-600 dark:text-green-400">{success}</Text>
              </View>
            )}



            <View className="h-8" />
          </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
