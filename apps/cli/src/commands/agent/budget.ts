import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { DeleteAgentBudgetPolicyDoc, SetAgentBudgetPolicyDoc } from "./gql.js";
import { resolveAgentContext, type AgentCliOptions } from "./helpers.js";

interface SetOptions extends AgentCliOptions {
  limitUsd?: string;
  window?: string;
  action?: string;
}

export async function runAgentBudgetSet(
  agentId: string,
  opts: SetOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  if (!opts.limitUsd) {
    printError("--limit-usd <amount> is required.");
    process.exit(1);
  }
  const limitUsd = Number.parseFloat(opts.limitUsd);
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
    printError(`--limit-usd "${opts.limitUsd}" must be a positive number.`);
    process.exit(1);
  }
  const period = (opts.window ?? "monthly").toLowerCase();
  if (!["daily", "weekly", "monthly"].includes(period)) {
    printError(`--window "${opts.window}" must be daily | weekly | monthly.`);
    process.exit(1);
  }
  const actionOnExceed = (opts.action ?? "PAUSE").toUpperCase();
  if (!["PAUSE", "ALERT"].includes(actionOnExceed)) {
    printError(`--action "${opts.action}" must be PAUSE | ALERT.`);
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, SetAgentBudgetPolicyDoc, {
    agentId,
    input: { limitUsd, period, actionOnExceed },
  });
  if (isJsonMode()) {
    printJson(data.setAgentBudgetPolicy);
    return;
  }
  printSuccess(
    `Set budget on agent ${agentId}: $${limitUsd.toFixed(2)}/${period}, action: ${actionOnExceed}.`,
  );
}

export async function runAgentBudgetClear(
  agentId: string,
  opts: AgentCliOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const data = await gqlMutate(ctx.client, DeleteAgentBudgetPolicyDoc, { agentId });
  if (isJsonMode()) {
    printJson({ agentId, deleted: data.deleteAgentBudgetPolicy });
    return;
  }
  if (data.deleteAgentBudgetPolicy)
    printSuccess(`Cleared budget policy on agent ${agentId} (falls back to tenant-wide).`);
  else printError(`Server reported not-deleted for budget policy on ${agentId}.`);
}
