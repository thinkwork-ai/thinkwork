import { printError } from "../../ui.js";
import type { AgentCliOptions } from "./helpers.js";

function retiredAgentCommand(): never {
  printError(
    "This command has been retired. Use 'thinkwork tenant-agent' instead.",
  );
  process.exit(1);
}

export async function runAgentApiKeyList(
  _agentId: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentApiKeyCreate(
  _agentId: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentApiKeyRevoke(
  _id: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}
