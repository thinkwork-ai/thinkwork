import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Link, ScanLine } from "lucide-react-native";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text, H2, Muted } from "@/components/ui/typography";
import {
  setupEnvironmentFromDeploymentProfileLink,
  setupEnvironmentFromUrl,
} from "@/lib/environments/setup-flow";
import { canLeaveEnvironmentSetup } from "@/lib/environments/routing";
import { useAuth } from "@/lib/auth-context";

export default function EnvironmentSetupScreen() {
  const router = useRouter();
  const { rescopeAuthForEnvironmentChange } = useAuth();
  const canLeave = canLeaveEnvironmentSetup();
  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/sign-in");
    }
  };
  const [url, setUrl] = useState("");
  const [profileLink, setProfileLink] = useState("");
  const [showPasteLink, setShowPasteLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!url.trim()) {
      setError("Enter your ThinkWork environment URL.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await setupEnvironmentFromUrl(url);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const restored = await rescopeAuthForEnvironmentChange();
      router.replace(restored ? "/" : "/sign-in");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Environment setup failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasteLink = async () => {
    if (!profileLink.trim()) {
      setError("Paste a ThinkWork mobile setup link.");
      return;
    }
    setPasting(true);
    setError(null);
    try {
      await setupEnvironmentFromDeploymentProfileLink(profileLink);
      const restored = await rescopeAuthForEnvironmentChange();
      router.replace(restored ? "/" : "/sign-in");
    } catch (pasteError) {
      setError(
        pasteError instanceof Error
          ? pasteError.message
          : "Mobile setup link import failed.",
      );
    } finally {
      setPasting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-neutral-950"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-md self-center gap-8">
          <View className="items-center gap-4">
            <Image
              source={require("@/assets/logo.png")}
              style={{ width: 96, height: 78 }}
              resizeMode="contain"
            />
            <View className="items-center gap-2">
              <H2 className="text-center">Set up ThinkWork</H2>
              <Muted className="text-center">
                Enter the web URL for your ThinkWork environment.
              </Muted>
            </View>
          </View>

          <View className="gap-4">
            <Input
              label="Environment URL"
              placeholder="mcpherson.thinkwork.ai"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => void handleSubmit()}
            />

            {error && (
              <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                <Text size="sm" className="text-destructive">
                  {error}
                </Text>
              </View>
            )}

            <Button
              onPress={handleSubmit}
              loading={submitting}
              disabled={!url.trim()}
            >
              Continue
            </Button>

            <Pressable
              className="flex-row items-center justify-center gap-2 py-2"
              onPress={() => setShowPasteLink((value) => !value)}
            >
              <ScanLine size={18} color="#38bdf8" />
              <Text className="text-sm font-medium text-sky-500">
                Scan QR instead
              </Text>
            </Pressable>

            {canLeave && (
              <Pressable className="py-3" onPress={handleBack}>
                <Text size="sm" variant="muted" className="text-center">
                  Back to sign in
                </Text>
              </Pressable>
            )}

            {showPasteLink && (
              <View className="gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900">
                <View className="flex-row items-center gap-2">
                  <Link size={16} color="#38bdf8" />
                  <Text className="text-sm font-semibold">
                    Paste mobile setup link
                  </Text>
                </View>
                <Input
                  placeholder="thinkwork://deployment-profile?..."
                  value={profileLink}
                  onChangeText={setProfileLink}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onPress={handlePasteLink}
                  loading={pasting}
                  disabled={!profileLink.trim()}
                >
                  Paste link
                </Button>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
