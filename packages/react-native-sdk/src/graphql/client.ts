import { Client, cacheExchange, fetchExchange, subscriptionExchange } from "urql";
import { createAppSyncSubscriptionTransport } from "./appsync-ws";
import { getAuthToken } from "./token";
import type { ThinkworkConfig } from "../types";

export interface ThinkworkGraphqlClient {
  client: Client;
  reconnectSubscriptions: () => void;
}

export function createThinkworkClient(config: ThinkworkConfig): ThinkworkGraphqlClient {
  const transport = config.graphqlWsUrl
    ? createAppSyncSubscriptionTransport(config)
    : null;

  const exchanges = [cacheExchange, fetchExchange];
  if (transport) {
    exchanges.push(
      subscriptionExchange({
        forwardSubscription: (request) =>
          transport.forward({
            query: request.query ?? "",
            variables: request.variables as Record<string, unknown> | undefined,
          }),
      }),
    );
  }

  const client = new Client({
    url: config.graphqlUrl,
    exchanges,
    fetchOptions: () => {
      const headers: Record<string, string> = {};
      const token = getAuthToken();
      if (token) headers.Authorization = token;
      else if (config.graphqlApiKey) headers["x-api-key"] = config.graphqlApiKey;
      return { headers };
    },
  });

  return {
    client,
    reconnectSubscriptions: () => transport?.reconnect(),
  };
}
