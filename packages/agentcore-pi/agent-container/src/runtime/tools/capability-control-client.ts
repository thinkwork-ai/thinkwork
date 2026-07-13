/**
 * Capability control-plane client (THINK-280 U2) — shared transport for the
 * `capability_search` and `connection_research` Pi tools.
 *
 * Direct Lambda invoke of the `capability-control-service` handler
 * (RequestResponse; the Pi VPC has no reliable HTTP path to the public API
 * — same reasoning as memory-retain-client / callback-lambda-fetch). The
 * receiving function name comes from `RuntimeEnvSnapshot.capabilityControlFnName`
 * (`CAPABILITY_CONTROL_FN_NAME`, snapshotted at /invocations entry — this
 * module never reads process.env).
 *
 * Identity: every call carries the Ed25519-signed capability caller context
 * minted by the trusted host at dispatch (`capability_caller_context`
 * payload field). The container holds only the capability PUBLIC key and
 * can never mint one itself; without a context the client short-circuits
 * with a typed reason and the Lambda would reject fail-closed anyway.
 *
 * Failure semantics: NEVER throws. Every outcome — missing wiring, invoke
 * error, FunctionError, unparseable payload, or a structured rejection from
 * the service — resolves to `{ ok: false, reason, detail? }`.
 */

import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";

import type { RuntimeEnvSnapshot } from "../../handler-context.js";

export type CapabilityControlAction =
  | "capability_search"
  | "connection_research";

export interface CapabilityControlRequest {
  action: CapabilityControlAction;
  /** capability_search: exact invocation tuple + principal mode. */
  tuple?: {
    namespace: string;
    class: string;
    slug: string;
    version?: string;
    operationId: string;
  };
  principalMode?: string;
  /** connection_research: query + optional draft proposal. */
  query?: string;
  allowExternal?: boolean;
  proposal?: {
    definitionId?: string;
    payload: unknown;
    sourceUrls: string[];
  };
}

export type CapabilityControlOutcome =
  | { ok: true; action: CapabilityControlAction; result: unknown }
  | { ok: false; reason: string; detail?: string };

export interface InvokeCapabilityControlArgs {
  request: CapabilityControlRequest;
  /** Signed caller context from the dispatch payload; empty = unavailable. */
  callerContext: string;
  /** Env snapshot from `snapshotRuntimeEnv` (carries the fn name). */
  env: Pick<RuntimeEnvSnapshot, "capabilityControlFnName">;
  lambdaClient: Pick<LambdaClient, "send">;
}

export async function invokeCapabilityControl(
  args: InvokeCapabilityControlArgs,
): Promise<CapabilityControlOutcome> {
  if (!args.env.capabilityControlFnName) {
    return {
      ok: false,
      reason: "capability_control_unconfigured",
      detail:
        "CAPABILITY_CONTROL_FN_NAME is not set in this runtime environment",
    };
  }
  if (!args.callerContext) {
    return {
      ok: false,
      reason: "caller_context_unavailable",
      detail:
        "this dispatch did not carry a signed capability caller context — " +
        "capability control-plane tools are disabled for the turn",
    };
  }

  let raw: Uint8Array | undefined;
  let functionError: string | undefined;
  try {
    const response = await args.lambdaClient.send(
      new InvokeCommand({
        FunctionName: args.env.capabilityControlFnName,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(
          JSON.stringify({
            ...args.request,
            callerContext: args.callerContext,
          }),
        ),
      }),
    );
    raw = response.Payload;
    functionError = response.FunctionError;
  } catch (err) {
    return {
      ok: false,
      reason: "invoke_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (functionError) {
    return { ok: false, reason: "function_error", detail: functionError };
  }
  if (!raw || raw.length === 0) {
    return { ok: false, reason: "empty_response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { ok: false, reason: "unparseable_response" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "unparseable_response" };
  }
  const record = parsed as Record<string, unknown>;
  if (record.ok === true) {
    return {
      ok: true,
      action: args.request.action,
      result: record.result ?? null,
    };
  }
  return {
    ok: false,
    reason: typeof record.reason === "string" ? record.reason : "rejected",
    ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
  };
}

/**
 * Render an outcome as tool text: safe reasons only — the service already
 * returns operator-safe strings, and this client adds nothing secret.
 */
export function describeCapabilityControlFailure(
  outcome: Extract<CapabilityControlOutcome, { ok: false }>,
): string {
  return outcome.detail
    ? `${outcome.reason}: ${outcome.detail}`
    : outcome.reason;
}
