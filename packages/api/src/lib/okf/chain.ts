/**
 * OKF distribution chain (THINK-200 / Brain Quality P5).
 *
 * wiki-compile success → okf-materialize (tenant) → okf-efs-refresh (slug):
 * each hop is an async Lambda invoke, env-gated on the target function name
 * so the chain ships inert until terraform wires the env vars. Both hops are
 * best-effort background fan-out (the enqueue.ts precedent): a chain fault
 * logs and never fails the step that triggered it — the drainer/scheduler
 * will light the projection again on the next compile.
 */

import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION || "us-east-1";

let lambdaClient: LambdaClient | null = null;

function getLambda(): LambdaClient {
  if (!lambdaClient) lambdaClient = new LambdaClient({ region: REGION });
  return lambdaClient;
}

/** Test seam. */
export function setOkfChainLambdaClient(client: LambdaClient | null): void {
  lambdaClient = client;
}

async function invokeAsync(
  functionName: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<boolean> {
  try {
    await getLambda().send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(payload)),
      }),
    );
    console.log(`[okf-chain] ${label} enqueued fn=${functionName}`);
    return true;
  } catch (err) {
    console.warn(
      `[okf-chain] ${label} invoke failed (best-effort): ${(err as Error)?.message ?? err}`,
    );
    return false;
  }
}

/**
 * Called by wiki-compile after a job finishes. Fires only on success; no-op
 * unless OKF_MATERIALIZE_FN_NAME is configured.
 */
export async function maybeChainOkfMaterialize(input: {
  tenantId: string | null | undefined;
  status: string | undefined;
}): Promise<boolean> {
  const fn = process.env.OKF_MATERIALIZE_FN_NAME?.trim();
  if (!fn || input.status !== "succeeded" || !input.tenantId) return false;
  return invokeAsync(fn, { tenantId: input.tenantId }, "materialize");
}

/**
 * Called by okf-materialize after publishing bundles. No-op unless
 * OKF_EFS_REFRESH_FN_NAME is configured or nothing was published.
 */
export async function maybeChainOkfEfsRefresh(
  tenantSlugs: string[],
): Promise<boolean> {
  const fn = process.env.OKF_EFS_REFRESH_FN_NAME?.trim();
  const slugs = [...new Set(tenantSlugs.filter((slug) => slug?.trim()))];
  if (!fn || slugs.length === 0) return false;
  return invokeAsync(fn, { tenantSlugs: slugs }, "efs-refresh");
}
