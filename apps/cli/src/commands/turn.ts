/**
 * `thinkwork turn ...` — agent invocations (a.k.a. thread turns) in progress
 * or recently completed. Useful for diagnosing stuck agents.
 *
 * Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerTurnCommand(program: Command): void {
  const turn = program
    .command("turn")
    .alias("turns")
    .description("Inspect and cancel agent invocations (thread turns).");

  turn
    .command("list")
    .alias("ls")
    .description("List recent thread turns across the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--agent <id>", "Filter by agent")
    .option("--routine <id>", "Filter by routine")
    .option("--trigger <id>", "Filter by trigger ID")
    .option("--thread <id>", "Filter by thread")
    .option("--status <s>", "QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED")
    .option("--limit <n>", "Max rows", "50")
    .addHelpText(
      "after",
      `
Examples:
  # What's running right now?
  $ thinkwork turn list --status RUNNING

  # Recent failures for one agent
  $ thinkwork turn list --agent agt-ops --status FAILED --limit 20
`,
    )
    .action(() => notYetImplemented("turn list", 3));

  turn
    .command("get <id>")
    .description("Fetch one thread turn with its event stream.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("turn get", 3));

  turn
    .command("cancel <id>")
    .description("Cancel an in-progress thread turn. No-op if already finished.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("turn cancel", 3));
}
