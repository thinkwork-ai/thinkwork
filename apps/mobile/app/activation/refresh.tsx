import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation } from "urql";
import { DetailLayout } from "@/components/layout/detail-layout";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import { useAuth } from "@/lib/auth-context";
import { StartActivationMutation } from "@/lib/graphql-queries";

const LAYERS = [
  "rhythms",
  "decisions",
  "dependencies",
  "knowledge",
  "friction",
];

export default function ActivationRefresh() {
  const router = useRouter();
  const { user } = useAuth();
  const [, startActivation] = useMutation(StartActivationMutation);
  const start = async (layer: string) => {
    const userId = user?.sub;
    if (!userId) return;
    const result = await startActivation({
      input: { userId, mode: "refresh", focusLayer: layer },
    });
    const session = result.data?.startActivation;
    if (session?.id) {
      router.replace({
        pathname: "/activation/interview/[layerId]",
        params: { layerId: layer, sessionId: session.id },
      });
    }
  };
  return (
    <DetailLayout title="Refresh activation">
      <ScrollView className="flex-1" contentContainerClassName="gap-3 p-4">
        {LAYERS.map((layer) => (
          <View
            key={layer}
            className="gap-2 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <Text className="text-lg font-semibold capitalize">{layer}</Text>
            <Muted>
              Re-check this layer and stage only the changes you approve.
            </Muted>
            <Button variant="outline" onPress={() => start(layer)}>
              Refresh
            </Button>
          </View>
        ))}
      </ScrollView>
    </DetailLayout>
  );
}
