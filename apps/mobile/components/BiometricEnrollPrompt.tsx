import { View, Pressable, Platform } from "react-native";
import { Scan, X } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBiometricAuth, getBiometricName } from "@/hooks/useBiometricAuth";
import { COLORS } from "@/lib/theme";
import { useColorScheme } from "nativewind";

interface BiometricEnrollPromptProps {
  onComplete: () => void;
}

export function BiometricEnrollPrompt({ onComplete }: BiometricEnrollPromptProps) {
  const { isSupported, biometricType, enableBiometric } = useBiometricAuth();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  // Don't show on web or if biometrics not supported
  if (Platform.OS === "web" || !isSupported) {
    // Auto-complete if not applicable
    onComplete();
    return null;
  }

  const biometricName = getBiometricName(biometricType);

  const handleEnable = async () => {
    const success = await enableBiometric();
    // Complete regardless of success - user made a choice
    onComplete();
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <View className="absolute inset-0 bg-black/50 items-center justify-center p-4 z-50">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6 items-center">
          <View className="w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-900/30 items-center justify-center mb-4">
            <Scan size={32} color={colors.primary} />
          </View>
          
          <Text className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2 text-center">
            Enable {biometricName}?
          </Text>
          
          <Text className="text-neutral-500 dark:text-neutral-400 text-center mb-6">
            Sign in faster next time with {biometricName}. You can change this in Settings.
          </Text>

          <View className="w-full gap-3">
            <Button onPress={handleEnable}>
              Enable {biometricName}
            </Button>
            
            <Button variant="ghost" onPress={handleSkip}>
              Not Now
            </Button>
          </View>
        </CardContent>
      </Card>
    </View>
  );
}
