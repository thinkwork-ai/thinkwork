import { useCallback, useEffect } from "react";
import { useQuery } from "urql";
import {
  CostSummaryQuery,
  CostByUserQuery,
  CostByModelQuery,
  CostTimeSeriesQuery,
  BudgetStatusQuery,
} from "@/lib/graphql-queries";
import { useCostStore } from "@/stores/cost-store";

/**
 * Loads cost data into the zustand store on mount, then refetches
 * all cost queries when a subscription event arrives. This guarantees
 * the dashboard always shows accurate data from the DB rather than
 * relying on incremental client-side math.
 */
export function useCostData(tenantId: string | null | undefined) {
  const {
    setSummary,
    setByUser,
    setByModel,
    setTimeSeries,
    setBudgets,
    setLoaded,
    loaded,
  } = useCostStore();

  // --- Queries (network-only on refetch) ---
  const [summaryResult, refetchSummary] = useQuery({
    query: CostSummaryQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [userResult, refetchUser] = useQuery({
    query: CostByUserQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [modelResult, refetchModel] = useQuery({
    query: CostByModelQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [timeSeriesResult, refetchTimeSeries] = useQuery({
    query: CostTimeSeriesQuery,
    variables: { tenantId: tenantId!, days: 30 },
    pause: !tenantId,
  });

  const [budgetResult, refetchBudget] = useQuery({
    query: BudgetStatusQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  // Populate store whenever query data arrives (partial results are OK)
  const anyFetching =
    summaryResult.fetching ||
    userResult.fetching ||
    modelResult.fetching ||
    timeSeriesResult.fetching ||
    budgetResult.fetching;

  useEffect(() => {
    if (anyFetching) return;

    // Surface any query errors during development
    if (import.meta.env.DEV) {
      if (summaryResult.error)
        console.error(
          "[costs] costSummary error:",
          summaryResult.error.message,
        );
      if (userResult.error)
        console.error("[costs] costByUser error:", userResult.error.message);
      if (modelResult.error)
        console.error("[costs] costByModel error:", modelResult.error.message);
      if (timeSeriesResult.error)
        console.error(
          "[costs] costTimeSeries error:",
          timeSeriesResult.error.message,
        );
      if (budgetResult.error)
        console.error(
          "[costs] budgetStatus error:",
          budgetResult.error.message,
        );
    }

    const s = (summaryResult.data as any)?.costSummary;
    if (s) setSummary(s);
    setByUser((userResult.data as any)?.costByUser ?? []);
    setByModel((modelResult.data as any)?.costByModel ?? []);
    setTimeSeries((timeSeriesResult.data as any)?.costTimeSeries ?? []);
    setBudgets((budgetResult.data as any)?.budgetStatus ?? []);
    setLoaded(true);
  }, [
    anyFetching,
    summaryResult.data,
    userResult.data,
    modelResult.data,
    timeSeriesResult.data,
    budgetResult.data,
  ]);

  // Refetch all queries from the server
  const refetchAll = useCallback(() => {
    refetchSummary({ requestPolicy: "network-only" });
    refetchUser({ requestPolicy: "network-only" });
    refetchModel({ requestPolicy: "network-only" });
    refetchTimeSeries({ requestPolicy: "network-only" });
    refetchBudget({ requestPolicy: "network-only" });
  }, [
    refetchSummary,
    refetchUser,
    refetchModel,
    refetchTimeSeries,
    refetchBudget,
  ]);

  return {
    loading: !loaded && anyFetching,
  };
}
