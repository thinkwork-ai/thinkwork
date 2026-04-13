import { useState } from "react";
import {
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text, H2, Muted } from "@/components/ui/typography";

export default function AcceptInvitationScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  // TODO: Migrate invitation queries to GraphQL
  const invitation = undefined as any; // Stub
  const acceptInvite = async (args: any) => { console.log("TODO: acceptInvite", args); };

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    if (!password.trim()) {
      setError("Please enter a password");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await acceptInvite({
        token: token!,
        name: name.trim(),
        password,
      });
      setAccepted(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(message);
      setLoading(false);
    }
  };

  // Success state (check BEFORE expired — acceptInvite marks it used, triggering reactive update)
  if (accepted) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
        <View className="flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-md self-center">
            <CardHeader className="items-center pb-4">
              <View className="mb-3">
                <Image
                  source={require("@/assets/logo.png")}
                  style={{ width: 80, height: 64 }}
                  resizeMode="contain"
                />
              </View>
              <CardTitle>
                <H2 className="tracking-wider uppercase text-center">Welcome!</H2>
              </CardTitle>
              <CardDescription>
                <Muted className="text-center">
                  Your account has been created. Sign in to get started.
                </Muted>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onPress={() => router.replace("/sign-in")} size="lg">
                Sign In
              </Button>
            </CardContent>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  // Loading state
  if (invitation === undefined) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950 items-center justify-center">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  // Invalid or expired
  if (invitation === null || invitation.expired) {
    return (
      <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
        <View className="flex-1 items-center justify-center p-4">
          <Card className="w-full max-w-md self-center">
            <CardHeader className="items-center pb-4">
              <View className="mb-3">
                <Image
                  source={require("@/assets/logo.png")}
                  style={{ width: 80, height: 64 }}
                  resizeMode="contain"
                />
              </View>
              <CardTitle>
                <H2 className="tracking-wider uppercase text-center">
                  Invitation {invitation?.expired ? "Expired" : "Not Found"}
                </H2>
              </CardTitle>
              <CardDescription>
                <Muted className="text-center">
                  {invitation?.expired
                    ? "This invitation has expired or has already been used."
                    : "This invitation link is invalid. Please check with the person who invited you."}
                </Muted>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onPress={() => router.replace("/sign-in")} size="lg">
                Go to Sign In
              </Button>
            </CardContent>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  // Accept form
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 16,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card className="w-full max-w-md self-center">
            <CardHeader className="items-center pb-4">
              <View className="mb-3">
                <Image
                  source={require("@/assets/logo.png")}
                  style={{ width: 80, height: 64 }}
                  resizeMode="contain"
                />
              </View>
              <CardTitle>
                <H2 className="tracking-wider uppercase text-center">You're Invited!</H2>
              </CardTitle>
              <CardDescription>
                <Muted className="text-center">
                  Join <Text className="font-semibold">{invitation.tenantName}</Text> on
                  ThinkWork
                </Muted>
              </CardDescription>
            </CardHeader>

            <CardContent className="gap-3">
              <Input
                label="Email"
                value={invitation.email}
                editable={false}
                containerClassName="opacity-60"
              />

              <Input
                label="Name"
                placeholder="Your name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                autoFocus
              />

              <View>
                <Input
                  label="Password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="next"
                />
                <Pressable
                  className="absolute right-3 top-9 p-2"
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text size="sm" variant="muted">
                    {showPassword ? "Hide" : "Show"}
                  </Text>
                </Pressable>
              </View>

              <Input
                label="Confirm Password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />

              {error && (
                <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                  <Text size="sm" className="text-destructive">
                    {error}
                  </Text>
                </View>
              )}

              <Button onPress={handleSubmit} loading={loading} size="lg" className="mt-2">
                Accept & Create Account
              </Button>

              <Pressable
                className="py-2"
                onPress={() => router.replace("/sign-in")}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text size="sm" variant="muted" className="text-center">
                  Already have an account? Sign in.
                </Text>
              </Pressable>
            </CardContent>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
