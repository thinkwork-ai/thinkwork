/**
 * `thinkwork memory ...` — inspect + edit an agent's managed memory
 * (AgentCore / Hindsight) plus the memory graph.
 *
 * Scaffolded in Phase 0; ships in Phase 4.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerMemoryCommand(program: Command): void {
  const memory = program
    .command("memory")
    .description("Inspect, search, and edit an agent's memory records and graph.");

  memory
    .command("list")
    .alias("ls")
    .description("List memory records for an agent in a namespace.")
    .requiredOption("--agent <id>", "Agent (assistant) ID")
    .option(
      "--namespace <ns>",
      "Memory namespace (semantic | preferences | episodes | reflections)",
      "semantic",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("memory list", 4));

  memory
    .command("search")
    .description("Search an agent's memory by query string.")
    .requiredOption("--agent <id>", "Agent (assistant) ID")
    .requiredOption("--query <q>", "Search query")
    .option("--strategy <s>", "Retrieval strategy (semantic | keyword | hybrid)", "semantic")
    .option("--limit <n>", "Max results", "10")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork memory search --agent agt-ops --query "escalation procedure"
  $ thinkwork memory search --agent agt-ops --query "p0 runbook" --strategy hybrid --json
`,
    )
    .action(() => notYetImplemented("memory search", 4));

  memory
    .command("get <recordId>")
    .description("Fetch one memory record in full.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("memory get", 4));

  memory
    .command("update <recordId>")
    .description("Replace a memory record's content.")
    .requiredOption("--content <text>", "New content")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("memory update", 4));

  memory
    .command("delete <recordId>")
    .description("Remove a memory record.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("memory delete", 4));

  memory
    .command("graph")
    .description("Print the agent's memory graph (summary in human mode; full JSON with --json).")
    .requiredOption("--agent <id>", "Agent (assistant) ID")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("memory graph", 4));
}
