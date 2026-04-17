import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { CancelEvalRunDoc } from "./gql.js";
import { resolveEvalContext, type EvalCliOptions } from "./helpers.js";

export async function runEvalCancel(runId: string, opts: EvalCliOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);
  const data = await gqlMutate(ctx.client, CancelEvalRunDoc, { id: runId });
  if (isJsonMode()) {
    printJson({ runId: data.cancelEvalRun.id, status: data.cancelEvalRun.status });
    return;
  }
  printSuccess(`Cancelled run ${data.cancelEvalRun.id} (status: ${data.cancelEvalRun.status}).`);
}
