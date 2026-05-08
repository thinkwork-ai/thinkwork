import { useQuery } from "urql";
import { ComplianceOperatorCheckQuery } from "@/lib/compliance/queries";

export interface UseComplianceOperatorResult {
  isOperator: boolean;
  allowlistConfigured: boolean;
  fetching: boolean;
  error: Error | undefined;
}

/**
 * Operator-status check, urql-cached for the lifetime of the session.
 * Brief flicker on first paint accepted in v1; future polish could plumb
 * the result through AuthContext.
 */
export function useComplianceOperator(): UseComplianceOperatorResult {
  const [{ data, fetching, error }] = useQuery({
    query: ComplianceOperatorCheckQuery,
    requestPolicy: "cache-first",
  });

  return {
    isOperator: Boolean(data?.complianceOperatorCheck?.isOperator),
    allowlistConfigured: Boolean(
      data?.complianceOperatorCheck?.allowlistConfigured,
    ),
    fetching,
    error: error as Error | undefined,
  };
}
