import { Command } from "commander";
import { validateStage, validateComponent, expandComponent, type Component } from "../config.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";

export function registerOutputsCommand(program: Command): void {
  program
    .command("outputs")
    .description("Show terraform outputs for a stage")
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

      const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
      const tiers = expandComponent(opts.component as Component);

      for (const tier of tiers) {
        console.log(`\n━━━ outputs: ${opts.stage} / ${tier} ━━━`);
        const cwd = resolveTierDir(terraformDir, opts.stage, tier);
        await ensureInit(cwd);
        await ensureWorkspace(cwd, opts.stage);

        const code = await runTerraform(cwd, ["output"]);
        if (code !== 0) {
          console.error(`\nOutputs failed for ${tier} (exit ${code})`);
          process.exit(code);
        }
      }
    });
}
