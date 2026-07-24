import { getKbManagerFnArn } from "../../utils.js";

export type KbManagerAction = "create" | "sync" | "delete" | "rechunk";

/**
 * Invoke the knowledge-base manager Lambda for a provisioning action.
 *
 * Unlike the previous inline fire-and-forget blocks, this throws when the
 * manager cannot be reached — a null ARN (misconfiguration) or a failed
 * `.send()`. User-initiated callers (create/sync) surface that failure to
 * the operator instead of returning a fake-success row; best-effort callers
 * (delete, where the DB rows are already cleaned) catch and log. The Bedrock
 * work itself stays asynchronous (`InvocationType: "Event"`) — only the
 * dispatch is awaited.
 */
export async function dispatchKbManager(
  action: KbManagerAction,
  knowledgeBaseId: string,
): Promise<void> {
  const arn = await getKbManagerFnArn();
  if (!arn) {
    throw new Error("Knowledge base manager function is not configured");
  }
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  await lambda.send(
    new InvokeCommand({
      FunctionName: arn,
      InvocationType: "Event",
      Payload: JSON.stringify({ action, knowledgeBaseId }),
    }),
  );
}

/**
 * RequestResponse variant for operator-initiated connect operations
 * (external S3 KB source KTD7): connect failures are IAM/preflight failures,
 * which fire-and-forget turns into a permanently stuck status. The manager's
 * thrown error is decoded from the FunctionError payload and re-thrown so
 * the resolver surfaces the real reason (missing grant, cross-account, …).
 */
export async function dispatchKbManagerSync<T>(
  action: "connect_source",
  knowledgeBaseId: string,
  extra: Record<string, unknown>,
): Promise<T> {
  const arn = await getKbManagerFnArn();
  if (!arn) {
    throw new Error("Knowledge base manager function is not configured");
  }
  const { LambdaClient, InvokeCommand } =
    await import("@aws-sdk/client-lambda");
  const lambda = new LambdaClient({});
  const resp = await lambda.send(
    new InvokeCommand({
      FunctionName: arn,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({ action, knowledgeBaseId, ...extra }),
    }),
  );
  const raw = resp.Payload
    ? Buffer.from(resp.Payload).toString("utf-8")
    : "null";
  if (resp.FunctionError) {
    let message = raw;
    try {
      const parsed = JSON.parse(raw);
      message = parsed.errorMessage ?? raw;
    } catch {
      // keep raw
    }
    throw new Error(message);
  }
  return JSON.parse(raw) as T;
}
