/**
 * `thinkwork skill ...` — MCP-style skills published in the catalog plus
 * tenant-installed / custom skills.
 *
 * Scaffolded in Phase 0; ships in Phase 3.
 */

import { Command } from "commander";
import { notYetImplemented } from "../lib/stub.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { resolveAuth } from "../lib/resolve-auth.js";
import { getApiEndpoint } from "../aws-discovery.js";
import { buildPluginZip, PluginZipError } from "../lib/plugin-zip.js";
import { pushPluginZip } from "../lib/plugin-push.js";
import { printError, printSuccess, printWarning } from "../ui.js";

export function registerSkillCommand(program: Command): void {
  const skill = program
    .command("skill")
    .alias("skills")
    .description(
      "Browse the catalog, install, upgrade, or publish custom skills.",
    );

  skill
    .command("catalog")
    .description("Browse the public skill catalog (not tenant-scoped).")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--search <q>", "Filter by keyword")
    .option("--tag <t>", "Filter by tag")
    .action(() => notYetImplemented("skill catalog", 3));

  skill
    .command("list")
    .alias("ls")
    .description("List skills installed / published in the current tenant.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--custom-only", "Only show tenant-owned custom skills")
    .action(() => notYetImplemented("skill list", 3));

  skill
    .command("install <slug>")
    .description("Install a public skill into the tenant. Idempotent.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--version <v>", "Pin to a specific version (default: latest)")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork skill install web-search
  $ thinkwork skill install pagerduty --version 1.4.2
`,
    )
    .action(() => notYetImplemented("skill install", 3));

  skill
    .command("upgrade <slug>")
    .description("Upgrade an installed skill to the latest catalog version.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .action(() => notYetImplemented("skill upgrade", 3));

  skill
    .command("create [slug]")
    .description(
      "Publish a custom tenant-scoped skill (walkthrough for missing fields in TTY).",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--manifest-file <path>", "Path to the MCP server manifest JSON")
    .option("--endpoint <url>", "MCP server HTTP/SSE endpoint")
    .addHelpText(
      "after",
      `
Examples:
  $ thinkwork skill create my-skill --manifest-file ./skills/my-skill.json
  $ thinkwork skill create                                   # interactive
`,
    )
    .action(() => notYetImplemented("skill create", 3));

  skill
    .command("update <slug>")
    .description("Update a custom skill's manifest, endpoint, or description.")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("--name <n>")
    .option("--description <text>")
    .option("--manifest-file <path>")
    .option("--endpoint <url>")
    .action(() => notYetImplemented("skill update", 3));

  skill
    .command("delete <slug>")
    .description(
      "Delete a custom skill. Public catalog skills are uninstalled via this too.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-t, --tenant <slug>", "Tenant slug")
    .option("-y, --yes", "Skip confirmation")
    .action(() => notYetImplemented("skill delete", 3));

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
inside the plugin will land as 'pending' and need admin approval
under Capabilities → MCP Servers before agents can invoke them.
`,
    )
    .action(
      async (folder: string, opts: { stage?: string; region?: string }) => {
        await runPushCommand(folder, opts);
      },
    );
}

// ---------------------------------------------------------------------------
// `skill push` implementation
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
    // requireCognito:true above already prints + exits for non-Cognito,
    // but keep a defensive branch for clarity.
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
