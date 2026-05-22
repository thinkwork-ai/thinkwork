import { printError } from "../../ui.js";
import type { AgentCliOptions } from "./helpers.js";

function retiredAgentCommand(): never {
  printError(
    "This command has been retired. Use 'thinkwork tenant-agent' instead.",
  );
  process.exit(1);
}

export async function runAgentBudgetSet(
  _agentId: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentBudgetClear(
  _agentId: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}
