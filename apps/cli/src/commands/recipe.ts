/**
 * `thinkwork recipe ...` — saved MCP tool invocations (parameterized templates
 * that appear as one-click actions in the admin UI).
 *
 * Scaffolded in Phase 0; ships in Phase 4.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerRecipeCommand(program: Command): void {
  const recipe = program
    .command("recipe")
    .alias("recipes")
    .description("Manage saved MCP tool invocations (parameterized one-click actions).");

  recipe
    .command("list")
    .alias("ls")
    .description("List recipes in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--thread <id>", "Filter by thread scope")
    .option("--agent <id>", "Filter by agent scope")
    .option("--limit <n>", "Max rows", "25")
    .action(() => notYetImplemented("recipe list", 4));

  recipe
    .command("get <id>")
    .description("Fetch one recipe.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("recipe get", 4));

  recipe
    .command("create [name]")
    .description("Save a new recipe. Walkthrough for missing fields in TTY.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--tool <slug>", "MCP tool slug")
    .option("--params <json>", "Default parameters")
    .option("--scope <s>", "tenant | agent | thread", "tenant")
    .option("--agent <id>", "Required if --scope=agent")
    .option("--thread <id>", "Required if --scope=thread")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork recipe create "Create PagerDuty incident" \\
      --tool pagerduty.create_incident --params '{"urgency":"high"}'
`,
    )
    .action(() => notYetImplemented("recipe create", 4));

  recipe
    .command("update <id>")
    .description("Update a recipe's name, tool, or default params.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--tool <slug>")
    .option("--params <json>")
    .action(() => notYetImplemented("recipe update", 4));

  recipe
    .command("delete <id>")
    .description("Delete a recipe.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("recipe delete", 4));
}
