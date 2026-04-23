import { useState } from "react";
import {
  View,
  Image,
  ScrollView,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CheckCircle, Star } from "lucide-react-native";
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
import { plans, type Plan, type PlanId } from "@thinkwork/pricing-config";
import { startStripeCheckout } from "@/lib/stripe-checkout";

export default function PaymentScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [pendingPlanId, setPendingPlanId] = useState<PlanId | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handlePlanPress(plan: Plan) {
    if (pendingPlanId) return;
    setErrorMessage(null);
    setPendingPlanId(plan.id);

    try {
      const result = await startStripeCheckout(plan.id);
      if (result.status === "completed") {
        router.replace(
          `/onboarding/complete?session_id=${encodeURIComponent(result.sessionId)}&paid=1`,
        );
        return;
      }
      if (result.status === "error") {
        setErrorMessage(result.message);
        return;
      }
      // cancel / dismiss / locked: user explicitly backed out — no banner.
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Could not start checkout",
      );
    } finally {
      setPendingPlanId(null);
    }
  }

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
        <Card
          className={`w-full self-center ${isWide ? "max-w-4xl" : "max-w-lg"}`}
        >
          <CardHeader className="items-center pb-4">
            <View className="mb-3">
              <Image
                source={require("@/assets/logo.png")}
                style={{ width: 80, height: 64 }}
                resizeMode="contain"
              />
            </View>
            <CardTitle>
              <H2
                className="tracking-wider text-center"
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                Pick your plan
              </H2>
            </CardTitle>
            <CardDescription>
              <Muted className="text-center">
                Infrastructure you own. Plans that scale with usage.
              </Muted>
            </CardDescription>
          </CardHeader>

          <CardContent className="gap-4">
            <View
              className={
                isWide ? "flex-row gap-4 items-stretch" : "gap-4"
              }
            >
              {plans.map((plan) => {
                const isPending = pendingPlanId === plan.id;
                const isDisabled =
                  pendingPlanId !== null && pendingPlanId !== plan.id;
                return (
                  <Pressable
                    key={plan.id}
                    onPress={() => handlePlanPress(plan)}
                    disabled={isDisabled || isPending}
                    style={isWide ? { flex: 1 } : undefined}
                  >
                    <View
                      className={`rounded-xl border-2 p-4 ${isWide ? "flex-1 " : ""}${
                        plan.highlighted
                          ? "border-primary bg-primary/5"
                          : "border-neutral-200 dark:border-neutral-700"
                      }${isDisabled ? " opacity-40" : ""}`}
                    >
                      <View className="flex-row items-center justify-between mb-3">
                        <View className="flex-row items-center">
                          <Text className="font-bold text-lg">
                            {plan.name}
                          </Text>
                        </View>
                        {plan.highlighted && (
                          <View className="bg-primary px-3 py-1.5 rounded-full flex-row items-center gap-1">
                            <Star size={12} color={colors.background} />
                            <Text className="text-white text-xs font-semibold">
                              RECOMMENDED
                            </Text>
                          </View>
                        )}
                      </View>

                      <Text
                        size="sm"
                        variant="muted"
                        className="font-semibold uppercase tracking-wider mb-3"
                      >
                        {plan.tagline}
                      </Text>
                      <Text size="sm" className="mb-4">
                        {plan.summary}
                      </Text>

                      <View className="gap-2 mb-4">
                        {plan.features.map((feature) => (
                          <View
                            key={feature}
                            className="flex-row items-start"
                          >
                            <View style={{ minWidth: 16, marginTop: 2 }}>
                              <CheckCircle
                                size={16}
                                color={colors.primary}
                              />
                            </View>
                            <Text className="ml-2 text-sm flex-1">
                              {feature}
                            </Text>
                          </View>
                        ))}
                      </View>

                      <Button
                        size="default"
                        variant={plan.highlighted ? "default" : "outline"}
                        onPress={() => handlePlanPress(plan)}
                        disabled={isDisabled || isPending}
                      >
                        {isPending ? (
                          <View className="flex-row items-center gap-2">
                            <ActivityIndicator
                              size="small"
                              color={colors.background}
                            />
                            <Text>Opening checkout…</Text>
                          </View>
                        ) : (
                          <Text>{plan.cta}</Text>
                        )}
                      </Button>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {errorMessage && (
              <View className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                <Text size="sm" className="text-red-300 text-center">
                  {errorMessage}
                </Text>
                <Text
                  size="xs"
                  variant="muted"
                  className="text-center mt-1"
                >
                  Tap a plan to retry, or email hello@thinkwork.ai.
                </Text>
              </View>
            )}

            <View className={isWide ? "items-center" : ""}>
              <Text
                size="xs"
                variant="muted"
                className="text-center leading-5 px-2 mt-2"
              >
                Every plan deploys into your AWS account. Prices are in
                USD, billed monthly. Cancel anytime.
              </Text>

              <Pressable
                className="py-2 mt-1"
                onPress={() => router.replace("/sign-in")}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text size="sm" variant="muted" className="text-center">
                  Already have an account? Sign in.
                </Text>
              </Pressable>
            </View>
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
