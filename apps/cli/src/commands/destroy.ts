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
import { loadEnvironment } from "../environments.js";
import {
  disableClusterDeletionProtection,
  emptyBucket,
  forceDeleteStageSecrets,
  listStageBuckets,
  orphanCount,
  scanOrphans,
} from "../lib/clean-slate.js";
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

  // Graduated-stage guard (U7): the strongest protection keys on the
  // persisted identity recorded at graduation, not on stage-name patterns —
  // a `prod` substring match would false-match ephemeral hprod-* harness
  // stages while a renamed real stage could slip through.
  const localEnv = loadEnvironment(stage);
  if (localEnv?.graduated) {
    if (opts.yes && !opts.stage) {
      printError(
        `Stage "${stage}" is a graduated (persistent) environment. --yes requires an explicit ` +
          `--stage ${stage} — config-default fallback is disabled for graduated stages.`,
      );
      process.exit(1);
    }
    if (identity && identity.account !== localEnv.accountId) {
      printError(
        `Stage "${stage}" was graduated in account ${localEnv.accountId}, but the current ` +
          `credentials are account ${identity.account}. Refusing to destroy.`,
      );
      process.exit(1);
    }
    printWarning(`Stage "${stage}" is a graduated persistent environment.`);
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

  // Drop RDS deletion protection (U7): Aurora deploys protected by default,
  // which fails DeleteDBCluster at the very end of the teardown otherwise.
  // The explicit destroy confirmation above IS the deliberate act the
  // protection exists to require.
  const preRegion =
    identity && identity.region !== "unknown" ? identity.region : "us-east-1";
  const cluster = disableClusterDeletionProtection(stage, preRegion);
  if (cluster.found && cluster.disabled) {
    console.log(
      `  RDS deletion protection disabled on thinkwork-${stage}-db.`,
    );
  } else if (cluster.found && !cluster.disabled) {
    printWarning(
      `Could not disable deletion protection on thinkwork-${stage}-db — the database tier will fail to destroy.`,
    );
  }

  // Pre-empty stage buckets (U7): versioned/non-empty buckets otherwise block
  // terraform's bucket deletion and strand the teardown partway.
  const buckets = listStageBuckets(stage);
  for (const bucket of buckets) {
    console.log(`  Emptying s3://${bucket} (including versions)...`);
    const result = emptyBucket(bucket);
    if (!result.emptied) {
      printWarning(
        `Could not fully empty s3://${bucket} — terraform may fail on it; rerun destroy afterwards.`,
      );
    }
  }

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    printTierHeader(tier, i, tiers.length);

    const cwd = resolveTierDir(terraformDir, stage, tier);
    await ensureInit(cwd);
    await ensureWorkspace(cwd, stage);

    // Bounded retry (U7): dependency-order errors (lingering ENIs, eventual
    // consistency) usually clear on a repeat; terraform destroy is idempotent.
    let code = 1;
    for (let attempt = 1; attempt <= 3; attempt++) {
      code = await runTerraform(cwd, [
        "destroy",
        "-auto-approve",
        `-var=stage=${stage}`,
      ]);
      if (code === 0) break;
      if (attempt < 3) {
        printWarning(
          `Destroy attempt ${attempt} for ${tier} failed (exit ${code}) — retrying (dependency-order errors usually clear).`,
        );
      }
    }
    if (code !== 0) {
      printError(`Destroy failed for ${tier} after 3 attempts (exit ${code})`);
      process.exit(code);
    }
  }

  // Force-delete stage secrets (U7): entries left in the 7-day recovery
  // window break an immediate redeploy with AlreadyExists.
  if (identity) {
    const region =
      identity.region !== "unknown" ? identity.region : "us-east-1";
    const deleted = forceDeleteStageSecrets(stage, region);
    if (deleted.length > 0) {
      console.log(
        `  Force-deleted ${deleted.length} lingering secret(s) (no recovery window).`,
      );
    }

    // Orphan scan (U7): report anything still carrying the stage prefix so a
    // "clean" destroy that wasn't is visible instead of silent.
    const orphans = scanOrphans(stage, region);
    const count = orphanCount(orphans);
    if (count > 0) {
      printWarning(`Orphan scan found ${count} leftover resource(s):`);
      for (const [kind, names] of Object.entries(orphans)) {
        for (const name of names as string[]) {
          console.log(`    - ${kind}: ${name}`);
        }
      }
    } else {
      console.log("  Orphan scan: clean — account ready for redeploy.");
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
