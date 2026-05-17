import { useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import { AssignedComputersQuery } from "@/lib/graphql-queries";

export interface AssignedComputer {
  id: string;
  name?: string | null;
  tenantId?: string | null;
  slug?: string | null;
  status?: string | null;
  runtimeStatus?: string | null;
  sourceAgent?: { id: string; name?: string | null } | null;
}

interface AssignedComputersResult {
  assignedComputers?: AssignedComputer[];
}

export function useAssignedComputerSelection(options?: { pause?: boolean }) {
  const [{ data, fetching }] = useQuery<AssignedComputersResult>({
    query: AssignedComputersQuery,
    pause: options?.pause,
  });
  const computers = useMemo(
    () =>
      (data?.assignedComputers ?? []).filter(
        (computer) => computer.status !== "archived",
      ),
    [data?.assignedComputers],
  );
  const [selectedComputerId, setSelectedComputerId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (
      selectedComputerId &&
      computers.some((computer) => computer.id === selectedComputerId)
    ) {
      return;
    }
    setSelectedComputerId(computers[0]?.id ?? null);
  }, [computers, selectedComputerId]);

  const selectedComputer = useMemo(
    () =>
      computers.find((computer) => computer.id === selectedComputerId) ?? null,
    [computers, selectedComputerId],
  );

  return {
    computers,
    fetching,
    loaded: data !== undefined,
    noAssignedComputers: data !== undefined && computers.length === 0,
    selectedComputer,
    selectedComputerId,
    setSelectedComputerId,
  };
}
