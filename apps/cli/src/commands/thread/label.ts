import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { AssignThreadLabelDoc, RemoveThreadLabelDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

export async function runThreadLabel(
  verb: string,
  threadId: string,
  labelId: string,
  opts: ThreadCliOptions,
): Promise<void> {
  if (verb !== "assign" && verb !== "remove") {
    printError(`Unknown verb "${verb}". Expected "assign" or "remove".`);
    process.exit(1);
  }
  const ctx = await resolveThreadContext(opts);

  if (verb === "assign") {
    const data = await gqlMutate(ctx.client, AssignThreadLabelDoc, {
      threadId,
      labelId,
    });
    if (isJsonMode()) {
      printJson(data.assignThreadLabel);
      return;
    }
    printSuccess(`Attached label ${labelId} to thread ${threadId}`);
    return;
  }

  const data = await gqlMutate(ctx.client, RemoveThreadLabelDoc, {
    threadId,
    labelId,
  });
  if (isJsonMode()) {
    printJson({ threadId, labelId, removed: data.removeThreadLabel });
    return;
  }
  if (data.removeThreadLabel) {
    printSuccess(`Removed label ${labelId} from thread ${threadId}`);
  } else {
    printError(`Server reported not-removed for label ${labelId} on thread ${threadId}.`);
  }
}
