import { useState } from "react";
import { View, Image, ScrollView, Pressable, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CheckCircle, User, Zap, Building2, Mail } from "lucide-react-native";
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

type PlanType = "basic" | "pro" | "enterprise";

export default function PaymentScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [selectedPlan, setSelectedPlan] = useState<PlanType>("basic");

  const handleContinue = () => {
    if (selectedPlan === "enterprise") {
      // TODO: open contact form or email
      return;
    }
    router.push(`/sign-up?plan=${selectedPlan}`);
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
        <Card className={`w-full self-center ${isWide ? "max-w-4xl" : "max-w-lg"}`}>
          <CardHeader className="items-center pb-4">
            <View className="mb-3">
              <Image
                source={require("@/assets/icon.png")}
                style={{ width: 64, height: 64, borderRadius: 12 }}
              />
            </View>
            <CardTitle>
              <H2 className="tracking-wider text-center" numberOfLines={1} adjustsFontSizeToFit>Welcome to Thinkwork</H2>
            </CardTitle>
            <CardDescription>
              <Muted className="text-center">
                Choose your plan to get started
              </Muted>
            </CardDescription>
          </CardHeader>

          <CardContent className="gap-4">
            <View className={isWide ? "flex-row gap-4 items-stretch" : "gap-4"}>
              {/* Basic Plan Card */}
              <Pressable onPress={() => setSelectedPlan("basic")} style={isWide ? { flex: 1 } : undefined}>
                <View
                  className={`rounded-xl border-2 p-4 ${isWide ? "flex-1 " : ""}${
                    selectedPlan === "basic"
                      ? "border-primary bg-primary/5"
                      : "border-neutral-200 dark:border-neutral-700"
                  }`}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center">
                      <User size={20} color={selectedPlan === "basic" ? colors.primary : colors.muted} />
                      <Text className="ml-2 font-bold text-lg">Pro</Text>
                    </View>
                    {selectedPlan === "basic" && (
                      <View className="bg-primary px-3 py-1.5 rounded-full">
                        <Text className="text-white text-xs font-semibold">
                          SELECTED
                        </Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className="text-3xl font-bold">
                      $49
                      <Text className="text-base font-normal text-neutral-500">
                        /month
                      </Text>
                    </Text>
                  </View>

                  <View className="gap-2">
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">1 hosted AI agent</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Unlimited threads</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Agent file browser</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Real-time sync across devices</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Connect via Telegram, Discord, Slack</Text>
                    </View>
                  </View>
                </View>
              </Pressable>

              {/* Pro Plan Card */}
              <Pressable onPress={() => setSelectedPlan("pro")} style={isWide ? { flex: 1 } : undefined}>
                <View
                  className={`rounded-xl border-2 p-4 ${isWide ? "flex-1 " : ""}${
                    selectedPlan === "pro"
                      ? "border-primary bg-primary/5"
                      : "border-neutral-200 dark:border-neutral-700"
                  }`}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center">
                      <Zap size={20} color={selectedPlan === "pro" ? colors.primary : colors.muted} />
                      <Text className="ml-2 font-bold text-lg">Business</Text>
                    </View>
                    {selectedPlan === "pro" && (
                      <View className="bg-primary px-3 py-1.5 rounded-full">
                        <Text className="text-white text-xs font-semibold">
                          SELECTED
                        </Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <Text className="text-3xl font-bold">
                      $199
                      <Text className="text-base font-normal text-neutral-500">
                        /month
                      </Text>
                    </Text>
                  </View>

                  <View className="gap-2">
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Everything in Pro</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Multiple hosted agents</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">BYOB — connect your own OpenClaw</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Thread routing to specific agents</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Invite codes for external agents</Text>
                    </View>
                  </View>
                </View>
              </Pressable>

              {/* Enterprise Plan Card */}
              <Pressable onPress={() => setSelectedPlan("enterprise")} style={isWide ? { flex: 1 } : undefined}>
                <View
                  className={`rounded-xl border-2 p-4 ${isWide ? "flex-1 " : ""}${
                    selectedPlan === "enterprise"
                      ? "border-primary bg-primary/5"
                      : "border-neutral-200 dark:border-neutral-700"
                  }`}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <View className="flex-row items-center">
                      <Building2 size={20} color={selectedPlan === "enterprise" ? colors.primary : colors.muted} />
                      <Text className="ml-2 font-bold text-lg">Enterprise</Text>
                    </View>
                    {selectedPlan === "enterprise" && (
                      <View className="bg-primary px-3 py-1.5 rounded-full">
                        <Text className="text-white text-xs font-semibold">
                          SELECTED
                        </Text>
                      </View>
                    )}
                  </View>

                  <View className="mb-4">
                    <View className="flex-row items-center">
                      <Mail size={18} color={colors.foreground} />
                      <Text className="ml-2 text-lg font-bold">Contact Us</Text>
                    </View>
                  </View>

                  <View className="gap-2">
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Everything in Business</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Dedicated infrastructure</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Team Memory — cross-agent knowledge</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">Priority support</Text>
                    </View>
                    <View className="flex-row items-center">
                      <View style={{ minWidth: 16 }}><CheckCircle size={16} color={colors.primary} /></View>
                      <Text className="ml-2 text-sm">SSO/SAML, audit logging (coming soon)</Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            </View>

            <View className={isWide ? "items-center" : ""}>
              <View className={isWide ? "w-64" : ""}>
                <Button onPress={handleContinue} size={isWide ? "default" : "lg"}>
                  {selectedPlan === "enterprise" ? "Contact Sales" : "Create Account"}
                </Button>
              </View>

              <Text size="xs" variant="muted" className="text-center leading-5 px-2 mt-4">
                By continuing, you agree to our Terms of Service and Privacy
                Policy. You can cancel anytime.
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
