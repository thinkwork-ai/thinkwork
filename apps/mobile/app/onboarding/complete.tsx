import { useEffect, useState, useRef } from "react";
import { View, Image, Animated, Pressable, Modal, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Loader2, XCircle, AlertTriangle } from "lucide-react-native";
import { Text, H2, Muted } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";
import { useAuth } from "@/lib/auth-context";
import { useUpdateTenant } from "@/lib/hooks/use-tenants";
import { useAgents } from "@/lib/hooks/use-agents";

export default function CompleteScreen() {
  const router = useRouter();
  const { plan } = useLocalSearchParams<{ plan?: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { isAuthenticated, isLoading: authLoading, signOut, user } = useAuth();
  const tenantId = (user as any)?.tenantId;

  const [, executeUpdateTenant] = useUpdateTenant();

  const selectedPlan = plan === "enterprise" ? "enterprise" : plan === "pro" ? "pro" : "basic";

  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelText, setCancelText] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const hasStarted = useRef(false);

  // Poll agent status — only after tenant is created
  const hasTenant = !!tenantId;
  const [{ data: agentsData }] = useAgents(hasTenant ? tenantId : undefined);
  const agents = agentsData?.agents;
  const beacon = agents?.find((a: any) => a.role === "team");
  const isOnline = (beacon as any)?.connectionStatus === "online" || beacon?.status === "active";

  // Spinning animation
  const spinValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: true,
      })
    ).start();
  }, []);
  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  // Trigger tenant creation
  useEffect(() => {
    if (authLoading || !isAuthenticated || hasStarted.current) return;
    hasStarted.current = true;

    (async () => {
      try {
        setProvisioning(true);
        if (tenantId) {
          await executeUpdateTenant({
            id: tenantId,
            input: { plan: selectedPlan },
          });
        }
        // TODO: ensureTenant mutation not yet available via GraphQL — tenant provisioning may need a dedicated mutation
      } catch (err) {
        console.error("Provisioning error:", err);
        setError("Something went wrong. Please try again.");
        setProvisioning(false);
      }
    })();
  }, [authLoading, isAuthenticated]);

  // Navigate to dashboard when online
  useEffect(() => {
    if (isOnline) {
      router.replace("/");
    }
  }, [isOnline]);

  const handleCancelSetup = async () => {
    setCancelling(true);
    try {
      // TODO: cancelSubscription mutation not yet available via GraphQL
    } catch (err) {
      console.error("Cancel error:", err);
    }
    try {
      signOut();
    } catch (err) {
      console.error("Signout error:", err);
    }
    // Small delay to let layout unmount cleanly before navigating
    setTimeout(() => router.replace("/sign-in"), 100);
  };

  const handleRetry = () => {
    setError(null);
    hasStarted.current = false;
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <View className="flex-1 items-center justify-center px-6">
        {/* Logo */}
        <View className="mb-8">
          <Image
            source={require("@/assets/logo.png")}
            style={{ width: 100, height: 80 }}
            resizeMode="contain"
          />
        </View>

        {error ? (
          <>
            <H2 className="text-center mb-3">Setup Failed</H2>
            <Muted className="text-center mb-6">{error}</Muted>
            <Button onPress={handleRetry} size="lg" className="w-full max-w-xs">
              Try Again
            </Button>
            <Pressable onPress={() => { signOut(); router.replace("/sign-in"); }} className="mt-4 py-2">
              <Text size="sm" variant="muted">Back to Sign In</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* Spinner */}
            <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 24 }}>
              <Loader2 size={32} color={colors.primary} />
            </Animated.View>

            <H2 className="text-center mb-3">Setting Up Your Team</H2>

            <Muted className="text-center mb-2 px-4 leading-5">
              This typically takes 3-5 minutes.
            </Muted>
            <Muted className="text-center px-4 leading-5">
              You'll receive an email when your agent is online and ready.
            </Muted>

            {/* Cancel Setup Link */}
            <Pressable
              onPress={() => { setShowCancelConfirm(true); setCancelText(""); }}
              className="mt-10 py-2 opacity-50"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View className="flex-row items-center gap-1.5">
                <XCircle size={14} color={colors.muted} />
                <Text size="xs" variant="muted" className="tracking-wider uppercase">
                  Cancel Setup
                </Text>
              </View>
            </Pressable>
          </>
        )}
      </View>

      {/* Cancel Setup Modal */}
      <Modal
        visible={showCancelConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => !cancelling && setShowCancelConfirm(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 px-6">
          <View
            className="w-full max-w-sm rounded-xl p-6 border"
            style={{
              backgroundColor: colorScheme === "dark" ? "#171717" : "#fff",
              borderColor: colorScheme === "dark" ? "#404040" : "#e5e5e5",
            }}
          >
            <View className="items-center mb-4">
              <AlertTriangle size={40} color="#ef4444" />
            </View>
            <Text className="text-lg font-bold text-center text-neutral-900 dark:text-neutral-100 mb-2">
              Cancel Setup?
            </Text>
            <Text className="text-sm text-center text-neutral-600 dark:text-neutral-400 mb-4">
              This will permanently cancel your account setup and delete all data. This action cannot be undone.
            </Text>
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Type <Text className="font-bold text-red-600 dark:text-red-400">CANCEL SETUP</Text> to confirm:
            </Text>
            <Input
              value={cancelText}
              onChangeText={setCancelText}
              placeholder="CANCEL SETUP"
              autoFocus
              autoCapitalize="characters"
            />
            <Pressable
              onPress={handleCancelSetup}
              disabled={cancelText !== "CANCEL SETUP" || cancelling}
              style={{
                backgroundColor: cancelText === "CANCEL SETUP" && !cancelling ? "#dc2626" : "#d4d4d4",
                paddingVertical: 14,
                borderRadius: 10,
                alignItems: "center",
                marginTop: 16,
                width: "100%",
                opacity: cancelText !== "CANCEL SETUP" || cancelling ? 0.5 : 1,
              }}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                  Cancel Setup
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setShowCancelConfirm(false)}
              disabled={cancelling}
              style={{ paddingVertical: 12, alignItems: "center", marginTop: 8, width: "100%" }}
            >
              <Text className="font-medium text-neutral-500 dark:text-neutral-400">
                Go Back
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
