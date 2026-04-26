import { View } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "urql";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrainCircuit, RotateCcw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import { useAuth } from "@/lib/auth-context";
import { MeQuery, StartActivationMutation } from "@/lib/graphql-queries";

export default function ActivationIndex() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [{ data: meData, fetching: isMeFetching, error: meError }] = useQuery({
    query: MeQuery,
    pause: !isAuthenticated,
  });
  const [, startActivation] = useMutation(StartActivationMutation);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = meData?.me?.id;

  const start = async (
    mode: "full" | "refresh" = "full",
    focusLayer?: string,
  ) => {
    if (!userId || isStarting) {
      if (meError) setError(meError.message);
      return;
    }
    setIsStarting(true);
    setError(null);
    try {
      const result = await startActivation({
        input: { userId, mode, focusLayer },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      const session = result.data?.startActivation;
      if (session?.id) {
        router.push({
          pathname: "/activation/interview/[layerId]",
          params: { layerId: session.currentLayer, sessionId: session.id },
        });
        return;
      }
      setError("Activation did not return a session.");
    } finally {
      setIsStarting(false);
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
          {(error || meError) && <Muted>{error ?? meError?.message}</Muted>}
          <Button
            onPress={() => start("full")}
            loading={isStarting || isMeFetching}
            disabled={!userId || isMeFetching}
          >
            Start activation
          </Button>
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
