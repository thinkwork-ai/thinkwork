import { useEffect, type ReactNode } from "react";
import { useSubscription, useQuery } from "urql";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTenant } from "@/context/TenantContext";
import { queryKeys } from "@/lib/query-keys";
import {
  OnAgentStatusChangedSubscription,
  OnThreadUpdatedSubscription,
  OnInboxItemStatusChangedSubscription,
  OnThreadTurnUpdatedSubscription,
  ActiveTurnsQuery,
} from "@/lib/graphql-queries";
import { useActiveTurnsStore } from "@/stores/active-turns-store";

/**
 * Subscribes to AppSync real-time events for the current tenant.
 * Invalidates React Query caches and shows toast notifications.
 */
export function AppSyncSubscriptionProvider({ children }: { children: ReactNode }) {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  // --- Agent status changes ---
  const [agentResult] = useSubscription({
    query: OnAgentStatusChangedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  useEffect(() => {
    const event = agentResult.data?.onAgentStatusChanged;
    if (!event) return;

    queryClient.invalidateQueries({ queryKey: queryKeys.agents.all(event.tenantId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(event.agentId) });

    if (event.status === "ERROR") {
      toast.error(`${event.name} is now ${event.status.toLowerCase()}`);
    } else {
      toast.info(`${event.name} is now ${event.status.toLowerCase()}`);
    }
  }, [agentResult.data]);

  // --- Thread updates ---
  const [threadResult] = useSubscription({
    query: OnThreadUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  useEffect(() => {
    const event = threadResult.data?.onThreadUpdated;
    if (!event) return;

    queryClient.invalidateQueries({ queryKey: queryKeys.threads.all(event.tenantId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.threads.detail(event.threadId) });

    // Query invalidation above is sufficient — no toast needed for thread updates
  }, [threadResult.data]);

  // --- Inbox item status changes ---
  const [inboxItemResult] = useSubscription({
    query: OnInboxItemStatusChangedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  useEffect(() => {
    const event = inboxItemResult.data?.onInboxItemStatusChanged;
    if (!event) return;

    queryClient.invalidateQueries({ queryKey: queryKeys.inboxItems.all(event.tenantId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.inboxItems.detail(event.inboxItemId) });

    const title = `Inbox item "${event.title ?? "request"}" ${event.status.toLowerCase()}`;
    if (event.status === "APPROVED") {
      toast.success(title);
    } else if (event.status === "REJECTED") {
      toast.warning(title);
    } else {
      toast.info(title);
    }
  }, [inboxItemResult.data]);

  // --- Active turns (live agent runs) ---
  const setTurns = useActiveTurnsStore((s) => s.setTurns);
  const upsertTurn = useActiveTurnsStore((s) => s.upsertTurn);
  const removeTurn = useActiveTurnsStore((s) => s.removeTurn);

  // Poll for active turns every 5 seconds — queries both "running" and "queued"
  const [activeTurnsResult, reexecuteActiveTurns] = useQuery({
    query: ActiveTurnsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "network-only",
  });

  useEffect(() => {
    const data = activeTurnsResult.data as any;
    if (!data) return;
    const allTurns = [...(data.running ?? []), ...(data.queued ?? [])];
    const turnEntries = allTurns.map((t: any) => ({
      runId: t.id,
      threadId: t.threadId ?? null,
      agentId: t.agentId ?? null,
      status: t.status as string,
    }));

    // Also include queued wakeup requests (before a thread_turn is created)
    const existingRunIds = new Set(turnEntries.map((t) => t.runId));
    for (const w of data.queuedWakeups ?? []) {
      if (existingRunIds.has(w.id)) continue;
      // Parse threadId from triggerDetail (format: "ticket:UUID")
      const threadId = w.triggerDetail?.startsWith("ticket:") ? w.triggerDetail.slice(7) : null;
      turnEntries.push({
        runId: `wakeup:${w.id}`,
        threadId,
        agentId: w.agentId ?? null,
        status: "queued",
      });
    }

    setTurns(turnEntries);
  }, [activeTurnsResult.data]);

  useEffect(() => {
    if (!tenantId) return;
    const interval = setInterval(() => {
      reexecuteActiveTurns({ requestPolicy: "network-only" });
    }, 5000);
    return () => clearInterval(interval);
  }, [tenantId, reexecuteActiveTurns]);

  // Subscribe to turn updates for instant add/remove between polls
  const [turnUpdateResult] = useSubscription({
    query: OnThreadTurnUpdatedSubscription,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  useEffect(() => {
    const event = (turnUpdateResult.data as any)?.onThreadTurnUpdated;
    if (!event) return;

    const status = event.status?.toLowerCase();
    if (status === "running" || status === "queued") {
      upsertTurn({
        runId: event.runId,
        threadId: event.threadId ?? null,
        agentId: event.agentId ?? null,
        status,
      });
    } else {
      removeTurn(event.runId);
    }
  }, [turnUpdateResult.data]);

  return <>{children}</>;
}
