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
  CombinedError,
  type Client,
  type DocumentInput,
  stringifyDocument,
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

  const client = createCliGqlClient(url, auth.headers);

  return {
    client,
    url,
    tenantId: auth.tenantId,
    tenantSlug: auth.tenantSlug,
  };
}

export function createCliGqlClient(
  url: string,
  headers: Record<string, string>,
): Client {
  return {
    query: <Data, Variables extends Record<string, unknown>>(
      doc: DocumentInput<Data, Variables>,
      variables: Variables,
    ) => ({
      toPromise: () =>
        executeGraphql<Data, Variables>(url, headers, doc, variables),
    }),
    mutation: <Data, Variables extends Record<string, unknown>>(
      doc: DocumentInput<Data, Variables>,
      variables: Variables,
    ) => ({
      toPromise: () =>
        executeGraphql<Data, Variables>(url, headers, doc, variables),
    }),
  } as unknown as Client;
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
  const res = await client.query(serializeDocument(doc), variables).toPromise();
  return unwrap(res);
}

export async function gqlMutate<Data, Variables extends Record<string, unknown>>(
  client: Client,
  doc: TypedDocumentNode<Data, Variables>,
  variables: Variables,
): Promise<Data> {
  const res = await client.mutation(serializeDocument(doc), variables).toPromise();
  return unwrap(res);
}

function serializeDocument<Data, Variables extends Record<string, unknown>>(
  doc: DocumentInput<Data, Variables>,
): string {
  return stringifyDocument(doc);
}

async function executeGraphql<Data, Variables extends Record<string, unknown>>(
  url: string,
  headers: Record<string, string>,
  doc: DocumentInput<Data, Variables>,
  variables: Variables,
): Promise<OperationResult<Data>> {
  const query = serializeDocument(doc);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await response.text();
    let payload: {
      data?: Data;
      errors?: Array<{ message?: string } | string>;
      extensions?: Record<string, unknown>;
    } = {};

    if (text) {
      try {
        payload = JSON.parse(text) as typeof payload;
      } catch {
        return makeNetworkErrorResult(
          `GraphQL request failed with non-JSON response: ${text}`,
          response,
        );
      }
    }

    if (payload.errors?.length) {
      return {
        data: payload.data,
        error: new CombinedError({
          graphQLErrors: payload.errors as any,
          response,
        }),
        extensions: payload.extensions,
        stale: false,
        hasNext: false,
      } as OperationResult<Data>;
    }

    if (!response.ok) {
      return makeNetworkErrorResult(
        `GraphQL request failed with HTTP ${response.status}`,
        response,
      );
    }

    return {
      data: payload.data,
      error: undefined,
      extensions: payload.extensions,
      stale: false,
      hasNext: false,
    } as OperationResult<Data>;
  } catch (err) {
    return {
      error: new CombinedError({
        networkError: err instanceof Error ? err : new Error(String(err)),
      }),
      stale: false,
      hasNext: false,
    } as OperationResult<Data>;
  }
}

function makeNetworkErrorResult<Data>(
  message: string,
  response: Response,
): OperationResult<Data> {
  return {
    error: new CombinedError({
      networkError: new Error(message),
      response,
    }),
    stale: false,
    hasNext: false,
  } as OperationResult<Data>;
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
