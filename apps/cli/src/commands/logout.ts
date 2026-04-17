/**
 * `thinkwork logout` — clear stored sessions.
 *
 *   logout --stage <s>   forget just that stage
 *   logout --all         forget every stage
 *   logout               (no flags) prompts interactively, or errors in CI
 *
 * This only touches ~/.thinkwork/config.json — AWS profile config and Cognito
 * pool state are untouched. Re-run `thinkwork login --stage <s>` to restore.
 */

import { Command } from "commander";
import { select } from "@inquirer/prompts";
import {
  loadCliConfig,
  clearStageSession,
  saveCliConfig,
} from "../cli-config.js";
import { printSuccess, printError, printHeader } from "../ui.js";
import { isCancellation, requireTty } from "../lib/interactive.js";

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description(
      "Forget a stored session. Touches only ~/.thinkwork/config.json; your AWS profile and Cognito pool are untouched.",
    )
    .option("-s, --stage <name>", "Stage whose session to forget")
    .option("--all", "Forget every stage's session")
    .addHelpText(
      "after",
      `
Examples:
  # Forget the session for one stage
  $ thinkwork logout --stage dev

  # Forget every saved session (doesn't affect your AWS profile)
  $ thinkwork logout --all

  # Pick interactively
  $ thinkwork logout
`,
    )
    .action(async (opts: { stage?: string; all?: boolean }) => {
      try {
        if (opts.all) {
          saveCliConfig({ sessions: {}, defaultStage: undefined });
          printHeader("logout", "(all stages)");
          printSuccess("Cleared every saved stack session.");
          return;
        }

        let stage = opts.stage;
        if (!stage) {
          const config = loadCliConfig();
          const keys = Object.keys(config.sessions ?? {});
          if (keys.length === 0) {
            printSuccess("No sessions stored — nothing to forget.");
            return;
          }
          if (keys.length === 1) {
            stage = keys[0];
            console.log(`  Only one session stored: ${stage}`);
          } else {
            requireTty("Stage");
            stage = await select({
              message: "Forget which stage's session?",
              choices: keys.map((s) => ({ name: s, value: s })),
              loop: false,
            });
          }
        }

        clearStageSession(stage);
        // If the forgotten stage was the default, unset it too.
        const config = loadCliConfig();
        if (config.defaultStage === stage) {
          saveCliConfig({ defaultStage: undefined });
        }

        printHeader("logout", stage);
        printSuccess(`Forgot session for "${stage}".`);
      } catch (err) {
        if (isCancellation(err)) {
          console.log("  Cancelled.");
          return;
        }
        printError(
          `Logout failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
