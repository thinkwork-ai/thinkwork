/**
 * `thinkwork team ...` — teams (workspace subdivisions) with agent/user
 * membership and optional sub-budgets.
 *
 * Scaffolded in Phase 0; ships in Phase 2.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerTeamCommand(program: Command): void {
  const team = program
    .command("team")
    .alias("teams")
    .description("Manage teams within a tenant.");

  team
    .command("list")
    .alias("ls")
    .description("List teams in the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("team list", 2));

  team
    .command("get <id>")
    .description("Fetch one team with its members and agents.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("team get", 2));

  team
    .command("create [name]")
    .description("Create a new team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--description <text>")
    .option("--budget-usd <n>", "Optional sub-budget")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork team create "Ops" --description "24/7 on-call" --budget-usd 2000
`,
    )
    .action(() => notYetImplemented("team create", 2));

  team
    .command("update <id>")
    .description("Update team name, description, status, or budget.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--status <s>", "active | archived")
    .option("--budget-usd <n>")
    .action(() => notYetImplemented("team update", 2));

  team
    .command("delete <id>")
    .description("Delete (archive) a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("team delete", 2));

  team
    .command("add-agent <teamId> <agentId>")
    .description("Add an agent to a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("team add-agent", 2));

  team
    .command("remove-agent <teamId> <agentId>")
    .description("Remove an agent from a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("team remove-agent", 2));

  team
    .command("add-user <teamId> <userId>")
    .description("Add a user to a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("team add-user", 2));

  team
    .command("remove-user <teamId> <userId>")
    .description("Remove a user from a team.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("team remove-user", 2));
}
