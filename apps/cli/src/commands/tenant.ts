/**
 * `thinkwork tenant ...` — tenant (workspace) CRUD and settings.
 *
 * Scaffolded in Phase 0; ships in Phase 2.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";

export function registerTenantCommand(program: Command): void {
  const tenant = program
    .command("tenant")
    .alias("tenants")
    .description("Manage tenants (workspaces) — create, rename, and configure plans / defaults.");

  tenant
    .command("list")
    .alias("ls")
    .description("List tenants the caller can see.")
    .option("-s, --stage <name>", "Deployment stage")
    .action(() => notYetImplemented("tenant list", 2));

  tenant
    .command("get <idOrSlug>")
    .description("Fetch one tenant by ID or slug.")
    .option("-s, --stage <name>", "Deployment stage")
    .action(() => notYetImplemented("tenant get", 2));

  tenant
    .command("create [name]")
    .description("Create a new tenant. The caller becomes its first owner.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--slug <slug>", "URL-safe slug (lowercase, hyphens). Generated from name if omitted.")
    .option("--plan <plan>", "Plan tier (free, team, enterprise, …)", "team")
    .option("--issue-prefix <prefix>", "Issue-number prefix for thread numbers (e.g. ACME)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork tenant create "Acme Corp" --slug acme --plan team
`,
    )
    .action(() => notYetImplemented("tenant create", 2));

  tenant
    .command("update <id>")
    .description("Update tenant name, plan, or issue-prefix.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--name <n>")
    .option("--plan <plan>")
    .option("--issue-prefix <prefix>")
    .action(() => notYetImplemented("tenant update", 2));

  // ----- Settings sub-group -------------------------------------------------

  const settings = tenant
    .command("settings")
    .description("Tenant-wide defaults — model, budget, auto-close, feature flags.");

  settings
    .command("get [tenant]")
    .description("Print the current TenantSettings (human) or the full object (--json).")
    .option("-s, --stage <name>", "Deployment stage")
    .action(() => notYetImplemented("tenant settings get", 2));

  settings
    .command("set [tenant]")
    .description("Set one or more TenantSettings fields. Each --<field> flag is independent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--default-model <id>")
    .option("--monthly-budget-usd <n>")
    .option("--max-agents <n>")
    .option("--auto-close-after-days <n>")
    .option("--feature <key=value...>", "Toggle a feature flag (repeatable)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork tenant settings set --default-model claude-sonnet-4-6
  $ thinkwork tenant settings set --monthly-budget-usd 5000 --feature hindsight=true
`,
    )
    .action(() => notYetImplemented("tenant settings set", 2));
}
