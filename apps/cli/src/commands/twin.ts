/**
 * `thinkwork twin ...` — white-glove Company Brain installation (THINK-334).
 *
 * Engineer-run: installs or adopts the twin's full infrastructure footprint
 * for a stage — etl-repo stacks (Neptune, Dagster projection, landing
 * bucket) from a local checkout of McPherson-Data/thinkwork, product-side
 * Neptune wiring via the standard deploy path, and the tenant's digital-twin
 * MCP registration via the THINK-333 provisioning route.
 *
 * Idempotent by construction: Terraform state makes existing infra a no-op,
 * MCP registration is check-then-skip (--rotate to re-key). The command
 * never destroys or replaces twin resources (R4).
 */

import { Command } from "commander";
import { runTwinInstall } from "./twin/install.js";

export function registerTwinCommand(program: Command): void {
  const twin = program
    .command("twin")
    .description(
      "Company Brain white-glove installation (engineer-run). Idempotent.",
    );

  twin
    .command("install")
    .description(
      "Install or adopt the Company Brain for a stage: etl-repo stacks, product Neptune wiring, MCP registration.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option(
      "-t, --tenant <slug>",
      "Tenant slug (required on multi-tenant stages)",
    )
    .option(
      "--etl-repo-dir <path>",
      "Local checkout of the etl repo (McPherson-Data/thinkwork). Falls back to THINKWORK_ETL_REPO.",
    )
    .option(
      "--etl-account <slug>",
      "etl repo account slug (accounts/<slug>.tfvars). Defaults: dev → thinkwork, otherwise the stage name.",
    )
    .option(
      "--rotate",
      "Force MCP re-provisioning, rotating the tkt_ key, even when a registration exists.",
    )
    .option(
      "--allow-changes",
      "Permit Terraform modifications to already-existing stacks. Destructive plans always abort.",
    )
    .option(
      "--dry-run",
      "Prereq checks + terraform plans + channel diff only; no applies, deploys, or API writes.",
    )
    .addHelpText(
      "after",
      `
Examples:
  # Adopt-or-create against dev, inferring the single tenant
  $ thinkwork twin install -s dev

  # Preview what a TEI install would do (no changes)
  $ thinkwork twin install -s tei --tenant tei --etl-repo-dir ~/src/mcpherson-thinkwork --dry-run

  # Rotate the twin MCP key after an incident
  $ thinkwork twin install -s dev --rotate

Prereqs: AWS credentials for the target account, terraform, a local etl repo
checkout with an accounts/<slug> entry for the target account.
`,
    )
    .action(async (opts, cmd) => {
      const parent = cmd.parent?.parent as Command | undefined;
      await runTwinInstall({
        ...opts,
        stage: opts.stage ?? parent?.opts().stage,
        json: parent?.opts().json === true || opts.json === true,
      });
    });
}
