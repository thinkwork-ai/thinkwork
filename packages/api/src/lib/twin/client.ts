/**
 * Twin read client (Company Brain U6 / KTD-6).
 *
 * Neptune is VPC-only and graphql-http is not VPC-attached, so all product
 * reads RequestResponse-invoke the VPC `twin-query` Lambda with a TYPED
 * request — the Lambda compiles it server-side (query-compiler) and
 * executes with reader IAM. No query text crosses this boundary in either
 * direction, and the tenant id is server-derived by the caller (resolver
 * scope), never client-asserted.
 *
 * Degrade-not-throw: transport/execution failures come back as a typed
 * `unavailable` result — the agent tool layer (U7) renders its fixed
 * unavailable text and the turn continues.
 */

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { getConfig } from "@thinkwork/runtime-config";
import type { TwinRequest } from "./query-compiler.js";

export interface TwinQueryOk {
  ok: true;
  results: Array<Record<string, unknown>>;
}

export interface TwinQueryUnavailable {
  ok: false;
  reason: "unavailable" | "invalid_request";
  detail?: string;
}

export type TwinQueryResult = TwinQueryOk | TwinQueryUnavailable;

let lambdaClient: LambdaClient | null = null;

export async function executeTwinQuery(args: {
  tenantId: string;
  request: TwinRequest;
  client?: Pick<LambdaClient, "send">;
  stage?: string;
}): Promise<TwinQueryResult> {
  const stage = args.stage ?? process.env.STAGE ?? "";
  if (!stage || !getConfig("NEPTUNE_ENDPOINT")) {
    // Twin not deployed on this stage — typed unavailable, never a throw.
    return { ok: false, reason: "unavailable", detail: "twin_not_deployed" };
  }
  try {
    const client = args.client ?? (lambdaClient ??= new LambdaClient({}));
    const response = await client.send(
      new InvokeCommand({
        FunctionName: `thinkwork-${stage}-api-twin-query`,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(
          JSON.stringify({ tenantId: args.tenantId, request: args.request }),
        ),
      }),
    );
    if (response.FunctionError) {
      return {
        ok: false,
        reason: "unavailable",
        detail: response.FunctionError,
      };
    }
    const payload = response.Payload
      ? JSON.parse(Buffer.from(response.Payload).toString("utf-8"))
      : null;
    if (!payload || typeof payload !== "object") {
      return { ok: false, reason: "unavailable", detail: "empty_payload" };
    }
    return payload as TwinQueryResult;
  } catch (err) {
    return {
      ok: false,
      reason: "unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
