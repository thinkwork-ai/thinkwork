import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { RejectInboxItemDoc } from "./gql.js";
import { resolveInboxContext, type InboxCliOptions } from "./helpers.js";

interface RejectOptions extends InboxCliOptions {
  notes?: string;
}

export async function runInboxReject(id: string, opts: RejectOptions): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  const data = await gqlMutate(ctx.client, RejectInboxItemDoc, {
    id,
    input: opts.notes ? { reviewNotes: opts.notes } : null,
  });
  const item = data.rejectInboxItem;

  if (isJsonMode()) {
    printJson(item);
    return;
  }
  printSuccess(`Rejected inbox item ${item.id} (status now ${item.status})`);
}
