import { useCallback } from "react";
import { useMutation, useQuery } from "urql";
import {
  DeleteMobileMemoryCaptureMutation,
  MobileMemoryCapturesQuery,
} from "../graphql/queries";
import type { MobileMemoryCapture } from "../types";

interface UseMobileMemoryCapturesArgs {
  agentId: string | null | undefined;
  limit?: number;
}

export function useMobileMemoryCaptures({ agentId, limit }: UseMobileMemoryCapturesArgs) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    mobileMemoryCaptures: MobileMemoryCapture[];
  }>({
    query: MobileMemoryCapturesQuery,
    variables: { agentId, limit },
    pause: !agentId,
    requestPolicy: "cache-and-network",
  });

  return {
    captures: data?.mobileMemoryCaptures ?? [],
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}

export function useDeleteMobileMemoryCapture() {
  const [, deleteCapture] = useMutation<{ deleteMobileMemoryCapture: boolean }>(
    DeleteMobileMemoryCaptureMutation,
  );
  return useCallback(
    async (input: { agentId: string; captureId: string }): Promise<void> => {
      if (!input.agentId) throw new Error("useDeleteMobileMemoryCapture: agentId is required");
      if (!input.captureId) throw new Error("useDeleteMobileMemoryCapture: captureId is required");
      const result = await deleteCapture({
        agentId: input.agentId,
        captureId: input.captureId,
      });
      if (result.error) throw result.error;
      if (!result.data?.deleteMobileMemoryCapture) {
        throw new Error("Failed to delete capture");
      }
    },
    [deleteCapture],
  );
}
