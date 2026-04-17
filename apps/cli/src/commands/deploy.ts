import { Command } from "commander";
import { validateComponent, expandComponent, isProdLike, type Component } from "../config.js";
import { getAwsIdentity } from "../aws.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";
import { confirm } from "../prompt.js";
import { printHeader, printTierHeader, printSuccess, printError, printWarning, printSummary } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description("Run terraform apply for a stage. Prompts for stage in a TTY when omitted.")
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-c, --component <tier>", "Component tier (foundation|data|app|all)", "all")
    .option("-y, --yes", "Skip interactive confirmation (for CI)")
    .action(async (opts: { stage?: string; component: string; yes?: boolean }) => {
      const startTime = Date.now();

      try {
        const stage = await resolveStage({ flag: opts.stage });

        const compCheck = validateComponent(opts.component);
        if (!compCheck.valid) {
          printError(compCheck.error!);
          process.exit(1);
        }

        const identity = getAwsIdentity();
        printHeader("deploy", stage, identity);

        if (!identity) {
          printWarning("Could not resolve AWS identity. Is the AWS CLI configured?");
        }

        if (isProdLike(stage) && !opts.yes) {
          const ok = await confirm(`  Stage "${stage}" is production-like. Deploy?`);
          if (!ok) {
            console.log("  Aborted.");
            process.exit(0);
          }
        } else if (!opts.yes) {
          const ok = await confirm(`  Deploy to stage "${stage}"?`);
          if (!ok) {
            console.log("  Aborted.");
            process.exit(0);
          }
        }

        const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
        const tiers = expandComponent(opts.component as Component);

        for (let i = 0; i < tiers.length; i++) {
          const tier = tiers[i];
          printTierHeader(tier, i, tiers.length);

          const cwd = resolveTierDir(terraformDir, stage, tier);
          await ensureInit(cwd);
          await ensureWorkspace(cwd, stage);

          const code = await runTerraform(cwd, [
            "apply",
            "-auto-approve",
            `-var=stage=${stage}`,
          ]);
          if (code !== 0) {
            printError(`Deploy failed for ${tier} (exit ${code})`);
            process.exit(code);
          }
        }

        printSuccess("Deploy complete");
        printSummary("deploy", stage, tiers, startTime);
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }
    });
}
