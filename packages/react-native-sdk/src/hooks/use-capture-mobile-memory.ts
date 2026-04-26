import { useCallback } from "react";
import { useMutation } from "urql";
import { CaptureMobileMemoryMutation } from "../graphql/queries";
import type { CaptureMobileMemoryInput, MobileMemoryCapture } from "../types";

export function useCaptureMobileMemory() {
  const [, capture] = useMutation<{ captureMobileMemory: MobileMemoryCapture }>(
    CaptureMobileMemoryMutation,
  );

  return useCallback(
    async (input: CaptureMobileMemoryInput): Promise<MobileMemoryCapture> => {
      if (!input.agentId) throw new Error("useCaptureMobileMemory: agentId is required");
      if (!input.content || !input.content.trim()) {
        throw new Error("useCaptureMobileMemory: content is required");
      }
      const result = await capture({
        agentId: input.agentId,
        userId: input.userId,
        content: input.content,
        factType: input.factType ?? "FACT",
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        clientCaptureId: input.clientCaptureId,
      });
      const captured = result.data?.captureMobileMemory;
      if (!captured) {
        throw result.error ?? new Error("Failed to capture memory");
      }
      return captured;
    },
    [capture],
  );
}
