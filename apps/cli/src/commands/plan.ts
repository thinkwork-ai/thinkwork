import { Command } from "commander";
import { validateComponent, expandComponent, type Component } from "../config.js";
import { getAwsIdentity } from "../aws.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";
import { printHeader, printTierHeader, printSuccess, printError, printSummary } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Run terraform plan for a stage. Prompts for stage in a TTY when omitted.")
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-c, --component <tier>", "Component tier (foundation|data|app|all)", "all")
    .action(async (opts: { stage?: string; component: string }) => {
      const startTime = Date.now();

      try {
        const stage = await resolveStage({ flag: opts.stage });

        const compCheck = validateComponent(opts.component);
        if (!compCheck.valid) {
          printError(compCheck.error!);
          process.exit(1);
        }

        const identity = getAwsIdentity();
        printHeader("plan", stage, identity);

        const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
        const tiers = expandComponent(opts.component as Component);

        for (let i = 0; i < tiers.length; i++) {
          const tier = tiers[i];
          printTierHeader(tier, i, tiers.length);

          const cwd = resolveTierDir(terraformDir, stage, tier);
          await ensureInit(cwd);
          await ensureWorkspace(cwd, stage);

          const code = await runTerraform(cwd, ["plan", `-var=stage=${stage}`]);
          if (code !== 0) {
            printError(`Plan failed for ${tier} (exit ${code})`);
            process.exit(code);
          }
        }

        printSuccess("Plan complete");
        printSummary("plan", stage, tiers, startTime);
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }
    });
}
