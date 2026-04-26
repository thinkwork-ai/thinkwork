import { useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "urql";
import { InterviewTurn } from "@/components/activation/InterviewTurn";
import {
  ActivationSessionQuery,
  CheckpointActivationLayerMutation,
  SubmitActivationTurnMutation,
} from "@/lib/graphql-queries";

const LAYERS = [
  "rhythms",
  "decisions",
  "dependencies",
  "knowledge",
  "friction",
];

export default function ActivationInterviewLayer() {
  const router = useRouter();
  const { layerId = "rhythms", sessionId } = useLocalSearchParams<{
    layerId?: string;
    sessionId?: string;
  }>();
  const [reply, setReply] = useState("");
  const [{ data, fetching }] = useQuery({
    query: ActivationSessionQuery,
    variables: { sessionId },
    pause: !sessionId,
  });
  const [, submitTurn] = useMutation(SubmitActivationTurnMutation);
  const [, checkpointLayer] = useMutation(CheckpointActivationLayerMutation);
  const session = data?.activationSession;
  const mode = session?.mode === "refresh" ? "refresh" : "full";
  const nextLayer = useMemo(() => {
    const index = LAYERS.indexOf(String(layerId));
    return index >= 0 ? LAYERS[index + 1] : undefined;
  }, [layerId]);

  const submit = async () => {
    if (!sessionId || !reply.trim()) return;
    await submitTurn({
      input: { sessionId, layerId, message: reply.trim() },
    });
    setReply("");
  };

  const checkpoint = async () => {
    if (!sessionId) return;
    const entries = reply.trim()
      ? [
          {
            id: `${layerId}-${Date.now()}`,
            title: String(layerId),
            summary: reply.trim(),
            epistemicState: "confirmed",
          },
        ]
      : [];
    const result = await checkpointLayer({
      input: {
        sessionId,
        layerId,
        nextLayer,
        layerState: JSON.stringify({
          status: entries.length ? "confirmed" : "confirmed_empty",
          entries,
        }),
      },
    });
    const updated = result.data?.checkpointActivationLayer;
    if (updated?.status === "ready_for_review") {
      router.replace({ pathname: "/activation/review", params: { sessionId } });
      return;
    }
    if (nextLayer) {
      router.replace({
        pathname: "/activation/interview/[layerId]",
        params: { layerId: nextLayer, sessionId },
      });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-50 dark:bg-neutral-950">
      <InterviewTurn
        layer={String(layerId)}
        mode={mode}
        agentMessage={session?.lastAgentMessage}
        value={reply}
        onChangeText={setReply}
        onSubmit={submit}
        onCheckpoint={checkpoint}
        loading={fetching}
      />
    </SafeAreaView>
  );
}
