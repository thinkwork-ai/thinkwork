/**
 * `thinkwork budget ...` — tenant or per-agent spend policies.
 *
 * Scaffolded in Phase 0; ships in Phase 5.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerBudgetCommand(program: Command): void {
  const budget = program
    .command("budget")
    .alias("budgets")
    .description("Manage budget policies (tenant-wide or per-agent) and inspect current status.");

  budget
    .command("list")
    .alias("ls")
    .description("List budget policies in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("budget list", 5));

  budget
    .command("status")
    .description("Show each budget's current spend vs. limit.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("budget status", 5));

  budget
    .command("upsert")
    .description("Create or update a budget policy.")
    .requiredOption("--limit-usd <amount>", "USD ceiling for the window")
    .option("--scope <s>", "tenant | agent", "tenant")
    .option("--agent <id>", "Required if --scope=agent")
    .option("--window <w>", "daily | weekly | monthly", "monthly")
    .option("--action <a>", "PAUSE | ALERT", "PAUSE")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  # Tenant-wide $5k/month pause
  $ thinkwork budget upsert --limit-usd 5000 --window monthly --action PAUSE

  # Per-agent alert-only
  $ thinkwork budget upsert --scope agent --agent agt-ops --limit-usd 500 --action ALERT
`,
    )
    .action(() => notYetImplemented("budget upsert", 5));

  budget
    .command("delete <id>")
    .description("Remove a budget policy.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("budget delete", 5));
}
