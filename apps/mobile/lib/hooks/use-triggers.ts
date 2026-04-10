import { useQuery } from "urql";
import { ScheduledJobsQuery } from "@/lib/graphql-queries";

export function useScheduledJobs(tenantId: string | undefined, opts?: { agentId?: string; jobType?: string; enabled?: boolean }) {
  return useQuery({
    query: ScheduledJobsQuery,
    variables: { tenantId: tenantId!, ...opts },
    pause: !tenantId,
  });
}

// Legacy alias
export const useTriggers = useScheduledJobs;
