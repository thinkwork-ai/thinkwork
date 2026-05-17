import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { ResubmitInboxItemDoc } from "./gql.js";
import { resolveInboxContext, type InboxCliOptions } from "./helpers.js";

interface ResubmitOptions extends InboxCliOptions {
  notes?: string;
}

export async function runInboxResubmit(id: string, opts: ResubmitOptions): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  // ResubmitInboxItemInput supports {title, description, config}. The CLI
  // surfaces `--notes` for symmetry with approve/reject — we route it into
  // description if provided, since no dedicated notes field exists on the
  // resubmit input. For richer payloads, use the admin UI.
  const data = await gqlMutate(ctx.client, ResubmitInboxItemDoc, {
    id,
    input: opts.notes ? { description: opts.notes } : null,
  });
  const item = data.resubmitInboxItem;

  if (isJsonMode()) {
    printJson(item);
    return;
  }
  printSuccess(`Resubmitted inbox item ${item.id} (revision #${item.revision})`);
}
