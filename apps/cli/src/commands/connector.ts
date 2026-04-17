/**
 * `thinkwork connector ...` — third-party integrations (Slack, GitHub, etc.)
 * the tenant can enable or disable.
 *
 * Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerConnectorCommand(program: Command): void {
  const conn = program
    .command("connector")
    .alias("connectors")
    .description("Manage third-party integrations (Slack, GitHub, Linear, …).");

  conn
    .command("list")
    .alias("ls")
    .description("List available connectors and which are enabled for this tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--enabled-only", "Only show tenant-enabled connectors")
    .action(() => notYetImplemented("connector list", 3));

  conn
    .command("get <slug>")
    .description("Fetch one connector with its config schema + current status.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("connector get", 3));

  conn
    .command("enable <slug>")
    .description("Enable a connector. Opens the OAuth flow in your browser when required.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--config <json>", "Inline config JSON (for API-key style connectors)")
    .option("--config-file <path>", "Load config from a file")
    .addHelpText(
      "after",
      `
Examples:
  # OAuth connector (Slack)
  $ thinkwork connector enable slack

  # API-key connector (inline)
  $ thinkwork connector enable linear --config '{"apiKey":"lin_…"}'
`,
    )
    .action(() => notYetImplemented("connector enable", 3));

  conn
    .command("disable <slug>")
    .description("Disable a connector. Stored credentials are cleared.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("connector disable", 3));

  conn
    .command("test <slug>")
    .description("Round-trip the connector's credentials against its API. Prints pass/fail + latency.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("connector test", 3));
}
