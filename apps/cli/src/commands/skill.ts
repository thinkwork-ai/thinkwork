/**
 * `thinkwork skill ...` — custom-plugin push plus retired tenant skill
 * catalog verbs kept for clear CLI errors.
 *
 * - catalog / list / install / upgrade / delete: RETIRED — the old
 *   tenant_skills-backed GraphQL surface was replaced by the workspace
 *   Skills tab.
 * - push: existing REST plugin-upload flow (Cognito auth required).
 * - create / update: RETIRED — custom-skill authoring is `skill push`.
 *   Running them prints the retirement message and exits 2.
 */

import { Command } from "commander";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveAuth } from "../lib/resolve-auth.js";
import { getApiEndpoint } from "../aws-discovery.js";
import { buildPluginZip, PluginZipError } from "../lib/plugin-zip.js";
import { pushPluginZip } from "../lib/plugin-push.js";
import { printError, printSuccess, printWarning } from "../ui.js";

function retiredVerb(verb: string, hint: string): never {
  printError(
    `\`skill ${verb}\` was retired: ${hint}\n` +
      "  See `thinkwork skill --help` for the supported verbs.",
  );
  process.exit(2);
}

export function registerSkillCommand(program: Command): void {
  const skill = program
    .command("skill")
    .alias("skills")
    .description("Push custom skill plugins; old catalog verbs are retired.");

  skill
    .command("catalog")
    .description(
      "Retired — browse workspace skill catalog folders in the admin Skills tab.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--search <q>", "Filter by keyword")
    .option("--tag <t>", "Filter by category")
    .action(() =>
      retiredVerb(
        "catalog",
        "catalog skills now live in each agent's admin Skills tab.",
      ),
    );

  skill
    .command("list")
    .alias("ls")
    .description(
      "Retired — browse workspace skill catalog folders in the admin Skills tab.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option(
      "--custom-only",
      "Only show tenant-owned custom skills (source=tenant)",
    )
    .action(() =>
      retiredVerb(
        "list",
        "catalog skills now live in each agent's admin Skills tab.",
      ),
    );

  skill
    .command("install <slug>")
    .description("Retired — install skills from the admin agent Skills tab.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option(
      "--version <v>",
      "Pin to a specific version (defaults to catalog's current)",
    )
    .action(() =>
      retiredVerb(
        "install",
        "use the admin agent Skills tab to add catalog skills to a workspace.",
      ),
    );

  skill
    .command("upgrade <slug>")
    .description(
      "Retired — reinstall stale skills from the admin agent Skills tab.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--version <v>", "Pin to a specific version")
    .action(() =>
      retiredVerb(
        "upgrade",
        "use Reinstall Skill in the admin agent Skills tab when a catalog-managed skill is stale.",
      ),
    );

  // `skill create` + `skill update` were premature scaffolding — custom-skill
  // authoring is `skill push <folder>`, not a metadata-only CRUD.
  skill
    .command("create [slug]")
    .description(
      "Retired — use `thinkwork skill push <folder>` to publish a custom skill.",
    )
    .action(() =>
      retiredVerb(
        "create",
        "custom-skill authoring is done by uploading a folder via `thinkwork skill push <folder>`.",
      ),
    );

  skill
    .command("update <slug>")
    .description(
      "Retired — re-push the skill folder with `thinkwork skill push <folder>` to update.",
    )
    .action(() =>
      retiredVerb(
        "update",
        "updates are done by re-pushing the skill folder via `thinkwork skill push <folder>`.",
      ),
    );

  skill
    .command("delete <slug>")
    .description("Retired — remove skills from the admin agent Skills tab.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() =>
      retiredVerb(
        "delete",
        "use Remove Skill in the admin agent Skills tab to unwind CONTEXT.md and workspace files.",
      ),
    );

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
