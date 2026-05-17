import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { ApproveInboxItemDoc } from "./gql.js";
import { resolveInboxContext, type InboxCliOptions } from "./helpers.js";

interface ApproveOptions extends InboxCliOptions {
  notes?: string;
}

export async function runInboxApprove(id: string, opts: ApproveOptions): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  const data = await gqlMutate(ctx.client, ApproveInboxItemDoc, {
    id,
    input: opts.notes ? { reviewNotes: opts.notes } : null,
  });
  const item = data.approveInboxItem;

  if (isJsonMode()) {
    printJson(item);
    return;
  }
  printSuccess(`Approved inbox item ${item.id} (status now ${item.status})`);
}
