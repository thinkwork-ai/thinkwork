import { View } from "react-native";
import { useRouter } from "expo-router";
import { CheckCircle2 } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";

export default function ActivationApply() {
  const router = useRouter();
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <View className="flex-1 items-center justify-center gap-5 px-6">
        <CheckCircle2 size={42} color="#047857" />
        <View className="items-center gap-2">
          <Text className="text-2xl font-semibold">Activation applied</Text>
          <Muted>
            Your agents will use the approved operating model on their next run.
          </Muted>
        </View>
        <Button onPress={() => router.replace("/(tabs)")}>Done</Button>
      </View>
    </SafeAreaView>
  );
}
