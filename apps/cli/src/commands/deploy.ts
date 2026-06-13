import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import {
  validateComponent,
  validateStage,
  expandComponent,
  isProdLike,
  type Component,
} from "../config.js";
import { getAwsIdentity } from "../aws.js";
import {
  resolveTierDir,
  resolveTerraformRoot,
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
import {
  runEnterpriseDeploy,
  shouldUseEnterpriseDeploy,
  type EnterpriseDeployOptions,
  type EnterpriseDeployResult,
} from "./enterprise/deploy.js";

export interface DeployCommandOptions extends EnterpriseDeployOptions {
  profile?: string;
  stage?: string;
  component: string;
  yes?: boolean;
  controller?: boolean;
  controllerAction?: string;
  sessionId?: string;
}

export interface DeployCommandDependencies {
  localDeploy?: (opts: DeployCommandOptions) => Promise<void>;
  enterpriseDeploy?: (
    opts: DeployCommandOptions,
  ) => Promise<EnterpriseDeployResult>;
  controllerDeploy?: (
    opts: DeployCommandOptions,
  ) => Promise<ControllerDeployResult>;
  shouldUseEnterprise?: (opts: DeployCommandOptions) => boolean;
}

export interface ControllerDeployResult {
  stateMachineArn: string;
  executionArn: string | null;
  payload: ControllerDeployInput;
}

export interface ControllerDeployInput {
  schemaVersion: 1;
  contract: "thinkwork.deployment.controller.v1";
  phase: string;
  action: "plan" | "deploy" | "update";
  sessionId: string;
  customerName: string;
  environmentName: string;
  awsAccountId: string;
  awsRegion: string;
  evidenceBucket: string;
  evidence: {
    bucket: string;
    prefix: string;
    expectedArtifacts: string[];
  };
  releaseVersion: string;
  releaseManifestUrl: string;
  releaseManifestSha256: string;
  // Required at the top level: the orchestrator state machine resolves
  // $.terraformModuleVersion via a JsonPath parameter, so an input without it
  // fails the execution before CodeBuild ever starts.
  terraformModuleVersion: string;
  // The runner only reads runner secrets (customerDomain gates, adminEmail,
  // cognitoEmailSourceArn, ...) from the secret named here; omitting it makes
  // the runner silently ignore the stage's configured runner secrets.
  runnerSecretArn: string;
  release: {
    version: string;
    manifestUrl: string;
    manifestSha256: string;
  };
  session: {
    id: string;
    source: "cli";
    requestedAction: string;
  };
  operation: {
    kind: "foundation";
    action: "plan" | "deploy" | "update";
    plan: true;
    apply: boolean;
    destroy: false;
  };
  features: {
    baseInstall: {
      cognee: false;
      slack: false;
      stripe: false;
      twenty: false;
    };
    optionalApps: [];
  };
  terraform: {
    stateRecovery: {
      mode: "state";
      recoverByTags: false;
    };
  };
}

export interface ConfirmLocalDeployStageDependencies {
  confirm?: (message: string) => Promise<boolean>;
  promptInput?: (message: string) => Promise<string>;
  stdoutIsTty?: boolean;
}

export function registerDeployCommand(
  program: Command,
  deps: DeployCommandDependencies = {},
): void {
  program
    .command("deploy")
    .description(
      "Deploy ThinkWork. Defaults to local Terraform; uses enterprise CI with --bootstrap, --customer, or deployment repo context.",
    )
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage")
    .option(
      "-c, --component <tier>",
      "Component (local: foundation|data|app|all; enterprise: all|foundation|artifacts|overlays|smokes)",
      "all",
    )
    .option(
      "--bootstrap",
      "Run guided enterprise bootstrap: repo, trust, secrets, push, workflow",
    )
    .option("--customer <slug>", "Enterprise customer slug")
    .option("--repo <owner/name>", "Customer GitHub deployment repository")
    .option("--create-repo", "Create the customer deployment repository")
    .option("--checkout-dir <path>", "Managed enterprise deployment checkout")
    .option("--wait", "Wait for enterprise CI workflow completion")
    .option("--no-wait", "Do not wait for enterprise CI workflow completion")
    .option("--run-smokes", "Run enterprise workflow smoke checks")
    .option("--no-run-smokes", "Skip enterprise workflow smoke checks")
    .option(
      "--local-terraform",
      "Force the local Terraform deploy path even inside an enterprise deployment repo",
    )
    .option(
      "--controller",
      "Start the deployment controller instead of running local Terraform",
    )
    .option(
      "--controller-action <action>",
      "Deployment controller action (plan|deploy|update)",
      "update",
    )
    .option(
      "--session-id <id>",
      "Stable deployment controller session id for evidence correlation",
    )
    .option("--release-version <version>", "Pinned ThinkWork release version")
    .option("--manifest-url <url>", "Pinned ThinkWork release manifest URL")
    .option(
      "--manifest-sha256 <sha256>",
      "Pinned ThinkWork release manifest SHA-256",
    )
    .option(
      "--terraform-module-version <version>",
      "Pinned Terraform Registry module version",
    )
    .option("--db-password <value>", "Database password GitHub secret value")
    .option("--api-auth-secret <value>", "API auth GitHub secret value")
    .option(
      "--dry-run",
      "Plan enterprise bootstrap without mutating AWS, GitHub, git, or secrets",
    )
    .option("-y, --yes", "Skip interactive confirmation (for CI)")
    .action(async (opts: DeployCommandOptions) => {
      try {
        await runDeployCommand(opts, deps);
      } catch (err) {
        if (isCancellation(err)) return;
        printError((err as Error).message);
        process.exit(1);
      }
    });
}

export async function runDeployCommand(
  opts: DeployCommandOptions,
  deps: DeployCommandDependencies = {},
): Promise<void> {
  if (opts.controller) {
    const controllerDeploy = deps.controllerDeploy ?? runControllerDeploy;
    const result = await controllerDeploy(opts);
    printSuccess(
      `Deployment controller execution started: ${result.executionArn ?? "unknown execution ARN"}`,
    );
    return;
  }

  const shouldUseEnterprise =
    deps.shouldUseEnterprise ?? shouldUseEnterpriseDeploy;
  if (shouldUseEnterprise(opts)) {
    const enterpriseDeploy = deps.enterpriseDeploy ?? runEnterpriseDeploy;
    const result = await enterpriseDeploy(opts);
    printEnterpriseDeploySummary(result);
    return;
  }

  const localDeploy = deps.localDeploy ?? runLocalTerraformDeploy;
  await localDeploy(opts);
}

export async function runControllerDeploy(
  opts: DeployCommandOptions,
): Promise<ControllerDeployResult> {
  const stage = await resolveStage({ flag: opts.stage });
  const identity = getAwsIdentity();
  printHeader("deployment-controller", stage, identity);

  if (!identity) {
    throw new Error(
      "Could not resolve AWS identity. Is the AWS CLI configured?",
    );
  }
  if (!opts.manifestUrl || !opts.manifestSha256) {
    throw new Error(
      "--manifest-url and --manifest-sha256 are required for controller deploys.",
    );
  }

  const action = normalizeControllerDeployAction(opts.controllerAction);
  const sessionId =
    opts.sessionId ??
    `cli-${stage}-${new Date().toISOString().replace(/[^0-9TZ]/g, "")}`;
  const stateMachineArn = controllerStateMachineArn({
    stage,
    region: identity.region,
    accountId: identity.account,
  });
  const payload = buildControllerDeployInput({
    action,
    stage,
    accountId: identity.account,
    region: identity.region,
    releaseVersion: opts.releaseVersion ?? "unresolved",
    manifestUrl: opts.manifestUrl,
    manifestSha256: opts.manifestSha256,
    terraformModuleVersion: opts.terraformModuleVersion,
    sessionId,
  });
  const args = [
    "stepfunctions",
    "start-execution",
    "--state-machine-arn",
    stateMachineArn,
    "--name",
    controllerExecutionName(sessionId),
    "--input",
    JSON.stringify(payload),
    "--region",
    identity.region,
    "--output",
    "json",
  ];
  if (opts.profile) args.push("--profile", opts.profile);

  const started = spawnSync("aws", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (started.status !== 0) {
    throw new Error(
      `Deployment controller start failed: ${started.stderr || started.stdout}`,
    );
  }

  const parsed = JSON.parse(started.stdout || "{}") as {
    executionArn?: string;
  };
  return {
    stateMachineArn,
    executionArn: parsed.executionArn ?? null,
    payload,
  };
}

export function buildControllerDeployInput(options: {
  action: "plan" | "deploy" | "update";
  stage: string;
  accountId: string;
  region: string;
  releaseVersion: string;
  manifestUrl: string;
  manifestSha256: string;
  terraformModuleVersion?: string;
  sessionId: string;
}): ControllerDeployInput {
  const evidenceBucket = `thinkwork-${options.stage}-${options.accountId}-deploy-evidence`;
  const evidencePrefix = `sessions/${options.sessionId}/${options.action}`;
  // Registry module versions are unprefixed ("0.1.0-canary.178") while release
  // tags carry a "v"; derive the module pin from the release when not given.
  const terraformModuleVersion =
    options.terraformModuleVersion ?? options.releaseVersion.replace(/^v/, "");
  return {
    schemaVersion: 1,
    contract: "thinkwork.deployment.controller.v1",
    phase: options.action,
    action: options.action,
    sessionId: options.sessionId,
    customerName: "ThinkWork",
    environmentName: options.stage,
    awsAccountId: options.accountId,
    awsRegion: options.region,
    evidenceBucket,
    evidence: {
      bucket: evidenceBucket,
      prefix: evidencePrefix,
      expectedArtifacts: [
        "controller-input-summary.json",
        "redacted-terraform-vars.json",
        "terraform-plan.json",
        "terraform-outputs.json",
        "deployment-evidence.json",
      ],
    },
    releaseVersion: options.releaseVersion,
    releaseManifestUrl: options.manifestUrl,
    releaseManifestSha256: options.manifestSha256,
    terraformModuleVersion,
    runnerSecretArn: `/thinkwork/${options.stage}/deployment/runner-secrets`,
    release: {
      version: options.releaseVersion,
      manifestUrl: options.manifestUrl,
      manifestSha256: options.manifestSha256,
    },
    session: {
      id: options.sessionId,
      source: "cli",
      requestedAction: options.action,
    },
    operation: {
      kind: "foundation",
      action: options.action,
      plan: true,
      apply: options.action !== "plan",
      destroy: false,
    },
    features: {
      baseInstall: {
        cognee: false,
        slack: false,
        stripe: false,
        twenty: false,
      },
      optionalApps: [],
    },
    terraform: {
      stateRecovery: {
        mode: "state",
        recoverByTags: false,
      },
    },
  };
}

export function controllerStateMachineArn(options: {
  stage: string;
  region: string;
  accountId: string;
}): string {
  return `arn:aws:states:${options.region}:${options.accountId}:stateMachine:thinkwork-${options.stage}-deployment-orchestrator`;
}

function controllerExecutionName(sessionId: string): string {
  return `tw-${sessionId.replace(/[^A-Za-z0-9-_]/g, "-").slice(0, 77)}`;
}

function normalizeControllerDeployAction(
  action: string | undefined,
): "plan" | "deploy" | "update" {
  if (action === "plan" || action === "deploy" || action === "update") {
    return action;
  }
  throw new Error("--controller-action must be one of: plan, deploy, update");
}

export async function runLocalTerraformDeploy(
  opts: DeployCommandOptions,
): Promise<void> {
  const startTime = Date.now();
  const initialStage = await resolveStage({ flag: opts.stage });

  const compCheck = validateComponent(opts.component);
  if (!compCheck.valid) {
    printError(compCheck.error!);
    process.exit(1);
  }

  const identity = getAwsIdentity();
  printHeader("deploy", initialStage, identity);

  if (!identity) {
    printWarning("Could not resolve AWS identity. Is the AWS CLI configured?");
  }

  const stage = await confirmLocalDeployStage(initialStage, opts);
  if (!stage) {
    console.log("  Aborted.");
    process.exit(0);
  }
  if (stage !== initialStage) {
    printHeader("deploy", stage, identity);
    if (!identity) {
      printWarning(
        "Could not resolve AWS identity. Is the AWS CLI configured?",
      );
    }
  }

  const terraformDir = resolveTerraformRoot();
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
}

export async function confirmLocalDeployStage(
  initialStage: string,
  opts: Pick<DeployCommandOptions, "yes">,
  deps: ConfirmLocalDeployStageDependencies = {},
): Promise<string | null> {
  if (opts.yes) return initialStage;

  let stage = initialStage;
  while (true) {
    const ok = await (deps.confirm ?? confirm)(deployConfirmMessage(stage));
    if (ok) return stage;

    const canPromptForAnotherStage =
      deps.stdoutIsTty ?? Boolean(process.stdout.isTTY);
    if (!canPromptForAnotherStage) return null;

    const nextStage = (
      await promptAlternativeDeployStage(stage, deps.promptInput)
    ).trim();
    if (!nextStage) return null;

    const check = validateStage(nextStage);
    if (!check.valid) {
      throw new Error(check.error);
    }
    stage = nextStage;
  }
}

function deployConfirmMessage(stage: string): string {
  return isProdLike(stage)
    ? `  Stage "${stage}" is production-like. Deploy?`
    : `  Deploy to stage "${stage}"?`;
}

async function promptAlternativeDeployStage(
  currentStage: string,
  promptInput: ConfirmLocalDeployStageDependencies["promptInput"],
): Promise<string> {
  const message = `Deployment stage to deploy instead of "${currentStage}" (blank to abort):`;
  if (promptInput) return promptInput(message);

  const { input } = await import("@inquirer/prompts");
  return input({ message });
}

function printEnterpriseDeploySummary(result: EnterpriseDeployResult): void {
  const workflow = result.workflow;
  if (result.kind === "bootstrap") {
    printSuccess(
      `Enterprise deploy bootstrap prepared ${result.request.customerSlug} ${result.request.stage}`,
    );
  } else {
    printSuccess(
      `Enterprise deploy dispatched for ${result.request.customerSlug} ${result.request.stage}`,
    );
  }

  if (workflow.run) {
    console.log(`  Run: ${workflow.run.url}`);
  }
  if (workflow.artifacts.length > 0) {
    console.log(`  Artifacts: ${workflow.artifacts.join(", ")}`);
  }
  const urlEntries = Object.entries(workflow.urls).filter(([, value]) => value);
  if (urlEntries.length > 0) {
    console.log("  URLs");
    for (const [label, value] of urlEntries) {
      console.log(`  - ${label}: ${value}`);
    }
  }
  if (workflow.discoveryWarning) {
    printWarning(workflow.discoveryWarning);
  }
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
