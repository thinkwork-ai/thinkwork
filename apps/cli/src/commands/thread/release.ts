import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { ReleaseThreadDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface ReleaseOptions extends ThreadCliOptions {
  runId?: string;
}

export async function runThreadRelease(
  id: string,
  opts: ReleaseOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);

  if (!opts.runId) {
    printError(
      "--run-id <id> is required. Use the run ID printed by `thinkwork thread checkout`.",
    );
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, ReleaseThreadDoc, {
    id,
    input: { runId: opts.runId },
  });
  const t = data.releaseThread;

  if (isJsonMode()) {
    printJson(t);
    return;
  }
  printSuccess(`Released thread ${t.id} (status now ${t.status})`);
}
