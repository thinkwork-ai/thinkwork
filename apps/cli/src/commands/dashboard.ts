/**
 * `thinkwork dashboard` — compact overview for a tenant (agent counts, open
 * threads, pending approvals, spend-to-date).
 *
 * Scaffolded in Phase 0; ships in Phase 5.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerDashboardCommand(program: Command): void {
  program
    .command("dashboard")
    .alias("overview")
    .description("One-screen snapshot of the tenant — agents, open threads, approvals, spend.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .addHelpText(
      "after",
      `
Examples:
  # Print the dashboard for the default tenant
  $ thinkwork dashboard

  # Check a specific stage
  $ thinkwork dashboard --stage prod
`,
    )
    .action(() => notYetImplemented("dashboard", 5));
}
