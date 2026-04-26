import { View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation } from "urql";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrainCircuit, RotateCcw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import { useAuth } from "@/lib/auth-context";
import { StartActivationMutation } from "@/lib/graphql-queries";

export default function ActivationIndex() {
  const router = useRouter();
  const { user } = useAuth();
  const [, startActivation] = useMutation(StartActivationMutation);

  const start = async (
    mode: "full" | "refresh" = "full",
    focusLayer?: string,
  ) => {
    const userId = (user as any)?.id;
    if (!userId) return;
    const result = await startActivation({
      input: { userId, mode, focusLayer },
    });
    const session = result.data?.startActivation;
    if (session?.id) {
      router.push({
        pathname: "/activation/interview/[layerId]",
        params: { layerId: session.currentLayer, sessionId: session.id },
      });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <View className="flex-1 justify-between px-5 py-6">
        <View className="gap-5">
          <BrainCircuit size={34} color="#0f766e" />
          <View className="gap-2">
            <Text className="text-3xl font-semibold">Activation</Text>
            <Muted>
              A focused interview to teach your agents your rhythms, decisions,
              dependencies, and working context.
            </Muted>
          </View>
        </View>
        <View className="gap-3">
          <Button onPress={() => start("full")}>Start activation</Button>
          <Button
            variant="outline"
            onPress={() => router.push("/activation/refresh")}
          >
            <RotateCcw size={18} color="#111827" />
            Refresh one layer
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}
