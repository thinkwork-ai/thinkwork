import { Command } from "commander";
import { validateComponent, expandComponent, type Component } from "../config.js";
import { resolveTierDir, ensureInit, ensureWorkspace, runTerraform } from "../terraform.js";
import { printHeader, printTierHeader, printError } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";

export function registerOutputsCommand(program: Command): void {
  program
    .command("outputs")
    .description("Show terraform outputs for a stage. Prompts for stage in a TTY when omitted.")
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .option("-c, --component <tier>", "Component tier (foundation|data|app|all)", "all")
    .action(async (opts: { stage?: string; component: string }) => {
      try {
        const stage = await resolveStage({ flag: opts.stage });

        const compCheck = validateComponent(opts.component);
        if (!compCheck.valid) {
          printError(compCheck.error!);
          process.exit(1);
        }

        printHeader("outputs", stage);

        const terraformDir = process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
        const tiers = expandComponent(opts.component as Component);

        for (let i = 0; i < tiers.length; i++) {
          const tier = tiers[i];
          printTierHeader(tier, i, tiers.length);

          const cwd = resolveTierDir(terraformDir, stage, tier);
          await ensureInit(cwd);
          await ensureWorkspace(cwd, stage);

          const code = await runTerraform(cwd, ["output"]);
          if (code !== 0) {
            printError(`Outputs failed for ${tier} (exit ${code})`);
            process.exit(code);
          }
        }
      } catch (err) {
        if (isCancellation(err)) return;
        throw err;
      }
    });
}
