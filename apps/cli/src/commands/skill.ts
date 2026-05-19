/**
 * `thinkwork skill ...` — skill catalog browse + tenant-scoped install/upgrade
 * + custom-plugin push.
 *
 * - catalog / list: backed by the skillCatalog GraphQL query.
 * - install / upgrade: idempotent upsert into tenant_skills via the
 *   installSkill mutation. Both verbs call the same mutation; the
 *   distinction is purely user-facing.
 * - delete: removes the tenant_skills row via uninstallSkill.
 * - push: existing REST plugin-upload flow (Cognito auth required).
 * - create / update: RETIRED — custom-skill authoring is `skill push`.
 *   Running them prints the retirement message and exits 2.
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveAuth } from "../lib/resolve-auth.js";
import { getApiEndpoint } from "../aws-discovery.js";
import { getGqlClient, gqlMutate, gqlQuery } from "../lib/gql-client.js";
import { input } from "@inquirer/prompts";
import { isInteractive, promptOrExit, requireTty } from "../lib/interactive.js";
import { buildPluginZip, PluginZipError } from "../lib/plugin-zip.js";
import { pushPluginZip } from "../lib/plugin-push.js";
import { isJsonMode, printJson, printTable } from "../lib/output.js";
import {
  printError,
  printMissingApiSessionError,
  printSuccess,
  printWarning,
} from "../ui.js";

const SkillCatalogDoc = graphql(`
  query CliSkillCatalog {
    skillCatalog {
      id
      skillId
      displayName
      description
      category
      icon
      source
      enabled
    }
  }
`);

const SkillTenantBySlugDoc = graphql(`
  query CliSkillTenantBySlug($slug: String!) {
    tenantBySlug(slug: $slug) {
      id
    }
  }
`);

const InstallSkillDoc = graphql(`
  mutation CliInstallSkill($input: InstallSkillInput!) {
    installSkill(input: $input) {
      id
      tenantId
      skillId
      source
      version
      catalogVersion
      enabled
      installedAt
      updatedAt
    }
  }
`);

const UninstallSkillDoc = graphql(`
  mutation CliUninstallSkill($tenantId: ID!, $skillId: String!) {
    uninstallSkill(tenantId: $tenantId, skillId: $skillId)
  }
`);

interface SkillCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveSkillContext(opts: SkillCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client, tenantSlug: ctxSlug } = await getGqlClient({ stage, region });
  // skillCatalog is tenant-scoped at the resolver level via the bearer, so we
  // don't strictly need a tenantId in the query. But surface the helpful error
  // if the session is missing AND there's no api-key auto-fallback path.
  if (!session) {
    // resolveAuth's api-key fallback will kick in inside gqlQuery, so we don't
    // pre-exit here. Just return.
  }
  return { stage, region, client, session, ctxSlug };
}

/**
 * Resolve the tenant UUID for tenant-scoped skill mutations (install /
 * uninstall). install/uninstall take the tenantId directly rather than
 * relying on resolver-side bearer inference because tenant_skills rows
 * are explicit per-tenant — making the target tenant visible in the
 * mutation call matches how `agent capabilities set` etc. flow.
 */
async function resolveTenantIdForSkill(
  ctx: Awaited<ReturnType<typeof resolveSkillContext>>,
  tenantOpt: string | undefined,
): Promise<string> {
  const flagOrEnv = tenantOpt ?? process.env.THINKWORK_TENANT;
  if (flagOrEnv) {
    if (ctx.session?.tenantSlug === flagOrEnv && ctx.session.tenantId) {
      return ctx.session.tenantId;
    }
    const data = await gqlQuery(ctx.client, SkillTenantBySlugDoc, {
      slug: flagOrEnv,
    });
    if (!data.tenantBySlug) {
      printError(`Tenant "${flagOrEnv}" not found.`);
      process.exit(1);
    }
    return data.tenantBySlug.id;
  }
  if (ctx.session?.tenantId) return ctx.session.tenantId;
  if (ctx.ctxSlug) {
    const data = await gqlQuery(ctx.client, SkillTenantBySlugDoc, {
      slug: ctx.ctxSlug,
    });
    if (data.tenantBySlug) return data.tenantBySlug.id;
  }
  printMissingApiSessionError(ctx.stage, ctx.session !== null);
  process.exit(1);
}

interface CatalogOptions extends SkillCliOptions {
  search?: string;
  tag?: string;
}

async function runSkillCatalog(opts: CatalogOptions): Promise<void> {
  const ctx = await resolveSkillContext(opts);
  const data = await gqlQuery(ctx.client, SkillCatalogDoc, {});
  let items = data.skillCatalog ?? [];
  if (opts.search) {
    const q = opts.search.toLowerCase();
    items = items.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.skillId.toLowerCase().includes(q) ||
        (s.description ?? "").toLowerCase().includes(q),
    );
  }
  if (opts.tag) {
    const tag = opts.tag.toLowerCase();
    items = items.filter((s) => (s.category ?? "").toLowerCase() === tag);
  }
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((s) => ({
      skillId: s.skillId,
      name: s.displayName,
      category: s.category ?? "—",
      source: s.source,
      enabled: s.enabled ? "yes" : "no",
    })),
    [
      { key: "skillId", header: "SKILL ID" },
      { key: "name", header: "NAME" },
      { key: "category", header: "CATEGORY" },
      { key: "source", header: "SOURCE" },
      { key: "enabled", header: "ENABLED" },
    ],
  );
}

interface ListOptions extends SkillCliOptions {
  customOnly?: boolean;
}

async function runSkillList(opts: ListOptions): Promise<void> {
  const ctx = await resolveSkillContext(opts);
  const data = await gqlQuery(ctx.client, SkillCatalogDoc, {});
  let items = data.skillCatalog ?? [];
  if (opts.customOnly) {
    items = items.filter((s) => (s.source ?? "").toLowerCase() === "tenant");
  }
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((s) => ({
      skillId: s.skillId,
      name: s.displayName,
      category: s.category ?? "—",
      source: s.source,
      enabled: s.enabled ? "yes" : "no",
    })),
    [
      { key: "skillId", header: "SKILL ID" },
      { key: "name", header: "NAME" },
      { key: "category", header: "CATEGORY" },
      { key: "source", header: "SOURCE" },
      { key: "enabled", header: "ENABLED" },
    ],
  );
}

interface InstallOptions extends SkillCliOptions {
  version?: string;
}

async function runSkillInstall(
  slug: string,
  opts: InstallOptions,
): Promise<void> {
  const ctx = await resolveSkillContext(opts);
  const tenantId = await resolveTenantIdForSkill(ctx, opts.tenant);
  const data = await gqlMutate(ctx.client, InstallSkillDoc, {
    input: { tenantId, skillId: slug, version: opts.version ?? null },
  });
  if (isJsonMode()) {
    printJson(data.installSkill);
    return;
  }
  printSuccess(
    `Installed skill ${data.installSkill.skillId} (source=${data.installSkill.source}, version=${data.installSkill.version ?? "—"}).`,
  );
}

interface DeleteOptions extends SkillCliOptions {
  yes?: boolean;
}

async function runSkillDelete(
  slug: string,
  opts: DeleteOptions,
): Promise<void> {
  const ctx = await resolveSkillContext(opts);
  const tenantId = await resolveTenantIdForSkill(ctx, opts.tenant);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError(
        "Refusing to uninstall without --yes in non-interactive mode.",
      );
      process.exit(1);
    }
    requireTty("confirmation");
    const answer = await promptOrExit(() =>
      input({
        message: `Uninstall skill "${slug}" from this tenant? Type "uninstall" to confirm:`,
      }),
    );
    if (answer.trim() !== "uninstall") {
      console.log("  Cancelled.");
      return;
    }
  }
  const data = await gqlMutate(ctx.client, UninstallSkillDoc, {
    tenantId,
    skillId: slug,
  });
  if (isJsonMode()) {
    printJson({ skillId: slug, uninstalled: data.uninstallSkill });
    return;
  }
  if (data.uninstallSkill) {
    printSuccess(`Uninstalled skill ${slug} from tenant.`);
  } else {
    console.log(`  Skill "${slug}" was not installed (no-op).`);
  }
}

function retiredVerb(verb: string, hint: string): never {
  printError(
    `\`skill ${verb}\` was retired: ${hint}\n` +
      "  See `thinkwork skill --help` for the supported verbs.",
  );
  process.exit(2);
}

function notYetImplementedAtApi(verb: string): never {
  printError(
    `\`skill ${verb}\` is not yet implemented at the GraphQL API.\n` +
      "  The current schema exposes skillCatalog (read), per-computer enableSkill/disableSkill,\n" +
      "  and the REST `skill push` upload path. Tenant-scoped install/upgrade/create/update/delete\n" +
      "  is tracked as a Phase-3 follow-up. Use `thinkwork skill push <folder>` to upload custom\n" +
      "  plugins; toggle catalog skills per-agent via `thinkwork agent skills set` for now.",
  );
  process.exit(2);
}

export function registerSkillCommand(program: Command): void {
  const skill = program
    .command("skill")
    .alias("skills")
    .description(
      "Browse the skill catalog and push custom skill plugins.",
    );

  skill
    .command("catalog")
    .description("Browse the skill catalog. Client-side filters --search and --tag are applied locally.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--search <q>", "Filter by keyword")
    .option("--tag <t>", "Filter by category")
    .action(runSkillCatalog);

  skill
    .command("list")
    .alias("ls")
    .description("List skills available to the tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--custom-only", "Only show tenant-owned custom skills (source=tenant)")
    .action(runSkillList);

  skill
    .command("install <slug>")
    .description(
      "Install a catalog skill into the tenant (upserts tenant_skills). Idempotent — re-running bumps the version. Per-agent assignment still goes through `agent skills set`.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--version <v>", "Pin to a specific version (defaults to catalog's current)")
    .action(runSkillInstall);

  skill
    .command("upgrade <slug>")
    .description(
      "Upgrade an installed skill to the catalog's current version (or to --version). Same mutation as `install`.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--version <v>", "Pin to a specific version")
    .action(runSkillInstall);

  // `skill create` + `skill update` were premature scaffolding — custom-skill
  // authoring is `skill push <folder>`, not a metadata-only CRUD.
  skill
    .command("create [slug]")
    .description("Retired — use `thinkwork skill push <folder>` to publish a custom skill.")
    .action(() =>
      retiredVerb(
        "create",
        "custom-skill authoring is done by uploading a folder via `thinkwork skill push <folder>`.",
      ),
    );

  skill
    .command("update <slug>")
    .description("Retired — re-push the skill folder with `thinkwork skill push <folder>` to update.")
    .action(() =>
      retiredVerb(
        "update",
        "updates are done by re-pushing the skill folder via `thinkwork skill push <folder>`.",
      ),
    );

  skill
    .command("delete <slug>")
    .description(
      "Uninstall a skill from the tenant (deletes the tenant_skills row). Confirms unless --yes.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(runSkillDelete);

  skill
    .command("push <folder>")
    .description(
      "Zip a local plugin folder and upload it to the tenant as a pending plugin.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("--region <name>", "AWS region", "us-east-1")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork skill push ./my-plugin
  $ thinkwork skill push ./my-plugin --stage dev

The folder must contain a plugin.json manifest. MCP servers shipped
inside the plugin land as 'pending' and need admin approval under
Capabilities → MCP Servers before agents can invoke them.
`,
    )
    .action(
      async (folder: string, opts: { stage?: string; region?: string }) => {
        await runPushCommand(folder, opts);
      },
    );
}

// ---------------------------------------------------------------------------
// `skill push` implementation (unchanged from prior scaffold)
// ---------------------------------------------------------------------------

async function runPushCommand(
  folder: string,
  opts: { stage?: string; region?: string },
): Promise<void> {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });

  let zipped;
  try {
    zipped = await buildPluginZip(folder);
  } catch (err) {
    if (err instanceof PluginZipError) {
      printError(err.message);
      process.exit(1);
    }
    throw err;
  }

  const auth = await resolveAuth({ stage, region, requireCognito: true });
  if (auth.mode !== "cognito") {
    printError(
      `skill push requires a Cognito session. Run \`thinkwork login --stage ${stage}\`.`,
    );
    process.exit(1);
  }

  const apiUrl = getApiEndpoint(stage, region);
  if (!apiUrl) {
    printError(
      `Could not discover API endpoint for stage "${stage}" in ${region}. Is the stack deployed?`,
    );
    process.exit(1);
  }

  printSuccess(
    `Prepared plugin "${zipped.plugin.name}" — ${zipped.fileCount} file(s), ${formatBytes(zipped.buffer.length)}`,
  );

  let result;
  try {
    result = await pushPluginZip({
      apiUrl,
      headers: auth.headers,
      zipBuffer: zipped.buffer,
      fileName: zipped.zipFileName,
    });
  } catch (err) {
    printError(`Upload failed: ${(err as Error).message}`);
    process.exit(1);
  }

  if (result.status === "validation-failed") {
    printError("Plugin validation failed");
    for (const e of result.errors) console.log(`    - ${e}`);
    for (const w of result.warnings) printWarning(w);
    process.exit(1);
  }

  if (result.status === "failed") {
    printError(
      `Install failed${result.phase ? ` at phase ${result.phase}` : ""}: ${result.errorMessage}`,
    );
    if (result.uploadId) {
      console.log(`    upload id: ${result.uploadId}`);
    }
    process.exit(1);
  }

  const skillCount = result.plugin.skills.length;
  const mcpCount = result.plugin.mcpServers.length;
  printSuccess(
    `Installed "${result.plugin.name}" — ${skillCount} skill(s)` +
      (mcpCount > 0
        ? `, ${mcpCount} MCP server(s) pending admin approval`
        : ""),
  );
  console.log(`    upload id: ${result.uploadId}`);
  if (mcpCount > 0) {
    console.log(
      `    approve at: admin SPA → Capabilities → MCP Servers (filter: status=pending)`,
    );
  }
  for (const w of result.warnings) printWarning(w);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
