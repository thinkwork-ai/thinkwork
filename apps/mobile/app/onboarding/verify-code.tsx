import { useState, useRef, useEffect } from "react";
import {
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Text, H2, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";

export default function VerifyCodeScreen() {
  const router = useRouter();
  const { email, password, name, plan } = useLocalSearchParams<{
    email: string;
    password: string;
    name: string;
    plan: string;
  }>();
  const { confirmSignUp, signIn } = useAuth();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleCodeChange = (index: number, value: string) => {
    // Handle paste of full code
    if (value.length > 1) {
      const digits = value.replace(/\D/g, "").slice(0, 6).split("");
      const newCode = [...code];
      digits.forEach((d, i) => {
        if (index + i < 6) newCode[index + i] = d;
      });
      setCode(newCode);
      const nextIndex = Math.min(index + digits.length, 5);
      inputRefs.current[nextIndex]?.focus();
      
      // Auto-submit if all 6 digits filled
      if (newCode.every((d) => d !== "")) {
        handleVerify(newCode.join(""));
      }
      return;
    }

    const newCode = [...code];
    newCode[index] = value.replace(/\D/g, "");
    setCode(newCode);

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when last digit entered
    if (value && index === 5 && newCode.every((d) => d !== "")) {
      handleVerify(newCode.join(""));
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newCode = [...code];
      newCode[index - 1] = "";
      setCode(newCode);
    }
  };

  const handleVerify = async (codeStr?: string) => {
    const fullCode = codeStr || code.join("");
    if (fullCode.length !== 6) {
      setError("Please enter the full 6-digit code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Cognito: confirm sign-up with verification code, then sign in
      await confirmSignUp(email!.trim(), fullCode);
      await signIn(email!.trim(), password!);

      router.replace(`/onboarding/complete?plan=${plan || "basic"}`);
    } catch (err) {
      console.error("Verification error:", err);
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    try {
      // TODO: Cognito resendConfirmationCode
      // For now, the user can request a new code by re-signing up
      console.log("Resend code for:", email);
      setResendCooldown(60);
    } catch (err) {
      console.error("Resend error:", err);
      setError("Failed to resend code. Please try again.");
    } finally {
      setResending(false);
    }
  };

  const handleGoBack = () => {
    router.replace(`/sign-up?plan=${plan || "basic"}`);
  };

  const maskedEmail = email
    ? email.replace(/^(.{2})(.*)(@.*)$/, (_, a, b, c) => a + "•".repeat(b.length) + c)
    : "";

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
                <H2 className="tracking-wider uppercase text-center">
                  Verify Email
                </H2>
              </CardTitle>
              <CardDescription>
                <Muted className="text-center">
                  We sent a 6-digit code to{"\n"}
                  <Text size="sm" className="font-medium">
                    {maskedEmail}
                  </Text>
                </Muted>
              </CardDescription>
            </CardHeader>

            <CardContent className="gap-6">
              {/* Code Input */}
              <View className="flex-row justify-center gap-2">
                {code.map((digit, index) => (
                  <TextInput
                    key={index}
                    ref={(ref) => {
                      inputRefs.current[index] = ref;
                    }}
                    value={digit}
                    onChangeText={(value) => handleCodeChange(index, value)}
                    onKeyPress={({ nativeEvent }) =>
                      handleKeyPress(index, nativeEvent.key)
                    }
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    style={{
                      width: 44,
                      height: 52,
                      borderRadius: 10,
                      borderWidth: 1.5,
                      borderColor: digit
                        ? colors.primary
                        : colorScheme === "dark"
                        ? "#404040"
                        : "#d4d4d4",
                      backgroundColor:
                        colorScheme === "dark" ? "#171717" : "#fafafa",
                      color: colorScheme === "dark" ? "#fff" : "#111",
                      fontSize: 22,
                      fontWeight: "600",
                      textAlign: "center",
                    }}
                  />
                ))}
              </View>

              {error && (
                <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                  <Text size="sm" className="text-destructive text-center">
                    {error}
                  </Text>
                </View>
              )}

              <Button
                onPress={() => handleVerify()}
                loading={loading}
                size="lg"
                disabled={code.some((d) => !d)}
              >
                Verify & Continue
              </Button>

              {/* Resend */}
              <View className="items-center">
                {resendCooldown > 0 ? (
                  <Text size="sm" variant="muted">
                    Resend code in {resendCooldown}s
                  </Text>
                ) : (
                  <Pressable
                    onPress={handleResend}
                    disabled={resending}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Text
                      size="sm"
                      className="font-medium"
                      style={{ color: colors.primary }}
                    >
                      {resending ? "Sending..." : "Resend code"}
                    </Text>
                  </Pressable>
                )}
              </View>

              <Pressable
                onPress={handleGoBack}
                className="py-2"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text size="sm" variant="muted" className="text-center">
                  ← Back to Create Account
                </Text>
              </Pressable>
            </CardContent>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
