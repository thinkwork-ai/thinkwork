import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostSummary = {
  totalUsd: number;
  llmUsd: number;
  computeUsd: number;
  toolsUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  eventCount: number;
};

export type UserCost = {
  userId: string | null;
  userName: string;
  userEmail: string | null;
  totalUsd: number;
  eventCount: number;
  isSystem: boolean;
};

export type ModelCost = {
  model: string;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export type DailyCost = {
  day: string;
  totalUsd: number;
  llmUsd: number;
  computeUsd: number;
  toolsUsd: number;
  eventCount: number;
};

export type BudgetStatusItem = {
  policy: {
    id: string;
    agentId: string | null;
    userId: string | null;
    scope: string;
    limitUsd: number;
    actionOnExceed: string;
  };
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  status: string;
};

export type CostEvent = {
  tenantId: string;
  agentId: string;
  agentName: string;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  eventType: string;
  amountUsd: number;
  model: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type CostStore = {
  // Data
  summary: CostSummary | null;
  byUser: UserCost[];
  byModel: ModelCost[];
  timeSeries: DailyCost[];
  budgets: BudgetStatusItem[];
  loaded: boolean;

  // Actions — bulk set from initial query
  setSummary: (s: CostSummary) => void;
  setByUser: (a: UserCost[]) => void;
  setByModel: (m: ModelCost[]) => void;
  setTimeSeries: (t: DailyCost[]) => void;
  setBudgets: (b: BudgetStatusItem[]) => void;
  setLoaded: (v: boolean) => void;

  // Incremental update from subscription event
  applyEvent: (event: CostEvent) => void;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const useCostStore = create<CostStore>((set) => ({
  summary: null,
  byUser: [],
  byModel: [],
  timeSeries: [],
  budgets: [],
  loaded: false,

  setSummary: (s) => set({ summary: s }),
  setByUser: (a) => set({ byUser: a }),
  setByModel: (m) => set({ byModel: m }),
  setTimeSeries: (t) => set({ timeSeries: t }),
  setBudgets: (b) => set({ budgets: b }),
  setLoaded: (v) => set({ loaded: v }),

  applyEvent: (event) =>
    set((state) => {
      const amt = event.amountUsd;
      const isLlm =
        event.eventType === "llm" || event.eventType === "inference";
      const isTool = event.eventType.startsWith("exa_");
      const isCompute = event.eventType === "agentcore_compute";

      // --- summary ---
      const prev = state.summary ?? {
        totalUsd: 0,
        llmUsd: 0,
        computeUsd: 0,
        toolsUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        eventCount: 0,
      };
      const summary: CostSummary = {
        ...prev,
        totalUsd: prev.totalUsd + amt,
        llmUsd: prev.llmUsd + (isLlm ? amt : 0),
        computeUsd: prev.computeUsd + (isCompute ? amt : 0),
        toolsUsd: prev.toolsUsd + (isTool ? amt : 0),
        eventCount: prev.eventCount + 1,
      };

      // --- byUser ---
      const byUser = [...state.byUser];
      const userKey = event.userId ?? null;
      const userIdx = byUser.findIndex((u) => u.userId === userKey);
      if (userIdx >= 0) {
        byUser[userIdx] = {
          ...byUser[userIdx],
          totalUsd: byUser[userIdx].totalUsd + amt,
          eventCount: byUser[userIdx].eventCount + 1,
        };
      } else {
        byUser.push({
          userId: userKey,
          userName: userKey
            ? (event.userName ?? event.userEmail ?? "Unknown user")
            : "System / unattributed",
          userEmail: userKey ? (event.userEmail ?? null) : null,
          totalUsd: amt,
          eventCount: 1,
          isSystem: !userKey,
        });
      }

      // --- byModel ---
      const byModel = [...state.byModel];
      if (event.model) {
        const modelIdx = byModel.findIndex((m) => m.model === event.model);
        if (modelIdx >= 0) {
          byModel[modelIdx] = {
            ...byModel[modelIdx],
            totalUsd: byModel[modelIdx].totalUsd + amt,
          };
        } else {
          byModel.push({
            model: event.model,
            totalUsd: amt,
            inputTokens: 0,
            outputTokens: 0,
          });
        }
      }

      // --- timeSeries (bump today's bucket) ---
      const timeSeries = [...state.timeSeries];
      const todayStr = today();
      const dayIdx = timeSeries.findIndex((d) => d.day === todayStr);
      if (dayIdx >= 0) {
        timeSeries[dayIdx] = {
          ...timeSeries[dayIdx],
          totalUsd: timeSeries[dayIdx].totalUsd + amt,
          llmUsd: timeSeries[dayIdx].llmUsd + (isLlm ? amt : 0),
          computeUsd: timeSeries[dayIdx].computeUsd + (isCompute ? amt : 0),
          toolsUsd: timeSeries[dayIdx].toolsUsd + (isTool ? amt : 0),
          eventCount: timeSeries[dayIdx].eventCount + 1,
        };
      } else {
        timeSeries.push({
          day: todayStr,
          totalUsd: amt,
          llmUsd: isLlm ? amt : 0,
          computeUsd: isCompute ? amt : 0,
          toolsUsd: isTool ? amt : 0,
          eventCount: 1,
        });
      }

      // --- budgets (increment spent) ---
      const budgets = state.budgets.map((b) => {
        const shouldIncrement =
          b.policy.scope === "tenant" ||
          (b.policy.scope === "user" && b.policy.userId === event.userId);
        if (!shouldIncrement) return b;

        const newSpent = b.spentUsd + amt;
        return {
          ...b,
          spentUsd: newSpent,
          remainingUsd: Math.max(0, b.policy.limitUsd - newSpent),
          percentUsed:
            b.policy.limitUsd > 0 ? (newSpent / b.policy.limitUsd) * 100 : 0,
          status:
            b.policy.limitUsd > 0 && newSpent >= b.policy.limitUsd
              ? "exceeded"
              : b.policy.limitUsd > 0 && newSpent >= b.policy.limitUsd * 0.8
                ? "warning"
                : "ok",
        };
      });

      return { summary, byUser, byModel, timeSeries, budgets };
    }),
}));
