import { useState } from "react";
import {
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import {
  CognitoUser,
  CognitoUserPool,
} from "amazon-cognito-identity-js";
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

type Step = "email" | "reset";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  // Cognito forgot-password flow
  const pool = new CognitoUserPool({
    UserPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID || "",
    ClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || "",
  });

  const sendCode = async ({ email: e }: { email: string }) => {
    return new Promise<void>((resolve, reject) => {
      const user = new CognitoUser({ Username: e, Pool: pool });
      user.forgotPassword({
        onSuccess: () => resolve(),
        onFailure: (err) => reject(err),
      });
    });
  };

  const resetPasswordFn = async ({ email: e, code: c, newPassword: p }: { email: string; code: string; newPassword: string }) => {
    return new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
      const user = new CognitoUser({ Username: e, Pool: pool });
      user.confirmPassword(c, p, {
        onSuccess: () => resolve({ success: true }),
        onFailure: (err) => resolve({ success: false, error: err.message }),
      });
    });
  };

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSendCode = async () => {
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await sendCode({ email: email.trim() } as any);
      setStep("reset");
    } catch (err) {
      setError("Failed to send verification code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!code.trim()) {
      setError("Please enter the verification code");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await resetPasswordFn({
        email: email.trim(),
        code: code.trim(),
        newPassword,
      });

      if (result.success) {
        router.replace("/sign-in");
      } else {
        setError(result.error ?? "Failed to reset password");
      }
    } catch (err) {
      setError("Failed to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-neutral-950"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card className="w-[90%] max-w-md">
          <CardHeader className="items-center">
            <CardTitle>
              <H2 className="tracking-wider uppercase">Reset Password</H2>
            </CardTitle>
            <CardDescription>
              <Muted className="text-center">
                {step === "email"
                  ? "Enter your email to receive a reset code"
                  : "Enter the code and your new password"}
              </Muted>
            </CardDescription>
          </CardHeader>

          <CardContent className="gap-4">
            {step === "email" ? (
              <>
                <Input
                  label="Email"
                  placeholder="your@email.com"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {error && (
                  <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                    <Text size="sm" className="text-destructive">
                      {error}
                    </Text>
                  </View>
                )}

                <Button onPress={handleSendCode} loading={loading}>
                  Send Reset Code
                </Button>
              </>
            ) : (
              <>
                <Input
                  label="Verification Code"
                  placeholder="123456"
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                />

                <View>
                  <Input
                    label="New Password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                  />
                  <Pressable
                    className="absolute right-4"
                    style={{ top: 42 }}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Text size="base" variant="muted">
                      {showPassword ? "Hide" : "Show"}
                    </Text>
                  </Pressable>
                </View>

                <Input
                  label="Confirm Password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />

                {error && (
                  <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                    <Text size="sm" className="text-destructive">
                      {error}
                    </Text>
                  </View>
                )}

                <Button onPress={handleResetPassword} loading={loading}>
                  Reset Password
                </Button>

                <Pressable className="py-2" onPress={handleSendCode}>
                  <Text size="sm" variant="muted" className="text-center">
                    Didn't receive a code? Resend
                  </Text>
                </Pressable>
              </>
            )}

            <Pressable
              className="py-3"
              onPress={() => router.back()}
            >
              <Text size="sm" variant="muted" className="text-center">
                Back to sign in
              </Text>
            </Pressable>
          </CardContent>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
