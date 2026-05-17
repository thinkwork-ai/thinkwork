import { randomUUID } from "node:crypto";
import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import { CheckoutThreadDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface CheckoutOptions extends ThreadCliOptions {
  agent?: string;
}

export async function runThreadCheckout(
  id: string,
  opts: CheckoutOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);

  // checkoutThread takes a free-form `runId` that the caller owns. Generate
  // one per invocation so the CLI never reuses someone else's lock identity.
  // Surface it to the user so they can pair `thread release` with it.
  const runId = `cli-${randomUUID()}`;

  const data = await gqlMutate(ctx.client, CheckoutThreadDoc, {
    id,
    input: { runId },
  });
  const t = data.checkoutThread;

  if (isJsonMode()) {
    printJson({ thread: t, runId });
    return;
  }
  printSuccess(`Checked out thread ${t.id} (status now ${t.status})`);
  console.log(`  Run ID: ${runId}`);
  console.log(`  Release with: thinkwork thread release ${t.id} --run-id ${runId}`);
  if (opts.agent) {
    console.log(`  (note: --agent ${opts.agent} is informational; checkout is tracked by runId)`);
  }
}
