/**
 * `thinkwork cost ...` — spend summaries (tenant, per-agent, per-model, series).
 *
 * Scaffolded in Phase 0; ships in Phase 5.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerCostCommand(program: Command): void {
  const cost = program
    .command("cost")
    .description("Spend reports — totals, per-agent, per-model, and daily series.");

  cost
    .command("summary")
    .description("Total spend for the tenant over an optional date range.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>", "Start date (ISO-8601)")
    .option("--to <iso>", "End date (ISO-8601)")
    .addHelpText(
      "after",
      `
Examples:
  # MTD spend
  $ thinkwork cost summary

  # Specific window
  $ thinkwork cost summary --from 2026-04-01 --to 2026-04-30 --json
`,
    )
    .action(() => notYetImplemented("cost summary", 5));

  cost
    .command("by-agent")
    .description("Spend broken down by agent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>")
    .option("--to <iso>")
    .option("--sort <field>", "cost | requests (default cost)", "cost")
    .action(() => notYetImplemented("cost by-agent", 5));

  cost
    .command("by-model")
    .description("Spend broken down by model ID (tokens + cost).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--from <iso>")
    .option("--to <iso>")
    .action(() => notYetImplemented("cost by-model", 5));

  cost
    .command("series")
    .description("Daily cost series.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--days <n>", "Days of history", "30")
    .action(() => notYetImplemented("cost series", 5));
}
