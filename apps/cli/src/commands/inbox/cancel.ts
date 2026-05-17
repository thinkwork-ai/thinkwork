import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { CancelInboxItemDoc } from "./gql.js";
import { resolveInboxContext, type InboxCliOptions } from "./helpers.js";

export async function runInboxCancel(id: string, opts: InboxCliOptions): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  const data = await gqlMutate(ctx.client, CancelInboxItemDoc, { id });
  const item = data.cancelInboxItem;

  if (isJsonMode()) {
    printJson(item);
    return;
  }
  printSuccess(`Cancelled inbox item ${item.id} (status now ${item.status})`);
}
