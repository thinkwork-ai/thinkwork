import { useCallback, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  DisableConnectorMutation,
  EnableConnectorMutation,
  MyComputerQuery,
} from "@/lib/graphql-queries";

interface MyComputerResult {
  myComputer?: { id: string } | null;
}

export interface UseConnectorMutationResult {
  toggle: (slug: string, nextConnected: boolean) => Promise<void>;
  pendingSlug: string | null;
}

/**
 * urql wrapper for the Connectors-tab Connect / Disable button. Resolves
 * the caller's Computer id once via MyComputerQuery, then routes the
 * Sheet's `(slug, nextConnected)` action to enableConnector or
 * disableConnector. Cache invalidation rides on the mutation's
 * `additionalTypenames` so the catalog + bindings queries refetch
 * automatically — no manual setState in the page.
 *
 * MCP-kind catalog rows must NOT be passed to this hook; the per-tab
 * page short-circuits to the "Connect via mobile" hint instead.
 */
export function useConnectorMutation(): UseConnectorMutationResult {
  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const computerId = computerData?.myComputer?.id ?? null;

  const [, enable] = useMutation(EnableConnectorMutation);
  const [, disable] = useMutation(DisableConnectorMutation);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  const toggle = useCallback(
    async (slug: string, nextConnected: boolean) => {
      if (!computerId) {
        toast.error("Couldn't resolve your Computer — please reload.");
        return;
      }
      setPendingSlug(slug);
      try {
        const result = nextConnected
          ? await enable(
              { input: { computerId, slug } },
              {
                additionalTypenames: [
                  "Connector",
                  "ConnectorBinding",
                  "CustomizeBindings",
                ],
              },
            )
          : await disable(
              { input: { computerId, slug } },
              {
                additionalTypenames: [
                  "Connector",
                  "ConnectorBinding",
                  "CustomizeBindings",
                ],
              },
            );
        if (result.error) {
          const code = result.error.graphQLErrors[0]?.extensions?.code;
          if (code === "CUSTOMIZE_MCP_NOT_SUPPORTED") {
            toast.message(
              "Connect this MCP server from the mobile app's per-user OAuth flow.",
            );
          } else {
            toast.error(result.error.message);
          }
        }
      } finally {
        setPendingSlug(null);
      }
    },
    [computerId, enable, disable],
  );

  return { toggle, pendingSlug };
}
