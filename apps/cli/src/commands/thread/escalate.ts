import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { EscalateThreadDoc } from "./gql.js";
import { resolveThreadContext, type ThreadCliOptions } from "./helpers.js";

interface EscalateOptions extends ThreadCliOptions {
  toAgent?: string;
  reason?: string;
}

export async function runThreadEscalate(
  id: string,
  opts: EscalateOptions,
): Promise<void> {
  const ctx = await resolveThreadContext(opts);

  if (!opts.toAgent) {
    printError("--to-agent <id> is required.");
    process.exit(1);
  }
  if (!opts.reason) {
    printError("--reason <text> is required for escalation (recorded in activity log).");
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, EscalateThreadDoc, {
    input: {
      threadId: id,
      reason: opts.reason,
      agentId: opts.toAgent,
    },
  });
  const t = data.escalateThread;

  if (isJsonMode()) {
    printJson(t);
    return;
  }
  printSuccess(`Escalated thread ${t.id} → agent ${opts.toAgent}`);
}
