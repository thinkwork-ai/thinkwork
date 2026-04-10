import { Command } from "commander";
import { validateStage, validateComponent, expandComponent, type Component } from "../config.js";
import { getAwsIdentity, formatIdentity } from "../aws.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Run terraform plan for a stage")
    .option("-p, --profile <name>", "AWS profile")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .option("-c, --component <tier>", "Component tier (foundation|data|app|all)", "all")
    .action(async (opts: { stage: string; component: string }) => {
      const stageCheck = validateStage(opts.stage);
      if (!stageCheck.valid) {
        console.error(`Error: ${stageCheck.error}`);
        process.exit(1);
      }

      const compCheck = validateComponent(opts.component);
      if (!compCheck.valid) {
        console.error(`Error: ${compCheck.error}`);
        process.exit(1);
      }

      const identity = getAwsIdentity();
      if (identity) {
        console.log(`\n  ${formatIdentity(identity)}`);
      } else {
        console.warn("\n  Warning: could not resolve AWS identity. Is the AWS CLI configured?");
      }

      const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
      const tiers = expandComponent(opts.component as Component);

      for (const tier of tiers) {
        console.log(`\n━━━ plan: ${opts.stage} / ${tier} ━━━`);
        const cwd = resolveTierDir(terraformDir, opts.stage, tier);
        await ensureInit(cwd);
        await ensureWorkspace(cwd, opts.stage);

        const code = await runTerraform(cwd, [
          "plan",
          `-var=stage=${opts.stage}`,
        ]);
        if (code !== 0) {
          console.error(`\nPlan failed for ${tier} (exit ${code})`);
          process.exit(code);
        }
      }

      console.log("\n✓ Plan complete");
    });
}
