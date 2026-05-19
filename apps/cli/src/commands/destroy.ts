import { Command } from "commander";

import {
  validateComponent,
  expandComponent,
  isProdLike,
  type Component,
} from "../config.js";
import { getAwsIdentity } from "../aws.js";
import {
  resolveTierDir,
  resolveTerraformRoot,
  ensureInit,
  ensureWorkspace,
  runTerraform,
} from "../terraform.js";
import { confirm } from "../prompt.js";
import {
  printHeader,
  printTierHeader,
  printSuccess,
  printError,
  printWarning,
  printSummary,
} from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";
import {
  runEnterpriseDestroy,
  shouldUseEnterpriseDestroy,
  type EnterpriseDestroyResult,
} from "./enterprise/destroy.js";

export interface DestroyCommandOptions {
  profile?: string;
  stage?: string;
  component: string;
  customer?: string;
  repo?: string;
  wait?: boolean;
  localTerraform?: boolean;
  yes?: boolean;
}

export interface DestroyCommandDependencies {
  localDestroy?: (opts: DestroyCommandOptions) => Promise<void>;
  enterpriseDestroy?: (
    opts: DestroyCommandOptions,
  ) => Promise<EnterpriseDestroyResult>;
  shouldUseEnterprise?: (opts: DestroyCommandOptions) => boolean;
}

export function registerDestroyCommand(
  program: Command,
  deps: DestroyCommandDependencies = {},
): void {
  program
    .command("destroy")
    .description(
      "Destroy a ThinkWork stage. Uses enterprise CI inside a deployment repo or with --customer/--repo; otherwise runs local Terraform destroy.",
    )
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .option(
      "-c, --component <tier>",
      "Local Terraform component tier (foundation|data|app|all)",
      "all",
    )
    .option("--customer <slug>", "Enterprise customer slug")
    .option("--repo <owner/name>", "Customer GitHub deployment repository")
    .option("--wait", "Wait for enterprise CI workflow completion")
    .option("--no-wait", "Do not wait for enterprise CI workflow completion")
    .option(
      "--local-terraform",
      "Force the local Terraform destroy path even inside an enterprise deployment repo",
    )
    .option("-y, --yes", "Skip interactive confirmation (for CI)")
    .action(async (opts: DestroyCommandOptions) => {
      try {
        await runDestroyCommand(opts, deps);
      } catch (err) {
        if (isCancellation(err)) return;
        printError((err as Error).message);
        process.exit(1);
      }
    });
}

export async function runDestroyCommand(
  opts: DestroyCommandOptions,
  deps: DestroyCommandDependencies = {},
): Promise<void> {
  const shouldUseEnterprise =
    deps.shouldUseEnterprise ?? shouldUseEnterpriseDestroy;
  if (shouldUseEnterprise(opts)) {
    const enterpriseDestroy = deps.enterpriseDestroy ?? runEnterpriseDestroy;
    const result = await enterpriseDestroy(opts);
    printEnterpriseDestroySummary(result);
    return;
  }

  const localDestroy = deps.localDestroy ?? runLocalTerraformDestroy;
  await localDestroy(opts);
}

export async function runLocalTerraformDestroy(
  opts: DestroyCommandOptions,
): Promise<void> {
  const startTime = Date.now();
  const stage = await resolveStage({ flag: opts.stage });

  const compCheck = validateComponent(opts.component);
  if (!compCheck.valid) {
    printError(compCheck.error!);
    process.exit(1);
  }

  const identity = getAwsIdentity();
  printHeader("destroy", stage, identity);

  if (!identity) {
    printWarning("Could not resolve AWS identity. Is the AWS CLI configured?");
  }

  if (isProdLike(stage)) {
    printWarning(`Stage "${stage}" is production-like.`);
    if (!opts.yes) {
      const ok = await confirm(
        `  Type 'y' to confirm destruction of stage "${stage}":`,
      );
      if (!ok) {
        console.log("  Aborted.");
        process.exit(0);
      }
    }
    console.log(`  Proceeding with destroy of "${stage}" (--yes provided).`);
  } else if (!opts.yes) {
    const ok = await confirm(`  Destroy stage "${stage}"?`);
    if (!ok) {
      console.log("  Aborted.");
      process.exit(0);
    }
  }

  const terraformDir = resolveTerraformRoot();
  const tiers = expandComponent(opts.component as Component).reverse();

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    printTierHeader(tier, i, tiers.length);

    const cwd = resolveTierDir(terraformDir, stage, tier);
    await ensureInit(cwd);
    await ensureWorkspace(cwd, stage);

    const code = await runTerraform(cwd, [
      "destroy",
      "-auto-approve",
      `-var=stage=${stage}`,
    ]);
    if (code !== 0) {
      printError(`Destroy failed for ${tier} (exit ${code})`);
      process.exit(code);
    }
  }

  printSuccess("Destroy complete");
  printSummary("destroy", stage, tiers, startTime);
}

function printEnterpriseDestroySummary(result: EnterpriseDestroyResult): void {
  const workflow = result.workflow;
  printSuccess(
    `Enterprise destroy dispatched for ${result.request.customerSlug} ${result.request.stage}`,
  );

  if (workflow.run) {
    console.log(`  Run: ${workflow.run.url}`);
  }
  if (workflow.artifacts.length > 0) {
    console.log(`  Artifacts: ${workflow.artifacts.join(", ")}`);
  }
}
