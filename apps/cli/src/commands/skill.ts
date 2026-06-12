/**
 * `thinkwork skill ...` — skill catalog index maintenance plus retired
 * tenant skill verbs kept for clear CLI errors.
 *
 * - catalog rebuild: live — reconciles the skill_catalog index from S3.
 * - list / install / upgrade / delete: RETIRED — the old tenant-level
 *   skill catalog surface was replaced by the workspace Skills tab.
 * - create / update / push: RETIRED — the tenant zip-upload plugin flow
 *   was removed; skills are authored directly in the agent workspace
 *   `skills/` folder (admin Skills tab). Running them prints the
 *   retirement message and exits 2.
 */

import { Command } from "commander";
import { confirm } from "@inquirer/prompts";
import { resolveStage } from "../lib/resolve-stage.js";
import { getGqlClient, gqlMutate } from "../lib/gql-client.js";
import { graphql } from "../gql/index.js";
import { isJsonMode, printJson } from "../lib/output.js";
import { printError, printSuccess, printWarning } from "../ui.js";

const RebuildSkillCatalogIndexDoc = graphql(`
  mutation CliRebuildSkillCatalogIndex(
    $tenantId: ID
    $all: Boolean
    $dryRun: Boolean
  ) {
    rebuildSkillCatalogIndex(tenantId: $tenantId, all: $all, dryRun: $dryRun) {
      tenantId
      tenantSlug
      skillsInS3
      rowsUpserted
      rowsSkipped
      rowsDeleted
      dryRun
    }
  }
`);

interface CatalogRebuildOptions {
  stage?: string;
  region?: string;
  tenant?: string;
  all?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

async function runCatalogRebuild(opts: CatalogRebuildOptions): Promise<void> {
  const region = opts.region ?? "us-east-1";
  const stage = await resolveStage({ flag: opts.stage, region });
  const all = opts.all === true;
  const dryRun = opts.dryRun === true;

  if (all && !opts.tenant) {
    // no-op: --all ignores --tenant
  }
  if (!all && !opts.tenant) {
    printWarning(
      "No --tenant given; rebuilding the caller's own tenant. Use --all (platform operator) to rebuild every tenant.",
    );
  }

  if (all && !dryRun && !opts.yes) {
    const ok = await confirm({
      message: `Rebuild the skill catalog index for ALL tenants on stage "${stage}"?`,
      default: false,
    });
    if (!ok) {
      printWarning("Aborted.");
      return;
    }
  }

  const { client } = await getGqlClient({ stage, region });
  const data = await gqlMutate(client, RebuildSkillCatalogIndexDoc, {
    tenantId: opts.tenant ?? null,
    all,
    dryRun,
  });

  const results = data.rebuildSkillCatalogIndex;
  if (isJsonMode()) {
    printJson(results);
    return;
  }

  for (const r of results) {
    printSuccess(
      `${r.tenantSlug}: ${r.skillsInS3} in S3 → ` +
        `${r.rowsUpserted} upserted, ${r.rowsSkipped} skipped, ${r.rowsDeleted} deleted` +
        (r.dryRun ? " (dry run — no writes)" : ""),
    );
  }
  if (results.length === 0) {
    printWarning("No tenants processed.");
  }
}

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
    .description(
      "Skill catalog index maintenance; old tenant skill verbs are retired.",
    );

  const catalog = skill
    .command("catalog")
    .description("Skill catalog index maintenance (operator/admin).");

  catalog
    .command("rebuild")
    .description(
      "Reconcile the skill_catalog index from S3 (backfill / drift recovery).",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-r, --region <name>", "AWS region")
    .option("-t, --tenant <id>", "Tenant ID (defaults to the caller's tenant)")
    .option("--all", "Rebuild every tenant (requires platform operator)")
    .option("--dry-run", "Report the counts without writing")
    .option("-y, --yes", "Skip the confirmation prompt for --all")
    .action(async (opts: CatalogRebuildOptions) => {
      await runCatalogRebuild(opts);
    });

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

  // `skill create` + `skill update` were premature scaffolding, and the
  // `skill push` zip-upload flow they pointed at was retired with the
  // legacy plugin-upload machinery — custom skills are authored directly
  // in the agent workspace `skills/` folder.
  skill
    .command("create [slug]")
    .description(
      "Retired — author custom skills in the agent workspace skills/ folder.",
    )
    .action(() =>
      retiredVerb(
        "create",
        "custom-skill authoring happens in the agent workspace `skills/` folder (admin Skills tab).",
      ),
    );

  skill
    .command("update <slug>")
    .description(
      "Retired — edit the skill folder in the agent workspace to update.",
    )
    .action(() =>
      retiredVerb(
        "update",
        "updates are done by editing the skill folder in the agent workspace (admin Skills tab).",
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
      "Retired — the tenant zip-upload plugin flow was removed; author skills in the agent workspace.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("--region <name>", "AWS region", "us-east-1")
    .action(() =>
      retiredVerb(
        "push",
        "the tenant zip-upload plugin flow was removed; author custom skills in the agent workspace `skills/` folder (admin Skills tab). Application plugins install from the signed catalog.",
      ),
    );
}
