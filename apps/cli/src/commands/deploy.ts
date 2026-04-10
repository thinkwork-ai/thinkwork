import { Command } from "commander";
import { validateStage, validateComponent, expandComponent, isProdLike, type Component } from "../config.js";
import { getAwsIdentity, formatIdentity } from "../aws.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";
import { confirm } from "../prompt.js";

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description("Run terraform apply for a stage")
    .requiredOption("-s, --stage <name>", "Deployment stage")
    .option("-c, --component <tier>", "Component tier (foundation|data|app|all)", "all")
    .option("-y, --yes", "Skip interactive confirmation (for CI)")
    .action(async (opts: { stage: string; component: string; yes?: boolean }) => {
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

      // Safety: require confirmation for prod-like stages
      if (isProdLike(opts.stage) && !opts.yes) {
        const ok = await confirm(
          `\n  Stage "${opts.stage}" is production-like. Deploy?`
        );
        if (!ok) {
          console.log("Aborted.");
          process.exit(0);
        }
      } else if (!opts.yes) {
        const ok = await confirm(`\n  Deploy to stage "${opts.stage}"?`);
        if (!ok) {
          console.log("Aborted.");
          process.exit(0);
        }
      }

      const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
      const tiers = expandComponent(opts.component as Component);

      for (const tier of tiers) {
        console.log(`\n━━━ deploy: ${opts.stage} / ${tier} ━━━`);
        const cwd = resolveTierDir(terraformDir, opts.stage, tier);
        await ensureInit(cwd);
        await ensureWorkspace(cwd, opts.stage);

        const code = await runTerraform(cwd, [
          "apply",
          "-auto-approve",
          `-var=stage=${opts.stage}`,
        ]);
        if (code !== 0) {
          console.error(`\nDeploy failed for ${tier} (exit ${code})`);
          process.exit(code);
        }
      }

      console.log("\n✓ Deploy complete");
    });
}
