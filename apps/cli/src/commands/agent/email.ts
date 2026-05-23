import { printError } from "../../ui.js";
import type { AgentCliOptions } from "./helpers.js";

function retiredAgentCommand(): never {
  printError(
    "This command has been retired. Use 'thinkwork tenant-agent' instead.",
  );
  process.exit(1);
}

export async function runAgentEmailEnable(
  _agentId: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentEmailDisable(
  _agentId: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentEmailAllowlist(
  _agentId: string,
  _senders: string[],
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}
