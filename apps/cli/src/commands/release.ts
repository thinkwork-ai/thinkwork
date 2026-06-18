/**
 * `thinkwork release` — list published platform releases and install one in
 * a customer environment through the deployment controller.
 *
 * Bare `thinkwork release` runs the interactive flow: show the last five
 * published releases, pick one, confirm, and start the controller update.
 * `release list` and `release deploy [version]` expose the pieces directly.
 *
 * The controller (Step Functions `thinkwork-<stage>-deployment-orchestrator`
 * + CodeBuild runner) does the actual terraform work inside the target
 * account; this command only resolves the release pin, carries forward the
 * environment facts from the previous successful execution, and starts the
 * state machine.
 */

import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { select } from "@inquirer/prompts";

import { getAwsIdentity } from "../aws.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { promptOrExit, requireTty } from "../lib/interactive.js";
import { printError, printSuccess, printWarning } from "../ui.js";
import { confirm } from "../prompt.js";
import {
  buildControllerUpdateInput,
  controllerExecutionName,
  fetchRecentReleases,
  parsePriorControllerInput,
  resolveReleaseManifest,
  type PriorControllerInput,
  type ReleaseSummary,
} from "./release/helpers.js";

const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 45 * 60 * 1000;

function aws(args: string[]): string {
  return execFileSync("aws", args, {
    encoding: "utf-8",
    timeout: 60_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

interface DeployOptions {
  stage?: string;
  yes?: boolean;
  wait?: boolean;
  webOnly?: boolean;
}

export function registerReleaseCommand(
  program: Command,
  // Test seam: the registration test injects a spy to prove flags placed
  // after the subcommand actually reach the handler (see the commander
  // parent/child duplicate-flag note in the deploy action).
  deployImpl: (
    version: string | undefined,
    opts: DeployOptions,
  ) => Promise<void> = deployRelease,
): void {
  const release = program
    .command("release")
    .description(
      "List platform releases and install one in a deployed environment via the deployment controller. Bare `thinkwork release` picks from the last five interactively.",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-y, --yes", "Skip the confirmation prompt")
    .option("--web-only", "Sync only the web application static bundle")
    .option(
      "--no-wait",
      "Start the controller execution and return immediately",
    )
    .action(async (_opts: DeployOptions, command: Command) => {
      await deployImpl(undefined, command.optsWithGlobals<DeployOptions>());
    });

  release
    .command("list")
    .description("Show the five most recent published platform releases")
    .action(async () => {
      const releases = await listOrExit();
      for (const r of releases) {
        const date = r.publishedAt ? r.publishedAt.slice(0, 10) : "unknown";
        console.log(`  ${r.version}  (${date})`);
      }
    });

  release
    .command("deploy [version]")
    .description(
      "Install a release in a deployed environment (prompts over the last five when version is omitted)",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("-y, --yes", "Skip the confirmation prompt")
    .option("--web-only", "Sync only the web application static bundle")
    .option(
      "--no-wait",
      "Start the controller execution and return immediately",
    )
    .action(
      async (
        version: string | undefined,
        _opts: DeployOptions,
        command: Command,
      ) => {
        // Duplicate flags (-s/--yes/--no-wait) exist on both the `release`
        // group and this subcommand; commander parses them onto the PARENT
        // when they follow the subcommand name, so read the merged chain.
        await deployImpl(version, command.optsWithGlobals<DeployOptions>());
      },
    );
}

async function listOrExit(): Promise<ReleaseSummary[]> {
  try {
    const releases = await fetchRecentReleases(5);
    if (releases.length === 0) {
      printError("No published platform releases found on GitHub.");
      process.exit(1);
    }
    return releases;
  } catch (err) {
    printError(`Could not list releases: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function deployRelease(
  versionArg: string | undefined,
  opts: DeployOptions,
): Promise<void> {
  const stage = await resolveStage({ flag: opts.stage });

  const identity = getAwsIdentity();
  if (!identity || identity.region === "unknown") {
    printError(
      "Could not resolve AWS identity/region. Check AWS_PROFILE / AWS_REGION.",
    );
    process.exit(1);
  }

  const stateMachineArn = `arn:aws:states:${identity.region}:${identity.account}:stateMachine:thinkwork-${stage}-deployment-orchestrator`;

  // Environment facts ride the previous successful execution's input.
  const prior = resolvePriorInputOrExit(stateMachineArn);

  // Resolve the release: explicit version, or interactive pick over last 5.
  let version = versionArg;
  if (!version) {
    const releases = await listOrExit();
    requireTty("Release");
    version = await promptOrExit(() =>
      select({
        message: `Which release should ${stage} run?`,
        choices: releases.map((r) => ({
          name:
            r.version === prior.releaseVersion
              ? `${r.version}  (currently installed)`
              : `${r.version}  (${r.publishedAt.slice(0, 10)})`,
          value: r.version,
        })),
      }),
    );
  }
  if (!version.startsWith("v")) version = `v${version}`;

  if (version === prior.releaseVersion && !opts.yes) {
    printWarning(
      `${stage} already runs ${version}; redeploying the same release.`,
    );
  }

  const resolved = await resolveReleaseManifest(version);
  const input = buildControllerUpdateInput({
    prior,
    release: resolved,
    webOnly: opts.webOnly,
  });

  console.log("");
  console.log(`  Customer:     ${prior.customerName}`);
  console.log(
    `  Environment:  ${prior.environmentName} (account ${identity.account}, ${identity.region})`,
  );
  console.log(
    `  Release:      ${prior.releaseVersion ?? "unknown"} -> ${version}`,
  );
  console.log(
    `  Scope:        ${opts.webOnly ? "web application only" : "full controller update"}`,
  );
  console.log(
    `  Manifest:     sha256 ${resolved.manifestSha256.slice(0, 16)}…`,
  );
  console.log("");

  if (!opts.yes) {
    requireTty("Confirmation");
    const ok = await confirm(
      `Start the controller ${opts.webOnly ? "web-only update" : "update"} on ${stage}?`,
    );
    if (!ok) {
      console.log("Aborted.");
      process.exit(1);
    }
  }

  const name = controllerExecutionName(stage, version, new Date());
  let executionArn: string;
  try {
    executionArn = aws([
      "stepfunctions",
      "start-execution",
      "--state-machine-arn",
      stateMachineArn,
      "--name",
      name,
      "--input",
      JSON.stringify(input),
      "--query",
      "executionArn",
      "--output",
      "text",
    ]).trim();
  } catch (err) {
    printError(
      `Could not start the controller execution: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  printSuccess(`Started ${name}`);
  console.log(`  Execution: ${executionArn}`);
  console.log(
    `  Evidence:  s3://${prior.evidenceBucket}/settings/releases/${version}/`,
  );

  if (opts.wait === false) {
    console.log("  Not waiting (--no-wait). Check status with:");
    console.log(
      `    aws stepfunctions describe-execution --execution-arn ${executionArn}`,
    );
    return;
  }

  await waitForExecution(executionArn);
}

function resolvePriorInputOrExit(
  stateMachineArn: string,
): PriorControllerInput {
  let executions: Array<{ executionArn: string; status: string }>;
  try {
    executions = JSON.parse(
      aws([
        "stepfunctions",
        "list-executions",
        "--state-machine-arn",
        stateMachineArn,
        "--status-filter",
        "SUCCEEDED",
        "--max-results",
        "1",
        "--query",
        "executions",
        "--output",
        "json",
      ]),
    );
  } catch (err) {
    printError(
      `Could not reach the deployment controller (${stateMachineArn}): ${(err as Error).message}`,
    );
    process.exit(1);
  }
  if (!executions.length) {
    printError(
      "No successful controller deployment found for this stage. First-time installs go through `thinkwork enterprise bootstrap`, not `release deploy`.",
    );
    process.exit(1);
  }
  try {
    const raw = aws([
      "stepfunctions",
      "describe-execution",
      "--execution-arn",
      executions[0].executionArn,
      "--query",
      "input",
      "--output",
      "text",
    ]);
    return parsePriorControllerInput(JSON.parse(raw));
  } catch (err) {
    printError(
      `Could not read the previous controller execution input: ${(err as Error).message}`,
    );
    process.exit(1);
  }
}

async function waitForExecution(executionArn: string): Promise<void> {
  const startedAt = Date.now();
  process.stdout.write("  Waiting for the controller run");
  for (;;) {
    await new Promise((resolveSleep) =>
      setTimeout(resolveSleep, POLL_INTERVAL_MS),
    );
    let status: { status: string; error?: string; cause?: string };
    try {
      status = JSON.parse(
        aws([
          "stepfunctions",
          "describe-execution",
          "--execution-arn",
          executionArn,
          "--query",
          "{status:status,error:error,cause:cause}",
          "--output",
          "json",
        ]),
      );
    } catch {
      process.stdout.write("?");
      continue;
    }
    if (status.status === "RUNNING") {
      process.stdout.write(".");
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        console.log("");
        printWarning(
          "Still running after 45 minutes — leaving it to finish. Check the execution in the Step Functions console.",
        );
        return;
      }
      continue;
    }
    console.log("");
    if (status.status === "SUCCEEDED") {
      printSuccess("Controller update succeeded.");
      return;
    }
    printError(
      `Controller update ${status.status}${status.error ? `: ${status.error}` : ""}${status.cause ? ` — ${status.cause}` : ""}`,
    );
    process.exit(1);
  }
}
