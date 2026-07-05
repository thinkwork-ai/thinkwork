import { useMemo } from "react";
import { useQuery } from "urql";
import { AgentsQuery, TenantAgentSummaryQuery } from "../graphql/queries";
import type { Agent } from "../types";

/**
 * The tenant platform agent for end-user surfaces. Reads the member-safe
 * tenantAgentSummary query (display fields only); the full tenantAgent query
 * is admin-gated and remains only as a fallback for environments whose API
 * predates the summary field — where it still works for admin callers.
 */
export function useAgents({
  tenantId,
}: {
  tenantId: string | null | undefined;
}) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    agent?: Agent | null;
  }>({
    query: TenantAgentSummaryQuery,
    variables: { tenantId },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const summaryUnsupported = useMemo(
    () =>
      Boolean(
        error?.graphQLErrors?.some((gqlError) =>
          /cannot query field|unknown field|validation/i.test(
            gqlError.message,
          ),
        ),
      ),
    [error],
  );

  const [
    { data: legacyData, fetching: legacyFetching, error: legacyError },
    legacyRefetch,
  ] = useQuery<{
    agent?: Agent | null;
  }>({
    query: AgentsQuery,
    variables: { tenantId },
    pause: !tenantId || !summaryUnsupported,
    requestPolicy: "cache-and-network",
  });

  const agents = useMemo(() => {
    const agent = summaryUnsupported ? legacyData?.agent : data?.agent;
    return agent ? [agent] : [];
  }, [data, legacyData, summaryUnsupported]);

  return {
    agents,
    loading: summaryUnsupported ? legacyFetching : fetching,
    error: summaryUnsupported ? legacyError : error,
    refetch: () =>
      summaryUnsupported
        ? legacyRefetch({ requestPolicy: "network-only" })
        : refetch({ requestPolicy: "network-only" }),
  };
}
