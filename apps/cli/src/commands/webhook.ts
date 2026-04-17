/**
 * `thinkwork webhook ...` — inbound webhooks that dispatch agents or routines.
 *
 * Uses REST (same as admin). Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerWebhookCommand(program: Command): void {
  const wh = program
    .command("webhook")
    .alias("webhooks")
    .description("Manage inbound webhooks that dispatch to agents or routines.");

  wh
    .command("list")
    .alias("ls")
    .description("List webhooks in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--enabled <bool>", "true | false")
    .option("--target-type <t>", "AGENT | ROUTINE")
    .action(() => notYetImplemented("webhook list", 3));

  wh
    .command("get <id>")
    .description("Fetch one webhook including its secret prefix + rate limit.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("webhook get", 3));

  wh
    .command("create [name]")
    .description("Create a new webhook. The full secret is printed once.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--target-type <t>", "AGENT | ROUTINE")
    .option("--target-id <id>", "ID of the agent or routine")
    .option("--rate-limit <rpm>", "Max requests per minute")
    .option("--allowed-ips <csv>", "Restrict to a CIDR list")
    .option("--disabled", "Create in disabled state")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork webhook create "GitHub PR opened" \\
      --target-type AGENT --target-id agt-reviewer --rate-limit 30

  # CI use — capture the secret on create
  $ thinkwork webhook create "CI" --target-type ROUTINE --target-id rtn-ci --json | jq -r .secret
`,
    )
    .action(() => notYetImplemented("webhook create", 3));

  wh
    .command("update <id>")
    .description("Update a webhook's target, rate limit, or enabled state.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--target-type <t>")
    .option("--target-id <id>")
    .option("--rate-limit <rpm>")
    .option("--allowed-ips <csv>")
    .option("--enable")
    .option("--disable")
    .action(() => notYetImplemented("webhook update", 3));

  wh
    .command("delete <id>")
    .description("Delete a webhook (its URL stops working immediately).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("webhook delete", 3));

  wh
    .command("test <id>")
    .description("Send a synthetic payload to the webhook and print the resulting run ID.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--payload <json>")
    .action(() => notYetImplemented("webhook test", 3));

  wh
    .command("rotate <id>")
    .description("Generate a new secret for an existing webhook. Old secret is invalidated.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("webhook rotate", 3));

  wh
    .command("deliveries <id>")
    .description("Show recent delivery attempts (success/failure, response status).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--limit <n>", "Max rows", "25")
    .action(() => notYetImplemented("webhook deliveries", 3));
}
