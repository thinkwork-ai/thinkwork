import { useState } from "react";
import { View, Image, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Mail, RefreshCw } from "lucide-react-native";
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

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleResend = async () => {
    setResending(true);
    // Simulate resend - in production this would call a resend endpoint
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setResending(false);
    setResent(true);
    setTimeout(() => setResent(false), 3000);
  };

  const handleChangeEmail = () => {
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
              <H2 className="tracking-wider uppercase text-center">Check Your Email</H2>
            </CardTitle>
            <CardDescription>
              <Muted className="text-center">
                We've sent you a verification link
              </Muted>
            </CardDescription>
          </CardHeader>

          <CardContent className="gap-5 items-center">
            {/* Mail Icon */}
            <View className="w-20 h-20 rounded-full bg-primary/10 items-center justify-center">
              <Mail size={40} color={colors.primary} />
            </View>

            <View className="gap-3 px-2">
              <Text className="text-center leading-6">
                Click the link in your email to verify your account and continue
                setting up ThinkWork.
              </Text>
              <Text size="sm" variant="muted" className="text-center">
                Don't see it? Check your spam folder.
              </Text>
            </View>

            {resent && (
              <View className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 w-full">
                <Text size="sm" className="text-green-600 dark:text-green-400 text-center">
                  Verification email resent!
                </Text>
              </View>
            )}

            <View className="w-full gap-3 mt-2">
              <Button
                onPress={handleResend}
                variant="outline"
                size="lg"
                loading={resending}
                disabled={resent}
              >
                <View className="flex-row items-center justify-center">
                  <RefreshCw size={18} color={colors.foreground} />
                  <Text className="ml-2 font-medium">Resend Email</Text>
                </View>
              </Button>

              <Button onPress={handleChangeEmail} variant="ghost" size="lg">
                <Text className="font-medium">Use a different email</Text>
              </Button>
            </View>
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
