import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { ApproveInboxItemDoc } from "./gql.js";
import { resolveInboxContext, type InboxCliOptions } from "./helpers.js";

interface ApproveOptions extends InboxCliOptions {
  notes?: string;
  values?: string;
}

export async function runInboxApprove(
  id: string,
  opts: ApproveOptions,
): Promise<void> {
  const ctx = await resolveInboxContext(opts);

  const input =
    opts.notes || opts.values
      ? {
          ...(opts.notes ? { reviewNotes: opts.notes } : {}),
          ...(opts.values
            ? { decisionValues: normalizeJsonFlag(opts.values) }
            : {}),
        }
      : null;
  const data = await gqlMutate(ctx.client, ApproveInboxItemDoc, {
    id,
    input,
  });
  const item = data.approveInboxItem;

  if (isJsonMode()) {
    printJson(item);
    return;
  }
  printSuccess(`Approved inbox item ${item.id} (status now ${item.status})`);
}

function normalizeJsonFlag(value: string): string {
  try {
    JSON.parse(value);
    return value;
  } catch (err) {
    throw new Error(
      `--values must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
