import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "urql";
import {
  MemoryPanel,
  type ComputerMemoryRecord,
} from "@/components/memory/MemoryPanel";
import { useTenant } from "@/context/TenantContext";
import {
  ComputerMemoryRecordsQuery,
  DeleteComputerMemoryRecordMutation,
  MyComputerQuery,
} from "@/lib/graphql-queries";

// U4 placeholder: defers to the legacy MemoryPanel so /memory/brain stays
// behavior-compatible until U5 lands the full Table + Graph experience.

export const Route = createFileRoute("/_authed/_shell/memory/brain")({
  component: BrainPage,
});

interface MyComputerResult {
  myComputer?: { id: string; tenantId: string; ownerUserId: string } | null;
}

interface MemoryRecordsResult {
  memoryRecords?: ComputerMemoryRecord[] | null;
}

function BrainPage() {
  const { tenantId } = useTenant();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [{ data: computerData }] = useQuery<MyComputerResult>({ query: MyComputerQuery });
  const userId = computerData?.myComputer?.ownerUserId ?? null;
  const effectiveTenantId = tenantId ?? computerData?.myComputer?.tenantId ?? null;
  const namespace = userId ? `user_${userId}` : "";
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<MemoryRecordsResult>({
    query: ComputerMemoryRecordsQuery,
    variables: { tenantId: effectiveTenantId, userId, namespace },
    pause: !effectiveTenantId || !userId,
  });
  const [, deleteMemoryRecord] = useMutation(DeleteComputerMemoryRecordMutation);

  return (
    <MemoryPanel
      records={data?.memoryRecords ?? []}
      isLoading={fetching && !data}
      error={error?.message ?? null}
      deletingId={deletingId}
      onForget={async (memoryRecordId) => {
        if (!effectiveTenantId || !userId) return;
        setDeletingId(memoryRecordId);
        try {
          const result = await deleteMemoryRecord({
            tenantId: effectiveTenantId,
            userId,
            memoryRecordId,
          });
          if (result.error) throw result.error;
          reexecuteQuery({ requestPolicy: "network-only" });
        } finally {
          setDeletingId(null);
        }
      }}
    />
  );
}
