/**
 * `thinkwork tenant ...` — tenant (workspace) CRUD and settings.
 *
 * `list` and `get` are wired to the `@thinkwork/admin-ops` package; the rest
 * remain `notYetImplemented` until the package grows their ops.
 */

import { Command } from "commander";
import { createClient, tenants as tenantOps, AdminOpsError } from "@thinkwork/admin-ops";
import { resolveApiConfig } from "../api-client.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { printError } from "../ui.js";
import { printJson, printTable } from "../lib/output.js";
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
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork tenant list
  $ thinkwork tenant list -s dev
  $ thinkwork tenant list --json | jq '.[].slug'
`,
    )
    .action(async (opts: { stage?: string }) => {
      try {
        const stage = await resolveStage({ flag: opts.stage });
        const api = resolveApiConfig(stage);
        if (!api) process.exit(1);

        const client = createClient({ apiUrl: api!.apiUrl, authSecret: api!.authSecret });
        const rows = await tenantOps.listTenants(client);

        printJson(rows);
        printTable(rows as unknown as Array<Record<string, unknown>>, [
          { key: "slug", header: "SLUG" },
          { key: "name", header: "NAME" },
          { key: "plan", header: "PLAN" },
          { key: "id", header: "ID" },
        ]);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  tenant
    .command("get <idOrSlug>")
    .description("Fetch one tenant by ID or slug.")
    .option("-s, --stage <name>", "Deployment stage")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork tenant get acme
  $ thinkwork tenant get 0a2b... --json
`,
    )
    .action(async (idOrSlug: string, opts: { stage?: string }) => {
      try {
        const stage = await resolveStage({ flag: opts.stage });
        const api = resolveApiConfig(stage);
        if (!api) process.exit(1);

        const client = createClient({ apiUrl: api!.apiUrl, authSecret: api!.authSecret });
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          idOrSlug,
        );
        const tenant = isUuid
          ? await tenantOps.getTenant(client, idOrSlug)
          : await tenantOps.getTenantBySlug(client, idOrSlug);

        printJson(tenant);
        printTable([tenant as unknown as Record<string, unknown>], [
          { key: "slug", header: "SLUG" },
          { key: "name", header: "NAME" },
          { key: "plan", header: "PLAN" },
          { key: "issue_prefix", header: "PREFIX" },
          { key: "id", header: "ID" },
        ]);
      } catch (err) {
        if (err instanceof AdminOpsError && err.status === 404) {
          printError(`Tenant "${idOrSlug}" not found`);
          process.exit(2);
        }
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

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
