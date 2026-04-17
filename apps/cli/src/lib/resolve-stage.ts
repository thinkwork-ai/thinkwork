/**
 * Resolve which deployed stage a command targets.
 *
 * Order:
 *   1. Explicit `--stage` / `-s` flag.
 *   2. `THINKWORK_STAGE` env var.
 *   3. `defaultStage` from `~/.thinkwork/config.json` (set by `thinkwork login`
 *      or stashed manually).
 *   4. If there's only one deployed stage in the region, use it (and log it).
 *   5. Interactive picker over the deployed stages (TTY only).
 *
 * Non-TTY with no resolvable stage prints a clear error and exits 1.
 */

import { select } from "@inquirer/prompts";
import { loadCliConfig } from "../cli-config.js";
import { listDeployedStages } from "../aws-discovery.js";
import { printError } from "../ui.js";
import { validateStage } from "../config.js";
import { requireTty } from "./interactive.js";

export interface ResolveStageOptions {
  /** Value of the command's `--stage` / `-s` flag, if any. */
  flag?: string;
  /** AWS region to scan when prompting. Defaults to us-east-1. */
  region?: string;
  /**
   * When true (default) we validate the stage string against the allowed
   * pattern (validateStage). Skip this only when callers have their own
   * validation — e.g. when the stage comes directly from an AWS scan.
   */
  validate?: boolean;
}

export async function resolveStage(opts: ResolveStageOptions = {}): Promise<string> {
  const region = opts.region ?? "us-east-1";
  const validate = opts.validate ?? true;

  const raw =
    opts.flag ??
    process.env.THINKWORK_STAGE ??
    loadCliConfig().defaultStage ??
    (await pickStage(region));

  if (!raw) {
    printError(
      "No stage specified. Pass `--stage <name>`, set THINKWORK_STAGE, or run `thinkwork login --stage <name>`.",
    );
    process.exit(1);
  }

  if (validate) {
    const check = validateStage(raw);
    if (!check.valid) {
      printError(check.error!);
      process.exit(1);
    }
  }

  return raw;
}

async function pickStage(region: string): Promise<string | null> {
  const stages = listDeployedStages(region);
  if (stages.length === 0) {
    printError(
      `No Thinkwork deployments found in ${region}. Run \`thinkwork list\` or pass --region.`,
    );
    process.exit(1);
  }
  if (stages.length === 1) {
    console.log(`  Using the only deployed stage: ${stages[0]}`);
    return stages[0];
  }
  requireTty("Stage");
  return await select({
    message: "Which stage?",
    choices: stages.map((s) => ({ name: s, value: s })),
    loop: false,
  });
}
