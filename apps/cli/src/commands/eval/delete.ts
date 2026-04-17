import { confirm } from "@inquirer/prompts";
import { gqlMutate } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, logStderr, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { DeleteEvalRunDoc } from "./gql.js";
import { resolveEvalContext, type EvalCliOptions } from "./helpers.js";

interface DeleteOptions extends EvalCliOptions {
  yes?: boolean;
}

export async function runEvalDelete(runId: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);

  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Permanently delete run ${runId} and its results?`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }

  const data = await gqlMutate(ctx.client, DeleteEvalRunDoc, { id: runId });
  if (isJsonMode()) {
    printJson({ runId, deleted: data.deleteEvalRun });
    return;
  }
  if (data.deleteEvalRun) printSuccess(`Deleted run ${runId}.`);
  else printError(`Server reported not-deleted for ${runId}.`);
}
