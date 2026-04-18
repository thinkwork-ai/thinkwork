import { useState, useEffect, useCallback, useRef, createContext, useContext, type ReactNode } from "react";
import { useThreadTurnUpdatedSubscription } from "@thinkwork/react-native-sdk";

type TurnStatus = "succeeded" | "failed";

interface TurnCompletion {
  status: TurnStatus;
  timestamp: number;
  triggerId: string | null;
}

interface TurnCompletionState {
  hasNewCompletion: boolean;
  getLatestStatus: () => TurnStatus | null;
  completions: Map<string, TurnCompletion>;
  isThreadActive: (threadId: string) => boolean;
  activeTriggers: Set<string>;
  markThreadActive: (threadId: string) => void;
  clearThreadActive: (threadId: string) => void;
}

const CLEAR_AFTER_MS = 60_000;
const AUTO_CLEAR_ACTIVE_MS = 120_000;

const TurnCompletionContext = createContext<TurnCompletionState | null>(null);

/**
 * Provider — mount at root layout so activity state is globally available.
 */
export function TurnCompletionProvider({ tenantId, children }: { tenantId: string | undefined; children: ReactNode }) {
  const value = useTurnCompletionInternal(tenantId);
  return (
    <TurnCompletionContext.Provider value={value}>
      {children}
    </TurnCompletionContext.Provider>
  );
}

/**
 * Consume turn completion state from the root-level provider.
 */
export function useTurnCompletion(_tenantId?: string | undefined) {
  const ctx = useContext(TurnCompletionContext);
  if (ctx) return ctx;
  return useTurnCompletionInternal(_tenantId);
}

function useTurnCompletionInternal(tenantId: string | undefined) {
  const [completions, setCompletions] = useState<Map<string, TurnCompletion>>(new Map());
  const [activeTriggers, setActiveTriggers] = useState<Set<string>>(new Set());
  const activeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Keep the subscription as a bonus — supplements the optimistic approach
  const [{ data: turnEvent }] = useThreadTurnUpdatedSubscription(tenantId);

  // ── Optimistic API ──

  const markThreadActive = useCallback((threadId: string) => {
    setActiveTriggers((prev) => {
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
    // Auto-clear safety net
    if (activeTimersRef.current.has(threadId)) {
      clearTimeout(activeTimersRef.current.get(threadId)!);
    }
    const timer = setTimeout(() => {
      setActiveTriggers((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
      activeTimersRef.current.delete(threadId);
    }, AUTO_CLEAR_ACTIVE_MS);
    activeTimersRef.current.set(threadId, timer);
  }, []);

  const clearThreadActive = useCallback((threadId: string) => {
    setActiveTriggers((prev) => {
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
    if (activeTimersRef.current.has(threadId)) {
      clearTimeout(activeTimersRef.current.get(threadId)!);
      activeTimersRef.current.delete(threadId);
    }
  }, []);

  // ── Subscription-driven updates (bonus) ──

  useEffect(() => {
    const event = turnEvent?.onThreadTurnUpdated;
    if (!event) return;
    const { runId, triggerId, threadId, status } = event;

    const tId = threadId ?? triggerId;
    if (tId) {
      if (status === "running" || status === "queued") {
        markThreadActive(tId);
      } else {
        clearThreadActive(tId);
      }
    }

    if (status !== "succeeded" && status !== "failed") return;

    setCompletions((prev) => {
      const next = new Map(prev);
      next.set(runId, { status: status as TurnStatus, timestamp: Date.now(), triggerId: triggerId ?? null });
      return next;
    });

    const timer = setTimeout(() => {
      setCompletions((prev) => {
        const next = new Map(prev);
        next.delete(runId);
        return next;
      });
      timersRef.current.delete(runId);
    }, CLEAR_AFTER_MS);
    timersRef.current.set(runId, timer);

    return () => {
      if (timersRef.current.has(runId)) {
        clearTimeout(timersRef.current.get(runId)!);
        timersRef.current.delete(runId);
      }
    };
  }, [turnEvent?.onThreadTurnUpdated?.runId, turnEvent?.onThreadTurnUpdated?.status]);

  const hasNewCompletion = completions.size > 0;

  const isThreadActive = useCallback((threadId: string): boolean => {
    return activeTriggers.has(threadId);
  }, [activeTriggers]);

  const getLatestStatus = useCallback((): TurnStatus | null => {
    if (completions.size === 0) return null;
    let latest: TurnCompletion | null = null;
    for (const c of completions.values()) {
      if (!latest || c.timestamp > latest.timestamp) latest = c;
    }
    return latest?.status ?? null;
  }, [completions]);

  return { hasNewCompletion, getLatestStatus, completions, isThreadActive, activeTriggers, markThreadActive, clearThreadActive };
}
