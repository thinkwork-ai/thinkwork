import { useCallback } from "react";
import { useQuery } from "urql";
import {
  ThinkWorkN8nWorkflowsApp,
  type N8nAppData,
} from "@thinkwork/plugin-n8n/n8n-app";

import type {
  N8nAppDataQuery as N8nAppDataQueryResult,
  N8nAppDataQueryVariables,
} from "@/gql/graphql";
import { N8nAppDataQuery } from "@/lib/plugin-app-queries";

export function N8nWorkflowOperationsApp({
  pluginInstallId,
  appDisplayName = "n8n Workflows",
  pluginDisplayName = "n8n",
}: {
  pluginInstallId: string;
  appDisplayName?: string;
  pluginDisplayName?: string;
}) {
  const [result, reexecuteQuery] = useQuery<
    N8nAppDataQueryResult,
    N8nAppDataQueryVariables
  >({
    query: N8nAppDataQuery,
    variables: {
      installId: pluginInstallId,
      executionLimit: 50,
    },
    requestPolicy: "cache-and-network",
  });
  const refresh = useCallback(() => {
    reexecuteQuery({ requestPolicy: "network-only" });
  }, [reexecuteQuery]);

  return (
    <ThinkWorkN8nWorkflowsApp
      appDisplayName={appDisplayName}
      pluginDisplayName={pluginDisplayName}
      data={(result.data?.n8nAppData as N8nAppData | undefined) ?? null}
      fetching={result.fetching}
      error={result.error}
      onRefresh={refresh}
    />
  );
}
