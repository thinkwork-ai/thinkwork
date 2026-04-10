import { useState, useEffect } from "react";
import {
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Scan } from "lucide-react-native";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text, H2 } from "@/components/ui/typography";
import { useAuth } from "@/lib/auth-context";
import { useBiometricAuth, getBiometricName } from "@/hooks/useBiometricAuth";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";

function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <Path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <Path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <Path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </Svg>
  );
}

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, signInWithGoogle } = useAuth();
  const {
    isSupported: biometricSupported,
    hasStoredCredentials,
    biometricType,
    getStoredCredentials,
    isLoading: biometricLoading,
    refreshCredentialsCheck,
    storeCredentials,
  } = useBiometricAuth();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [biometricLoading2, setBiometricLoading2] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const biometricName = getBiometricName(biometricType);

  useEffect(() => {
    refreshCredentialsCheck();
  }, []);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter email and password");
      return;
    }

    setLoading(true);
    setError(null);

    const trimmedEmail = email.trim();
    const currentPassword = password;

    try {
      await signIn(trimmedEmail, currentPassword);

      // Store credentials so _layout can show the biometric enable prompt
      // after navigation (Alert gets dismissed if shown here due to route change)
      if (biometricSupported && !hasStoredCredentials && Platform.OS !== "web") {
        await storeCredentials(trimmedEmail, currentPassword);
      }
      // Redirect will happen automatically via _layout
    } catch (err) {
      console.error("[sign-in] error:", err);
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      if (lower.includes("invalid") || lower.includes("password") || lower.includes("credentials") || lower.includes("user")) {
        setError("Invalid email or password");
      } else if (lower.includes("not configured") || lower.includes("network")) {
        setError("Unable to connect. Please check your connection.");
      } else {
        setError(message || "Unable to sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      console.error("[sign-in] Google OAuth error:", err);
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "Google sign-in failed. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    setBiometricLoading2(true);
    setError(null);

    try {
      const credentials = await getStoredCredentials();

      if (credentials) {
        await signIn(credentials.email, credentials.password);
      } else {
        setError(`${biometricName} authentication failed`);
      }
    } catch (err) {
      setError("Unable to sign in. Please try again.");
    } finally {
      setBiometricLoading2(false);
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
            <View className="mb-2">
              <Image
                source={require("@/assets/icon.png")}
                style={{ width: 80, height: 80, borderRadius: 16 }}
              />
            </View>
            <CardTitle className="pb-2">
              <H2 className="tracking-wider" numberOfLines={1} adjustsFontSizeToFit>Thinkwork</H2>
            </CardTitle>
          </CardHeader>

          <CardContent className="gap-4">
            {biometricSupported && hasStoredCredentials && !biometricLoading && Platform.OS !== "web" && (
              <Button
                variant="outline"
                onPress={handleBiometricLogin}
                loading={biometricLoading2}
                className="mb-2"
              >
                <View className="flex-row items-center">
                  <Scan size={20} color={colors.foreground} />
                  <Text className="ml-2 text-neutral-900 dark:text-neutral-100 font-semibold">
                    Sign in with {biometricName}
                  </Text>
                </View>
              </Button>
            )}

            <Button
              variant="outline"
              onPress={handleGoogleSignIn}
              loading={googleLoading}
            >
              <View className="flex-row items-center">
                <GoogleIcon size={20} />
                <Text className="ml-2 text-neutral-900 dark:text-neutral-100 font-semibold">
                  Continue with Google
                </Text>
              </View>
            </Button>

            <View className="flex-row items-center my-2">
              <View className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
              <Text className="mx-4 text-neutral-400 dark:text-neutral-500 text-sm">or</Text>
              <View className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />
            </View>

            <Input
              label="Email"
              placeholder="your@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View>
              <Input
                label="Password"
                placeholder="••••••••"
                value={password}
                onChangeText={setPassword}
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

            {error && (
              <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                <Text size="sm" className="text-destructive">
                  {error}
                </Text>
              </View>
            )}

            <Button onPress={handleSubmit} loading={loading}>
              Sign in
            </Button>

            <Pressable
              className="pt-1"
              onPress={() => router.push("/forgot-password")}
            >
              <Text size="sm" variant="muted" className="text-center">
                Forgot password?
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.push("/onboarding/payment")}
            >
              <Text size="sm" variant="muted" className="text-center">
                Don't have an account? Sign up
              </Text>
            </Pressable>
          </CardContent>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
