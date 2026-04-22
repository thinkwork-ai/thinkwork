/**
 * sandbox-provisioning — client wrapper for the agentcore-admin Lambda's
 * `/provision-tenant-sandbox` route (plan Unit 5).
 *
 * Invoked by `createTenant` (plan Unit 6) with `InvocationType: "RequestResponse"`
 * so errors propagate to the caller (per `feedback_avoid_fire_and_forget_lambda_invokes`).
 *
 * A 45-second timeout matches the handler's own budget. When provisioning
 * exceeds that budget, the caller should log + continue (the tenant row
 * already exists; the reconciler — Unit 6 follow-up — will fill the gap).
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});

export interface ProvisionResult {
  ok: boolean;
  partial: boolean;
  tenant_id: string;
  role_arn: string;
  interpreters: {
    public_id: string | null;
    internal_id: string | null;
  };
  error?: string;
}

export class SandboxProvisioningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxProvisioningConfigError";
  }
}

/**
 * Invoke the agentcore-admin Lambda to provision per-tenant sandbox resources.
 *
 * Throws:
 *   - SandboxProvisioningConfigError — env vars missing, safe to log + skip.
 *   - Error (generic) — Lambda returned non-2xx or errored out. Caller should
 *     log + continue; the reconciler will retry.
 *
 * Returns the structured ProvisionResult on success (including `partial=true`
 * when one of the two interpreters created but the other did not).
 */
export async function invokeProvisionTenantSandbox(args: {
  tenantId: string;
  /** Override the env-backed bearer token (tests mostly). */
  bearerToken?: string;
  /** Override the env-backed function ARN (tests mostly). */
  functionArn?: string;
  /** Abort the invocation after this many ms. Default 45000 (matches Lambda side). */
  timeoutMs?: number;
}): Promise<ProvisionResult> {
  const functionArn =
    args.functionArn ?? process.env.AGENTCORE_ADMIN_LAMBDA_ARN;
  if (!functionArn) {
    throw new SandboxProvisioningConfigError(
      "AGENTCORE_ADMIN_LAMBDA_ARN not configured",
    );
  }
  const bearerToken = args.bearerToken ?? process.env.AGENTCORE_ADMIN_TOKEN;
  if (!bearerToken) {
    throw new SandboxProvisioningConfigError(
      "AGENTCORE_ADMIN_TOKEN not configured",
    );
  }

  const event = buildInvocationEvent(args.tenantId, bearerToken);

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), args.timeoutMs ?? 45_000);

  try {
    const res = await lambda.send(
      new InvokeCommand({
        FunctionName: functionArn,
        InvocationType: "RequestResponse",
        Payload: new TextEncoder().encode(JSON.stringify(event)),
      }),
      { abortSignal: abort.signal },
    );
    return interpretResponse(res);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

export function buildInvocationEvent(
  tenantId: string,
  bearerToken: string,
): Record<string, unknown> {
  // agentcore-admin routes off event.requestContext.http and event.body; this
  // shape matches the API Gateway v2 envelope the handler is written for.
  return {
    requestContext: {
      http: { method: "POST", path: "/provision-tenant-sandbox" },
    },
    httpMethod: "POST",
    path: "/provision-tenant-sandbox",
    headers: { Authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify({ tenant_id: tenantId }),
  };
}

export function interpretResponse(res: {
  FunctionError?: string;
  Payload?: Uint8Array;
}): ProvisionResult {
  const text = new TextDecoder().decode(res.Payload ?? new Uint8Array(0));
  const parsed = safeParse(text);
  if (res.FunctionError) {
    throw new Error(
      `agentcore-admin Lambda error: ${parsed?.errorMessage ?? text}`,
    );
  }
  const statusCode = parsed?.statusCode ?? 500;
  const body = parseMaybeString(parsed?.body);
  if (statusCode >= 400) {
    throw new Error(
      `provisionTenantSandbox failed (${statusCode}): ${body?.error ?? "unknown error"}`,
    );
  }
  return body as ProvisionResult;
}

function safeParse(raw: string): any {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseMaybeString(value: unknown): any {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}
