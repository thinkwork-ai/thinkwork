import { printError } from "../../ui.js";
import type { AgentCliOptions } from "./helpers.js";

export async function runAgentSkillsSet(
  _agentId: string,
  _opts: AgentCliOptions,
): Promise<void> {
  printError(
    "This command has been retired. Use 'thinkwork tenant-agent' instead.",
  );
  process.exit(1);
}
