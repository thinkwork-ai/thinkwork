import { useEffect, useRef, useState } from "react";
import {
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Scan } from "lucide-react-native";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text, H2 } from "@/components/ui/typography";
import {
  AuthOptions,
  useAuthOptions,
} from "@/components/auth/AuthOptions";
import {
  EnvironmentPickerSheet,
  type EnvironmentPickerSheetRef,
} from "@/components/environments/EnvironmentPicker";
import { useAuth } from "@/lib/auth-context";
import { useBiometricAuth, getBiometricName } from "@/hooks/useBiometricAuth";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";
import { deriveAuthOptionsDisplay } from "@/lib/auth-options";
import { environmentFooterLabel } from "@/lib/environments/display";
import {
  getActiveEnvironmentEntry,
  subscribeEnvironmentStore,
} from "@/lib/environments/store";

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, deploymentConfig } = useAuth();
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
  const environmentSheetRef = useRef<EnvironmentPickerSheetRef>(null);
  const [activeEnvironment, setActiveEnvironment] = useState(() =>
    getActiveEnvironmentEntry(),
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [biometricLoading2, setBiometricLoading2] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const authOptions = useAuthOptions(deploymentConfig.apiUrl);
  const authDisplay = deriveAuthOptionsDisplay(authOptions.state);

  const biometricName = getBiometricName(biometricType);
  const configBlocked = !deploymentConfig.configured;
  const footerLabel = environmentFooterLabel(
    activeEnvironment,
    deploymentConfig,
  );

  useEffect(() => {
    refreshCredentialsCheck();
  }, [refreshCredentialsCheck]);

  useEffect(() => {
    const unsubscribe = subscribeEnvironmentStore((snapshot) => {
      setActiveEnvironment(snapshot.activeEntry);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter email and password");
      return;
    }
    if (configBlocked) {
      setError(
        `Deployment configuration is incomplete: ${deploymentConfig.missing.join(", ")}`,
      );
      return;
    }

    setLoading(true);
    setError(null);

    const trimmedEmail = email.trim();
    const currentPassword = password;

    try {
      await signIn(trimmedEmail, currentPassword);

      if (
        biometricSupported &&
        !hasStoredCredentials &&
        Platform.OS !== "web"
      ) {
        await storeCredentials(trimmedEmail, currentPassword);
      }
    } catch (err) {
      console.error("[sign-in] error:", err);
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      if (
        lower.includes("invalid") ||
        lower.includes("password") ||
        lower.includes("credentials") ||
        lower.includes("user")
      ) {
        setError("Invalid email or password");
      } else if (
        lower.includes("not configured") ||
        lower.includes("network")
      ) {
        setError("Unable to connect. Please check your connection.");
      } else {
        setError(message || "Unable to sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (configBlocked) {
      setError(
        `Deployment configuration is incomplete: ${deploymentConfig.missing.join(", ")}`,
      );
      return;
    }
    setBiometricLoading2(true);
    setError(null);

    try {
      const credentials = await getStoredCredentials();

      if (credentials) {
        await signIn(credentials.email, credentials.password);
      } else {
        setError(`${biometricName} authentication failed`);
      }
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setBiometricLoading2(false);
    }
  };

  const handleSsoPress = () => {
    console.log("[sign-in] WorkOS SSO is declared but U5 wires the flow.");
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white dark:bg-neutral-950"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Card className="w-[90%] max-w-md">
          <CardHeader className="items-center">
            <View className="mb-3">
              <Image
                source={require("@/assets/logo.png")}
                style={{ width: 96, height: 78 }}
                resizeMode="contain"
              />
            </View>
            <H2 className="text-center" numberOfLines={1} adjustsFontSizeToFit>
              Log in to ThinkWork
            </H2>
          </CardHeader>

          <CardContent className="gap-4">
            <AuthOptions
              state={authOptions.state}
              onRetry={authOptions.retry}
              onPressSso={handleSsoPress}
              disabled={configBlocked}
            />

            {biometricSupported &&
              hasStoredCredentials &&
              !biometricLoading &&
              Platform.OS !== "web" && (
                <Button
                  variant="outline"
                  onPress={handleBiometricLogin}
                  loading={biometricLoading2}
                  disabled={configBlocked}
                >
                  <View className="flex-row items-center">
                    <Scan size={20} color={colors.foreground} />
                    <Text className="ml-2 text-neutral-900 dark:text-neutral-100 font-semibold">
                      Sign in with {biometricName}
                    </Text>
                  </View>
                </Button>
              )}

            {authDisplay.showPasswordForm && (
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

                <View>
                  <Input
                    label="Password"
                    placeholder="Password"
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

                <Button
                  onPress={handleSubmit}
                  loading={loading}
                  disabled={configBlocked}
                >
                  Sign in
                </Button>

                <Pressable
                  className="pt-1"
                  onPress={() => router.push("/forgot-password")}
                >
                  <Text size="sm" variant="muted" className="text-center">
                    Reset password
                  </Text>
                </Pressable>
              </>
            )}

            {authDisplay.showUnavailable && (
              <Text size="sm" variant="muted" className="text-center">
                Sign-in options are unavailable.
              </Text>
            )}

            {error && (
              <View className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                <Text size="sm" className="text-destructive">
                  {error}
                </Text>
              </View>
            )}

            <Pressable
              className="pt-2"
              onPress={() => environmentSheetRef.current?.present()}
            >
              <Text size="xs" variant="muted" className="text-center">
                {deploymentConfig.configured
                  ? footerLabel
                  : `Configuration incomplete for ${deploymentConfig.stage}`}
              </Text>
            </Pressable>
          </CardContent>
        </Card>
      </ScrollView>
      <EnvironmentPickerSheet ref={environmentSheetRef} />
    </KeyboardAvoidingView>
  );
}
