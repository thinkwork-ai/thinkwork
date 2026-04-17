/**
 * GraphQL client factory keyed by stage.
 *
 * Each command does roughly:
 *
 *     const { client } = await getGqlClient(stage);
 *     const res = await client.query(MeDocument, {});
 *
 * Auth headers come from `resolveAuth(stage)` — Cognito id_token in cognito
 * mode, `Authorization: Bearer <api_auth_secret>` + `x-tenant-id` in api-key
 * mode. Tokens are refreshed transparently before every call (resolveAuth
 * handles the Cognito refresh), so commands never have to think about it.
 */

import {
  Client,
  cacheExchange,
  fetchExchange,
  type OperationResult,
  type TypedDocumentNode,
} from "@urql/core";
import { getApiEndpoint } from "../aws-discovery.js";
import { resolveAuth } from "./resolve-auth.js";
import { printError } from "../ui.js";

export interface GqlClientContext {
  client: Client;
  /** HTTPS URL of the GraphQL endpoint (API Gateway route). */
  url: string;
  /** Resolved tenant ID, if any — convenient for variables. */
  tenantId?: string;
  /** Resolved tenant slug, if any. */
  tenantSlug?: string;
}

export interface GqlClientOptions {
  /** Stage whose deployment we target. */
  stage: string;
  /** AWS region. Falls back to us-east-1 (matches aws-discovery). */
  region?: string;
}

export async function getGqlClient(
  opts: GqlClientOptions,
): Promise<GqlClientContext> {
  const region = opts.region ?? "us-east-1";

  const baseUrl = getApiEndpoint(opts.stage, region);
  if (!baseUrl) {
    printError(
      `Cannot discover API endpoint for stage "${opts.stage}" in ${region}. Is the stack deployed?`,
    );
    process.exit(1);
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/graphql`;
  const auth = await resolveAuth({ stage: opts.stage, region });

  const client = new Client({
    url,
    exchanges: [cacheExchange, fetchExchange],
    fetchOptions: () => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...auth.headers,
      },
    }),
    // CLI calls are short-lived and we want server truth on every run —
    // bypass the in-memory cache to avoid stale reads between quick commands.
    requestPolicy: "network-only",
  });

  return {
    client,
    url,
    tenantId: auth.tenantId,
    tenantSlug: auth.tenantSlug,
  };
}

/**
 * Thin wrapper around `client.query` that surfaces GraphQL/network errors as
 * thrown Error with a readable message. Cuts down boilerplate in every
 * command action.
 */
export async function gqlQuery<Data, Variables extends Record<string, unknown>>(
  client: Client,
  doc: TypedDocumentNode<Data, Variables>,
  variables: Variables,
): Promise<Data> {
  const res = await client.query(doc, variables).toPromise();
  return unwrap(res);
}

export async function gqlMutate<Data, Variables extends Record<string, unknown>>(
  client: Client,
  doc: TypedDocumentNode<Data, Variables>,
  variables: Variables,
): Promise<Data> {
  const res = await client.mutation(doc, variables).toPromise();
  return unwrap(res);
}

function unwrap<Data>(res: OperationResult<Data>): Data {
  if (res.error) {
    const msg =
      res.error.graphQLErrors
        .map((e) => e.message)
        .filter(Boolean)
        .join("; ") ||
      res.error.networkError?.message ||
      "GraphQL request failed";
    throw new Error(msg);
  }
  if (!res.data) {
    throw new Error("GraphQL request returned no data.");
  }
  return res.data;
}
