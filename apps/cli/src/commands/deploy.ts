import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .description(
      "Run terraform apply for a stage. Prompts for stage in a TTY when omitted.",
    )
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .option(
      "-c, --component <tier>",
      "Component tier (foundation|data|app|all)",
      "all",
    )
    .option("-y, --yes", "Skip interactive confirmation (for CI)")
    .action(
      async (opts: { stage?: string; component: string; yes?: boolean }) => {
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
            printWarning(
              "Could not resolve AWS identity. Is the AWS CLI configured?",
            );
          }

          if (isProdLike(stage) && !opts.yes) {
            const ok = await confirm(
              `  Stage "${stage}" is production-like. Deploy?`,
            );
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

          const terraformDir =
            process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
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

          // Post-deploy probe: surface any AgentCore Strands runtime drift as a
          // warning. AgentCore has no "flush warm pool" API for DEFAULT endpoints
          // (see scripts/post-deploy.sh for the rationale); this is an
          // early-warning check, not a mitigation. Intentionally non-fatal —
          // the 15-minute AgentCore reconciler is the real backstop.
          await runPostDeployProbe(stage);

          printSummary("deploy", stage, tiers, startTime);
        } catch (err) {
          if (isCancellation(err)) return;
          throw err;
        }
      },
    );
}

async function runPostDeployProbe(stage: string): Promise<void> {
  const scriptPath = locatePostDeployScript();
  if (!scriptPath) {
    // Script missing is a packaging issue, not a deploy failure. Log and move on.
    printWarning(
      "post-deploy probe script not found — skipping AgentCore drift check",
    );
    return;
  }
  await new Promise<void>((resolve) => {
    const proc = spawn("bash", [scriptPath, "--stage", stage], {
      stdio: "inherit",
      env: process.env,
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        // --strict is NOT passed above, so a non-zero here means the probe
        // itself broke (missing aws/jq, credentials error). Flag but continue.
        printWarning(
          `post-deploy probe exited ${code} — deploy not rolled back`,
        );
      }
      resolve();
    });
    proc.on("error", (err) => {
      printWarning(`post-deploy probe spawn failed: ${(err as Error).message}`);
      resolve();
    });
  });
}

/**
 * Find scripts/post-deploy.sh relative to the monorepo root. When the CLI is
 * run from source (pnpm dev), the script sits at ../../../scripts/post-deploy.sh
 * from this file. Returns null when not found (packaging layouts vary).
 */
function locatePostDeployScript(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    pathResolve(here, "..", "..", "..", "..", "scripts", "post-deploy.sh"),
    pathResolve(process.cwd(), "scripts", "post-deploy.sh"),
    pathResolve(
      process.env.THINKWORK_TERRAFORM_DIR || ".",
      "scripts",
      "post-deploy.sh",
    ),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
