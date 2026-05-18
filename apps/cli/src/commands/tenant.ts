/**
 * `thinkwork tenant ...` — tenant (workspace) CRUD and settings.
 *
 * `list` and `get` use the `@thinkwork/admin-ops` REST client; `create`,
 * `update`, `settings get`, `settings set` use GraphQL via the standard
 * CLI gql client. Mixed substrate is intentional — admin-ops covers the
 * read paths and `member`-adjacent flows; GraphQL covers tenant-scope
 * mutations. Consolidate when admin-ops grows the missing ops.
 */

import { Command } from "commander";
import { createClient, tenants as tenantOps, AdminOpsError } from "@thinkwork/admin-ops";
import { graphql } from "../gql/index.js";
import { resolveApiConfig } from "../api-client.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { input } from "@inquirer/prompts";
import { isJsonMode, printJson, printKeyValue, printTable } from "../lib/output.js";
import { printError, printMissingApiSessionError, printSuccess } from "../ui.js";

const CreateTenantDoc = graphql(`
  mutation CliCreateTenant($input: CreateTenantInput!) {
    createTenant(input: $input) {
      id
      name
      slug
      plan
      issuePrefix
    }
  }
`);

const UpdateTenantDoc = graphql(`
  mutation CliUpdateTenant($id: ID!, $input: UpdateTenantInput!) {
    updateTenant(id: $id, input: $input) {
      id
      name
      slug
      plan
      issuePrefix
    }
  }
`);

const TenantSettingsDoc = graphql(`
  query CliTenantSettings($id: ID!) {
    tenant(id: $id) {
      id
      name
      slug
      settings {
        id
        defaultModel
        budgetMonthlyCents
        autoCloseThreadMinutes
        maxAgents
        features
      }
    }
  }
`);

const UpdateTenantSettingsDoc = graphql(`
  mutation CliUpdateTenantSettings(
    $tenantId: ID!
    $input: UpdateTenantSettingsInput!
  ) {
    updateTenantSettings(tenantId: $tenantId, input: $input) {
      id
      defaultModel
      budgetMonthlyCents
      autoCloseThreadMinutes
      maxAgents
      features
    }
  }
`);

const TenantBySlugForCmdDoc = graphql(`
  query CliTenantBySlugForCmd($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
      slug
    }
  }
`);

function nameToSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || `tenant-${Date.now()}`
  );
}

function parseFeatureFlags(raw: string[] | undefined): Record<string, unknown> | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const item of raw) {
    const eq = item.indexOf("=");
    if (eq < 0) {
      printError(`--feature "${item}" must be key=value.`);
      process.exit(1);
    }
    const key = item.slice(0, eq);
    const valRaw = item.slice(eq + 1);
    let val: unknown = valRaw;
    if (valRaw === "true") val = true;
    else if (valRaw === "false") val = false;
    else if (/^-?\d+$/.test(valRaw)) val = Number.parseInt(valRaw, 10);
    out[key] = val;
  }
  return out;
}

async function resolveTenantIdForCmd(opts: { stage?: string; tenant?: string }): Promise<{
  client: ReturnType<typeof getGqlClient> extends Promise<infer R> ? R extends { client: infer C } ? C : never : never;
  tenantId: string;
}> {
  const stage = await resolveStage({ flag: opts.stage });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage });

  const flagOrEnv = opts.tenant ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (session?.tenantSlug === flagOrEnv && session.tenantId) {
      return { client, tenantId: session.tenantId };
    }
    const data = await gqlQuery(client, TenantBySlugForCmdDoc, { slug: flagOrEnv });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return { client, tenantId: data.tenantBySlug.id };
  }
  if (session?.tenantId) return { client, tenantId: session.tenantId };
  if (ctxSlug) {
    const data = await gqlQuery(client, TenantBySlugForCmdDoc, { slug: ctxSlug });
    if (data.tenantBySlug) return { client, tenantId: data.tenantBySlug.id };
  }
  printMissingApiSessionError(stage, session !== null);
  process.exit(1);
}

interface CreateOptions {
  stage?: string;
  slug?: string;
  plan?: string;
  issuePrefix?: string;
}

async function runTenantCreate(name: string | undefined, opts: CreateOptions): Promise<void> {
  const stage = await resolveStage({ flag: opts.stage });
  const session = loadStageSession(stage);
  const { client } = await getGqlClient({ stage });
  if (!session) {
    printMissingApiSessionError(stage, false);
    process.exit(1);
  }

  let resolvedName = name;
  if (!resolvedName) {
    if (!isInteractive()) {
      printError("Tenant name required in non-interactive mode.");
      process.exit(1);
    }
    requireTty("Tenant name");
    resolvedName = await promptOrExit(() => input({ message: "Tenant name:" }));
  }

  const slug = opts.slug ?? nameToSlug(resolvedName!);

  const data = await gqlMutate(client, CreateTenantDoc, {
    input: {
      name: resolvedName!,
      slug,
      plan: opts.plan ?? "team",
    },
  });

  // issuePrefix is set via update (not on create input), so apply it post-create.
  let tenant = data.createTenant;
  if (opts.issuePrefix) {
    const updated = await gqlMutate(client, UpdateTenantDoc, {
      id: tenant.id,
      input: { issuePrefix: opts.issuePrefix },
    });
    tenant = updated.updateTenant;
  }

  if (isJsonMode()) {
    printJson(tenant);
    return;
  }
  printSuccess(`Created tenant ${tenant.id} — ${tenant.name} (slug: ${tenant.slug}, plan: ${tenant.plan}).`);
}

interface UpdateOptions {
  stage?: string;
  name?: string;
  plan?: string;
  issuePrefix?: string;
}

async function runTenantUpdate(id: string, opts: UpdateOptions): Promise<void> {
  const stage = await resolveStage({ flag: opts.stage });
  const session = loadStageSession(stage);
  const { client } = await getGqlClient({ stage });
  if (!session) {
    printMissingApiSessionError(stage, false);
    process.exit(1);
  }

  const input: Record<string, unknown> = {};
  if (opts.name !== undefined) input.name = opts.name;
  if (opts.plan !== undefined) input.plan = opts.plan;
  if (opts.issuePrefix !== undefined) input.issuePrefix = opts.issuePrefix;

  if (Object.keys(input).length === 0) {
    printError("Nothing to update. Pass at least one of --name, --plan, --issue-prefix.");
    process.exit(1);
  }

  const data = await gqlMutate(client, UpdateTenantDoc, { id, input });
  if (isJsonMode()) {
    printJson(data.updateTenant);
    return;
  }
  printSuccess(`Updated tenant ${data.updateTenant.id} (slug: ${data.updateTenant.slug}).`);
}

interface SettingsGetOptions {
  stage?: string;
}

async function runTenantSettingsGet(
  tenantArg: string | undefined,
  opts: SettingsGetOptions,
): Promise<void> {
  const ctx = await resolveTenantIdForCmd({
    stage: opts.stage,
    tenant: tenantArg,
  });

  const data = await gqlQuery(ctx.client, TenantSettingsDoc, { id: ctx.tenantId });
  const tenant = data.tenant;
  if (!tenant) {
    printError(`Tenant ${ctx.tenantId} not found.`);
    process.exit(1);
  }
  const s = tenant.settings;

  if (isJsonMode()) {
    printJson({ tenant, settings: s });
    return;
  }

  printKeyValue([
    ["Tenant", `${tenant.name} (${tenant.slug})`],
    ["Default model", s?.defaultModel ?? undefined],
    ["Monthly budget (cents)", s?.budgetMonthlyCents ?? undefined],
    ["Monthly budget (USD)", s?.budgetMonthlyCents != null ? `$${(s.budgetMonthlyCents / 100).toFixed(2)}` : undefined],
    ["Max agents", s?.maxAgents ?? undefined],
    ["Auto-close after (min)", s?.autoCloseThreadMinutes ?? undefined],
    ["Features", s?.features ? JSON.stringify(s.features) : undefined],
  ]);
}

interface SettingsSetOptions {
  stage?: string;
  defaultModel?: string;
  monthlyBudgetUsd?: string;
  maxAgents?: string;
  autoCloseAfterDays?: string;
  feature?: string[];
}

async function runTenantSettingsSet(
  tenantArg: string | undefined,
  opts: SettingsSetOptions,
): Promise<void> {
  const ctx = await resolveTenantIdForCmd({
    stage: opts.stage,
    tenant: tenantArg,
  });

  const input: Record<string, unknown> = {};
  if (opts.defaultModel !== undefined) input.defaultModel = opts.defaultModel;
  if (opts.monthlyBudgetUsd !== undefined) {
    input.budgetMonthlyCents = Math.round(Number.parseFloat(opts.monthlyBudgetUsd) * 100);
  }
  if (opts.maxAgents !== undefined) input.maxAgents = Number.parseInt(opts.maxAgents, 10);
  if (opts.autoCloseAfterDays !== undefined) {
    // schema field is autoCloseThreadMinutes; convert days → minutes.
    input.autoCloseThreadMinutes = Math.round(Number.parseFloat(opts.autoCloseAfterDays) * 60 * 24);
  }
  const features = parseFeatureFlags(opts.feature);
  // `features` is GraphQL type AWSJSON — a string-encoded JSON value. The
  // server's updateTenantSettings resolver calls JSON.parse on this; passing
  // a raw object surfaces as a masked "Unexpected error" from GraphQL Yoga.
  if (features !== undefined) input.features = JSON.stringify(features);

  if (Object.keys(input).length === 0) {
    printError(
      "Nothing to set. Pass at least one of --default-model, --monthly-budget-usd, --max-agents, --auto-close-after-days, --feature.",
    );
    process.exit(1);
  }

  const data = await gqlMutate(ctx.client, UpdateTenantSettingsDoc, {
    tenantId: ctx.tenantId,
    input,
  });

  if (isJsonMode()) {
    printJson(data.updateTenantSettings);
    return;
  }
  printSuccess(`Updated tenant settings for ${ctx.tenantId}.`);
}

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

        if (isJsonMode()) {
          printJson(rows);
          return;
        }
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
        const t = isUuid
          ? await tenantOps.getTenant(client, idOrSlug)
          : await tenantOps.getTenantBySlug(client, idOrSlug);

        if (isJsonMode()) {
          printJson(t);
          return;
        }
        printTable([t as unknown as Record<string, unknown>], [
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
    .action(runTenantCreate);

  tenant
    .command("update <id>")
    .description("Update tenant name, plan, or issue-prefix.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--name <n>")
    .option("--plan <plan>")
    .option("--issue-prefix <prefix>")
    .action(runTenantUpdate);

  // ----- Settings sub-group -------------------------------------------------

  const settings = tenant
    .command("settings")
    .description("Tenant-wide defaults — model, budget, auto-close, feature flags.");

  settings
    .command("get [tenant]")
    .description("Print the current TenantSettings (human) or the full object (--json).")
    .option("-s, --stage <name>", "Deployment stage")
    .action(runTenantSettingsGet);

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
    .action(runTenantSettingsSet);
}
