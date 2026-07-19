/**
 * `thinkwork logout` — clear stored sessions.
 *
 *   logout --stage <s>   forget just that stage
 *   logout --all         forget every stage
 *   logout               (no flags) prompts interactively, or errors in CI
 *
 * Cognito sessions are revoked through the stage API when reachable, then
 * deleted locally regardless of the remote result. No refresh credential is
 * retained for retry. AWS profile config remains untouched.
 */

import { Command } from "commander";
import { select } from "@inquirer/prompts";
import {
  loadCliConfig,
  clearStageSession,
  saveCliConfig,
  type CognitoSession,
} from "../cli-config.js";
import { printSuccess, printError, printHeader, printWarning } from "../ui.js";
import { isCancellation, requireTty } from "../lib/interactive.js";
import { getApiEndpoint } from "../aws-discovery.js";

export async function revokeCliCognitoSession(
  session: CognitoSession,
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${apiBaseUrl.replace(/\/+$/, "")}/api/auth/revoke`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: session.idToken,
        },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function revokeStageIfPossible(stage: string): Promise<boolean> {
  const session = loadCliConfig().sessions?.[stage];
  if (!session || session.kind !== "cognito") return true;
  const apiBaseUrl = getApiEndpoint(stage, session.region);
  if (!apiBaseUrl) return false;
  return revokeCliCognitoSession(session, apiBaseUrl);
}

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description(
      "Revoke and forget a stored Cognito session without changing your AWS profile.",
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
          const stages = Object.keys(loadCliConfig().sessions ?? {});
          const results = await Promise.all(
            stages.map((stage) => revokeStageIfPossible(stage)),
          );
          saveCliConfig({ sessions: {}, defaultStage: undefined });
          printHeader("logout", "(all stages)");
          printSuccess("Cleared every saved stack session.");
          if (results.some((revoked) => !revoked)) {
            printWarning(
              "One or more remote revocations could not be confirmed. Local credentials were still deleted; Cognito will expire any remaining server session.",
            );
          }
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

        const revoked = await revokeStageIfPossible(stage);
        clearStageSession(stage);
        // If the forgotten stage was the default, unset it too.
        const config = loadCliConfig();
        if (config.defaultStage === stage) {
          saveCliConfig({ defaultStage: undefined });
        }

        printHeader("logout", stage);
        printSuccess(`Forgot session for "${stage}".`);
        if (!revoked) {
          printWarning(
            "Remote revocation could not be confirmed. Local credentials were deleted and were not retained for retry.",
          );
        }
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
