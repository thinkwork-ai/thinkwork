import { useState } from "react";
import {
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { useAuth } from "@/lib/auth-context";

export default function SignUpScreen() {
  const router = useRouter();
  const { plan } = useLocalSearchParams<{ plan?: string }>();
  const { signUp } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email");
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
    if (!invitationCode.trim()) {
      setError("Please enter your invitation code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Cognito signUp flow — sends verification code to email
      await signUp(email.trim(), password, name.trim());

      // Navigate to verification screen (pass credentials along)
      router.replace(
        `/onboarding/verify-code?email=${encodeURIComponent(email.trim())}&password=${encodeURIComponent(password)}&name=${encodeURIComponent(name.trim())}&plan=${plan || "basic"}`
      );
    } catch (err: unknown) {
      console.error("Sign up error:", err);
      const message = err instanceof Error ? err.message : "Unable to create account. Please try again.";
      setError(message);
      setLoading(false);
    }
  };

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
                  source={require("@/assets/icon.png")}
                  style={{ width: 64, height: 64, borderRadius: 12 }}
                />
              </View>
              <CardTitle>
                <H2 className="tracking-wider uppercase text-center">Create Account</H2>
              </CardTitle>
              <CardDescription>
                <Muted className="text-center">
                  Get started with Thinkwork
                </Muted>
              </CardDescription>
            </CardHeader>

            <CardContent className="gap-3">
              <Input
                label="Name"
                placeholder="Your name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
                returnKeyType="next"
              />

              <Input
                label="Email"
                placeholder="your@email.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
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
                returnKeyType="next"
              />

              <Input
                label="Invitation Code"
                placeholder="Enter your invitation code"
                value={invitationCode}
                onChangeText={setInvitationCode}
                autoCapitalize="characters"
                autoCorrect={false}
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
                Continue
              </Button>

              <Pressable
                className="py-2"
                onPress={() => router.back()}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text size="sm" variant="muted" className="text-center">
                  Back to Plans
                </Text>
              </Pressable>

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
