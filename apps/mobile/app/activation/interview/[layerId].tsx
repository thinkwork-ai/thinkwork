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

const LAYER_PROMPTS: Record<string, string> = {
  rhythms:
    "Let's map your rhythms. What tends to repeat, matter, or slow you down here?",
  decisions:
    "Let's map your decisions. Where do you need judgment, escalation, or clear defaults?",
  dependencies:
    "Let's map your dependencies. Which people, systems, or signals shape your work?",
  knowledge:
    "Let's map your knowledge. What context should your agents remember and reuse?",
  friction:
    "Let's map your friction. Where do repeated blockers or costly handoffs slow you down?",
};

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
        agentMessage={
          LAYER_PROMPTS[String(layerId)] ?? session?.lastAgentMessage
        }
        value={reply}
        onChangeText={setReply}
        onSubmit={submit}
        onCheckpoint={checkpoint}
        loading={fetching}
      />
    </SafeAreaView>
  );
}
