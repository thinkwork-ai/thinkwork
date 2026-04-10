import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActiveTurn = {
  runId: string;
  threadId: string | null;
  agentId: string | null;
  status: string; // "queued" | "running"
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type ActiveTurnsStore = {
  turns: ActiveTurn[];

  // Cached derived state (updated when turns change)
  _activeThreadIds: Set<string>;
  _countByAgent: Map<string, number>;

  /** Bulk-set from poll query */
  setTurns: (turns: ActiveTurn[]) => void;

  /** Add or update a turn (from subscription) */
  upsertTurn: (turn: ActiveTurn) => void;

  /** Remove a turn by runId (when it finishes) */
  removeTurn: (runId: string) => void;
};

const EMPTY_THREAD_IDS = new Set<string>();
const EMPTY_AGENT_COUNTS = new Map<string, number>();

function deriveCaches(turns: ActiveTurn[]) {
  const activeThreadIds = new Set<string>();
  const countByAgent = new Map<string, number>();
  for (const t of turns) {
    if (t.threadId) activeThreadIds.add(t.threadId);
    if (t.agentId) countByAgent.set(t.agentId, (countByAgent.get(t.agentId) ?? 0) + 1);
  }
  return {
    _activeThreadIds: activeThreadIds.size > 0 ? activeThreadIds : EMPTY_THREAD_IDS,
    _countByAgent: countByAgent.size > 0 ? countByAgent : EMPTY_AGENT_COUNTS,
  };
}

export const useActiveTurnsStore = create<ActiveTurnsStore>((set) => ({
  turns: [],
  _activeThreadIds: EMPTY_THREAD_IDS,
  _countByAgent: EMPTY_AGENT_COUNTS,

  setTurns: (incoming) =>
    set((state) => {
      // Skip update if the set of runIds + statuses hasn't changed
      if (state.turns.length === incoming.length) {
        const oldKey = state.turns.map((t) => `${t.runId}:${t.status}`).sort().join(",");
        const newKey = incoming.map((t) => `${t.runId}:${t.status}`).sort().join(",");
        if (oldKey === newKey) return state; // no change — keep same reference
      }
      return { turns: incoming, ...deriveCaches(incoming) };
    }),

  upsertTurn: (turn) =>
    set((state) => {
      const existing = state.turns.findIndex((t) => t.runId === turn.runId);
      let next: ActiveTurn[];
      if (existing >= 0) {
        next = [...state.turns];
        next[existing] = turn;
      } else {
        next = [...state.turns, turn];
      }
      return { turns: next, ...deriveCaches(next) };
    }),

  removeTurn: (runId) =>
    set((state) => {
      const next = state.turns.filter((t) => t.runId !== runId);
      return { turns: next, ...deriveCaches(next) };
    }),
}));
