import { confirm } from "@inquirer/prompts";
import { gqlMutate } from "../../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../../lib/interactive.js";
import { isJsonMode, logStderr, printJson } from "../../../lib/output.js";
import { printError, printSuccess } from "../../../ui.js";
import { DeleteEvalTestCaseDoc } from "../gql.js";
import { resolveEvalContext, type EvalCliOptions } from "../helpers.js";

interface DeleteOptions extends EvalCliOptions {
  yes?: boolean;
}

export async function runEvalTestCaseDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveEvalContext(opts);

  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({ message: `Permanently delete test case ${id}?`, default: false }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }

  const res = await gqlMutate(ctx.client, DeleteEvalTestCaseDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: res.deleteEvalTestCase });
    return;
  }
  if (res.deleteEvalTestCase) printSuccess(`Deleted test case ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}
