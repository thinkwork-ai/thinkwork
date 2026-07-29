/**
 * Resolve the workflow-interpreter Step Functions state-machine ARN (THINK-219).
 *
 * The ARN is NOT an env var — graphql-http's env block is at the 4 KB ceiling
 * (see docs: graphql-http env 4KB ceiling). It lives in SSM Parameter Store at
 * `/thinkwork/<stage>/workflow-interpreter/state-machine-arn` and is read once
 * per warm Lambda container, then cached. Mirrors the
 * chat-agent-invoke SSM pattern in graphql/utils.ts.
 */
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});
let cached: string | null | undefined;

/** Test seam: clear the module cache between cases. */
export function _resetInterpreterStateMachineArnCache(): void {
  cached = undefined;
}

export async function resolveInterpreterStateMachineArn(): Promise<
  string | null
> {
  if (cached !== undefined) return cached;
  let stage = process.env.STAGE || "";
  if (!stage && process.env.SST_RESOURCE_App) {
    try {
      stage = JSON.parse(process.env.SST_RESOURCE_App).stage;
    } catch {
      /* ignore malformed SST resource env */
    }
  }
  if (!stage) stage = "dev";
  try {
    const res = await ssm.send(
      new GetParameterCommand({
        Name: `/thinkwork/${stage}/workflow-interpreter/state-machine-arn`,
      }),
    );
    cached = res.Parameter?.Value || null;
  } catch (err) {
    console.warn(
      `[graphql] workflow-interpreter state-machine-arn SSM lookup failed: ${(err as Error)?.name}: ${(err as Error)?.message}`,
    );
    cached = null;
  }
  return cached;
}
