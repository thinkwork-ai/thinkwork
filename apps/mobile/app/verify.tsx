import { useEffect, useState, useRef } from "react";
import { View, Image, Animated, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth-context";
import { CheckCircle, XCircle, Loader2 } from "lucide-react-native";
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

export default function VerifyScreen() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const { confirmSignUp } = useAuth();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  // Spinning animation for loader
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  useEffect(() => {
    const verifyEmail = async () => {
      if (!token) {
        setStatus("error");
        setError("Invalid verification link");
        return;
      }

      try {
        // Verify the email using Cognito confirmSignUp
        // TODO: Need email from URL params or stored state
        await confirmSignUp("", token);
        
        setStatus("success");
      } catch (err) {
        console.error("Verification error:", err);
        setStatus("error");
        setError("This verification link is invalid or has expired.");
      }
    };

    verifyEmail();
  }, [token]);

  const handleContinue = () => {
    router.replace("/onboarding/payment");
  };

  const handleResend = () => {
    router.replace("/sign-up");
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 16,
        }}
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
                {status === "loading"
                  ? "Verifying..."
                  : status === "success"
                  ? "Email Verified!"
                  : "Verification Failed"}
              </H2>
            </CardTitle>
            <CardDescription>
              <Muted className="text-center">
                {status === "loading"
                  ? "Please wait while we verify your email"
                  : status === "success"
                  ? "Your email has been verified"
                  : "We couldn't verify your email"}
              </Muted>
            </CardDescription>
          </CardHeader>

          <CardContent className="gap-6 items-center">
            {/* Status Icon */}
            <View className="items-center justify-center py-4">
              {status === "loading" ? (
                <Animated.View style={{ transform: [{ rotate: spin }] }}>
                  <Loader2 size={64} color={colors.primary} />
                </Animated.View>
              ) : status === "success" ? (
                <CheckCircle size={64} color="#22c55e" />
              ) : (
                <XCircle size={64} color="#ef4444" />
              )}
            </View>

            {error && (
              <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 w-full">
                <Text size="sm" className="text-destructive text-center">
                  {error}
                </Text>
              </View>
            )}

            {status === "success" && (
              <Button onPress={handleContinue} size="lg" className="w-full">
                Continue to Payment
              </Button>
            )}

            {status === "error" && (
              <Button onPress={handleResend} variant="outline" size="lg" className="w-full">
                Try Again
              </Button>
            )}
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
