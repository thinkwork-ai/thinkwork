import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { DelegateThreadDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface DelegateOptions extends ThreadCliOptions {
  toAgent?: string;
  reason?: string;
}

export async function runThreadDelegate(
  id: string,
  opts: DelegateOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);

  if (!opts.toAgent) {
    printError("--to-agent <id> is required.");
    process.exit(1);
  }
  if (!ctx.principalId) {
    printError(
      "Delegation requires a Cognito session (the API records who delegated). Run `thinkwork login --stage <s>`.",
    );
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, DelegateThreadDoc, {
    input: {
      threadId: id,
      assigneeId: opts.toAgent,
      reason: opts.reason ?? null,
      agentId: ctx.principalId,
    },
  });
  const t = data.delegateThread;

  if (isJsonMode()) {
    printJson(t);
    return;
  }
  printSuccess(`Delegated thread ${t.id} → agent ${opts.toAgent}`);
}
