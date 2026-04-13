import { useState, useEffect } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useColorScheme } from "nativewind";
import { useMe, useUpdateUserProfile } from "@/lib/hooks/use-users";
import { useAuth } from "@/lib/auth-context";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { Input } from "@/components/ui/input";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";

export default function ProfileScreen() {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const isLargeScreen = useIsLargeScreen();

  const [{ data: meData }] = useMe();
  const profile = meData?.me;
  const { user } = useAuth();
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
    } else if (user) {
      // Pre-fill from user record if no profile yet
      setDisplayName(user.name ?? "");
    }
  }, [profile, user]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      if (!profile?.id) throw new Error("No user profile found");
      await executeUpdateProfile({
        userId: profile.id,
        input: {
          displayName: displayName.trim() || undefined,
          // TODO: title, department, phone, timezone, bio, preferences not yet in GraphQL schema — add when available
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
    <DetailLayout title="Profile">
      <ScrollView
        className="flex-1 bg-white dark:bg-neutral-950"
        contentContainerStyle={{ paddingTop: 0, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <WebContent>
          <View className="mt-4 px-4">
            <Muted className="mb-4">
              Your profile information is shared with your team team and agents.
            </Muted>

            <View className={`gap-4 ${isLargeScreen ? "rounded-lg border border-neutral-200 dark:border-neutral-800 p-4" : ""}`}>
              <Input
                compact={isLargeScreen}
                label="Display Name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
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
                placeholder="Tell your team about yourself..."
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

            <View className="mt-6">
              <Pressable
                onPress={handleSave}
                disabled={submitting}
                className="flex-row items-center justify-center px-5 rounded-lg bg-sky-500 border border-sky-500"
                style={{ opacity: submitting ? 0.5 : 1, height: 40 }}
              >
                {submitting ? (
                  <>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text className="ml-2 text-white font-semibold text-sm">Saving...</Text>
                  </>
                ) : (
                  <Text className="text-white font-semibold text-sm">Save Profile</Text>
                )}
              </Pressable>
            </View>

            <View className="h-8" />
          </View>
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
