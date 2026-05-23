import { printError } from "../../ui.js";
import type { AgentCliOptions } from "./helpers.js";

function retiredAgentCommand(): never {
  printError(
    "This command has been retired. Use 'thinkwork tenant-agent' instead.",
  );
  process.exit(1);
}

export async function runAgentList(_opts: AgentCliOptions): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentGet(
  _id: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentCreate(
  _name: string | undefined,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentUpdate(
  _id: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentDelete(
  _id: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentStatus(
  _id: string,
  _statusRaw: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}

export async function runAgentUnpause(
  _id: string,
  _opts: AgentCliOptions,
): Promise<void> {
  retiredAgentCommand();
}
