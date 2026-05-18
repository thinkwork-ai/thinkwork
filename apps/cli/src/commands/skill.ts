/**
 * `thinkwork skill ...` — skill catalog browse + custom-plugin push.
 *
 * - catalog / list: backed by the skillCatalog GraphQL query.
 * - push: existing REST-based plugin upload flow (Cognito-auth required).
 * - install/upgrade/create/update/delete: scaffolded but the API doesn't
 *   currently expose the per-tenant install/upgrade surface — those
 *   handlers print a clear "API surface pending" error for now.
 */

import { Command } from "commander";
import { graphql } from "../gql/index.js";
import { loadStageSession } from "../cli-config.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveAuth } from "../lib/resolve-auth.js";
import { getApiEndpoint } from "../aws-discovery.js";
import { getGqlClient, gqlQuery } from "../lib/gql-client.js";
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

interface SkillCliOptions {
  stage?: string;
  region?: string;
  tenant?: string;
}

async function resolveSkillContext(opts: SkillCliOptions) {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const session = loadStageSession(stage);
  const { client } = await getGqlClient({ stage, region });
  // skillCatalog is tenant-scoped at the resolver level via the bearer, so we
  // don't strictly need a tenantId in the query. But surface the helpful error
  // if the session is missing AND there's no api-key auto-fallback path.
  if (!session) {
    // resolveAuth's api-key fallback will kick in inside gqlQuery, so we don't
    // pre-exit here. Just return.
  }
  return { stage, region, client };
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
    .description("Install a public skill. (API surface pending — toggle per-agent via `agent skills set`.)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--version <v>", "Pin to a specific version")
    .action(() => notYetImplementedAtApi("install"));

  skill
    .command("upgrade <slug>")
    .description("Upgrade an installed skill. (API surface pending.)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplementedAtApi("upgrade"));

  skill
    .command("create [slug]")
    .description("Publish a custom tenant-scoped skill. (Use `skill push <folder>` for now.)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--manifest-file <path>", "Path to the MCP server manifest JSON")
    .option("--endpoint <url>", "MCP server HTTP/SSE endpoint")
    .action(() => notYetImplementedAtApi("create"));

  skill
    .command("update <slug>")
    .description("Update a custom skill. (API surface pending.)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--manifest-file <path>")
    .option("--endpoint <url>")
    .action(() => notYetImplementedAtApi("update"));

  skill
    .command("delete <slug>")
    .description("Delete a custom skill. (API surface pending.)")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplementedAtApi("delete"));

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
