import { Command } from "commander";
import { validateStage, validateComponent, expandComponent, isProdLike, type Component } from "../config.js";
import { getAwsIdentity } from "../aws.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";
import { confirm } from "../prompt.js";
import { printHeader, printTierHeader, printSuccess, printError, printWarning, printSummary } from "../ui.js";

export function registerDestroyCommand(program: Command): void {
  program
    .command("destroy")
    .description("Run terraform destroy for a stage")
    .option("-p, --profile <name>", "AWS profile")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .option("-c, --component <tier>", "Component tier (foundation|data|app|all)", "all")
    .option("-y, --yes", "Skip interactive confirmation (for CI)")
    .action(async (opts: { stage: string; component: string; yes?: boolean }) => {
      const startTime = Date.now();

      const stageCheck = validateStage(opts.stage);
      if (!stageCheck.valid) {
        printError(stageCheck.error!);
        process.exit(1);
      }

      const compCheck = validateComponent(opts.component);
      if (!compCheck.valid) {
        printError(compCheck.error!);
        process.exit(1);
      }

      const identity = getAwsIdentity();
      printHeader("destroy", opts.stage, identity);

      if (!identity) {
        printWarning("Could not resolve AWS identity. Is the AWS CLI configured?");
      }

      // Destroy ALWAYS requires confirmation — even with --yes for prod-like stages
      if (isProdLike(opts.stage)) {
        printWarning(`Stage "${opts.stage}" is production-like.`);
        if (!opts.yes) {
          const ok = await confirm(
            `  Type 'y' to confirm destruction of stage "${opts.stage}":`,
          );
          if (!ok) {
            console.log("  Aborted.");
            process.exit(0);
          }
        }
        console.log(`  Proceeding with destroy of "${opts.stage}" (--yes provided).`);
      } else if (!opts.yes) {
        const ok = await confirm(`  Destroy stage "${opts.stage}"?`);
        if (!ok) {
          console.log("  Aborted.");
          process.exit(0);
        }
      }

      const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
      // Destroy in reverse dependency order: app → data → foundation
      const tiers = expandComponent(opts.component as Component).reverse();

      for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];
        printTierHeader(tier, i, tiers.length);

        const cwd = resolveTierDir(terraformDir, opts.stage, tier);
        await ensureInit(cwd);
        await ensureWorkspace(cwd, opts.stage);

        const code = await runTerraform(cwd, [
          "destroy",
          "-auto-approve",
          `-var=stage=${opts.stage}`,
        ]);
        if (code !== 0) {
          printError(`Destroy failed for ${tier} (exit ${code})`);
          process.exit(code);
        }
      }

      printSuccess("Destroy complete");
      printSummary("destroy", opts.stage, tiers, startTime);
    });
}
