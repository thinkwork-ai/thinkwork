import { getKbManagerFnArn } from "../../utils.js";

export type KbManagerAction = "create" | "sync" | "delete";

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
