import { confirm } from "@inquirer/prompts";
import { gqlMutate } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, logStderr, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { DeleteThreadDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface DeleteOptions extends ThreadCliOptions {
  yes?: boolean;
}

export async function runThreadDelete(id: string, opts: DeleteOptions): Promise<void> {
  const ctx = await resolveThreadContext(opts);

  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to delete without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Permanently delete thread ${id}?`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }

  const data = await gqlMutate(ctx.client, DeleteThreadDoc, { id });
  if (isJsonMode()) {
    printJson({ id, deleted: data.deleteThread });
    return;
  }
  if (data.deleteThread) printSuccess(`Deleted thread ${id}.`);
  else printError(`Server reported not-deleted for ${id}.`);
}
