import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
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
  isInitScaffoldedLayout,
  runTerraform,
  runTerraformTee,
  terraformOutput,
} from "../terraform.js";
import {
  type BackendTarget,
  backendTarget,
  ensureStateBackend,
  parseLockError,
} from "../lib/state-backend.js";
import {
  type PreflightContext,
  preflightChecks,
  runChecks,
} from "../lib/checks.js";
import {
  materializeBundle,
  releaseLambdaPrefix,
  resolveReleaseArtifacts,
  seedLambdaArtifacts,
  upsertTfvarsValues,
} from "../lib/release.js";
import { applyMigrations } from "../lib/db-migrations.js";
import { runWorkspaceBootstrap } from "./bootstrap.js";
import { runStageVerification } from "./verify.js";
import { fetchRecentReleases } from "./release/helpers.js";
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
  skipPreflight?: boolean;
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
  action: "plan" | "deploy" | "update" | "web";
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
  terraformModuleSource: string;
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
    kind: "foundation" | "web";
    action: "plan" | "deploy" | "update" | "web";
    plan: boolean;
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
      "Component (local: foundation|data|app|all; enterprise: all|foundation|artifacts|web|overlays|smokes)",
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
      "Deployment controller action (plan|deploy|update|web)",
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
    .option(
      "--skip-preflight",
      "Skip preflight account checks before terraform apply (not recommended)",
    )
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
  action: "plan" | "deploy" | "update" | "web";
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
  const terraformModuleSource = "thinkwork-ai/thinkwork/aws";
  const terraformModuleVersion =
    options.terraformModuleVersion ?? options.releaseVersion.replace(/^v/, "");
  const operationKind = options.action === "web" ? "web" : "foundation";
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
    terraformModuleSource,
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
      kind: operationKind,
      action: options.action,
      plan: options.action !== "web",
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
): "plan" | "deploy" | "update" | "web" {
  if (
    action === "plan" ||
    action === "deploy" ||
    action === "update" ||
    action === "web"
  ) {
    return action;
  }
  throw new Error(
    "--controller-action must be one of: plan, deploy, update, web",
  );
}

/**
 * Preflight signals from the stage tfvars: whether a customer domain and SES
 * are configured. Uncommented assignments only.
 */
export function readTfvarsSignals(cwd: string): {
  domain?: string;
  sesConfigured: boolean;
} {
  const tfvarsPath = join(cwd, "terraform.tfvars");
  if (!existsSync(tfvarsPath)) return { sesConfigured: false };
  let domain: string | undefined;
  let sesConfigured = false;
  for (const line of readFileSync(tfvarsPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "customer_domain" && value) domain = value;
    if (
      (key === "ses_parent_domain" ||
        key === "ses_inbound_domain" ||
        key === "cognito_email_source_arn") &&
      value
    ) {
      sesConfigured = true;
    }
  }
  return { domain, sesConfigured };
}

/**
 * Release artifact resolution for init-scaffolded layouts (U9 / KTD-7).
 *
 * Without a repo checkout there is nothing to build Lambda zips or web assets
 * from; an unpinned scaffolded deploy would resolve placeholder mode and ship
 * infrastructure with no application code. Pins a release (latest unless
 * --release-version), seeds its Lambda zips into the account state bucket,
 * and writes the artifact variables into terraform.tfvars so reruns converge
 * on the same release.
 */
export async function ensureReleaseArtifacts(
  cwd: string,
  identity: { account: string; region: string },
  stage: string,
  versionFlag?: string,
): Promise<{ version: string; webAssetSource: string | null }> {
  const tfvarsPath = join(cwd, "terraform.tfvars");
  const content = existsSync(tfvarsPath)
    ? readFileSync(tfvarsPath, "utf8")
    : "";
  const assignments: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (match) assignments[match[1]] = match[2];
  }

  // Source-checkout layouts build their own zips — nothing to resolve.
  if (assignments.lambda_zips_dir) {
    return { version: "local-zips", webAssetSource: null };
  }

  // Already pinned (rerun path): recover the version from the prefix so the
  // web-asset URL can still be resolved for the post-apply publish.
  const pinnedPrefixMatch = assignments.lambda_artifact_prefix?.match(
    /^release-artifacts\/(.+)\/lambdas$/,
  );
  const version =
    versionFlag ??
    pinnedPrefixMatch?.[1] ??
    (await fetchRecentReleases(1))[0]?.version;
  if (!version) {
    throw new Error(
      "No deployable ThinkWork release found and no lambda_zips_dir configured — " +
        "placeholder deploys are disabled. Pin one with --release-version <tag>.",
    );
  }

  const artifacts = await resolveReleaseArtifacts(version);
  if (artifacts.lambdaZips.length === 0) {
    throw new Error(
      `Release ${version} publishes no Lambda artifacts — cannot deploy application code from it.`,
    );
  }

  // Real releases ship every zip inside one bundle (harness cycle-2 ledger
  // entry): download + extract it once, then seed from the extraction root.
  let bundleRoot: string | undefined;
  const needsBundle = artifacts.lambdaZips.some((z) => !z.url);
  if (needsBundle) {
    if (!artifacts.bundle) {
      throw new Error(
        `Release ${version} has bundle-relative Lambda artifacts but no artifact bundle URL.`,
      );
    }
    console.log(`  Downloading release bundle ${artifacts.bundle.fileName}...`);
    bundleRoot = await materializeBundle(artifacts.bundle);
  }

  const { target } = ensureStateBackend(
    identity.account,
    identity.region,
    stage,
  );
  const prefix = releaseLambdaPrefix(version);
  const seeded = await seedLambdaArtifacts({
    zips: artifacts.lambdaZips,
    bucket: target.bucket,
    prefix,
    bundleRoot,
  });
  console.log(
    `  Release ${version}: ${seeded.uploaded} artifact(s) seeded, ${seeded.skipped} already present in s3://${target.bucket}/${prefix}`,
  );

  const pinned: Record<string, string> = {
    lambda_artifact_bucket: target.bucket,
    lambda_artifact_prefix: prefix,
  };
  // An existing tfvars pin wins over the manifest image — the operator may
  // have pointed the stage at a registry this machine/account can actually
  // pull (harness cycle-5: the release's ghcr image is not publicly pullable).
  if (artifacts.piImageUri && !assignments.agentcore_pi_source_image_uri) {
    pinned.agentcore_pi_source_image_uri = artifacts.piImageUri;
  }
  writeFileSync(tfvarsPath, upsertTfvarsValues(content, pinned));

  // Web asset source: a local path from the bundle, or a direct URL.
  let webAssetSource: string | null = null;
  if (artifacts.webAsset?.relativePath && bundleRoot) {
    webAssetSource = join(bundleRoot, artifacts.webAsset.relativePath);
  } else if (artifacts.webAsset?.url) {
    webAssetSource = artifacts.webAsset.url;
  }

  return { version, webAssetSource };
}

/**
 * Publish the release's prebuilt web assets to the stage's app bucket
 * (packaged installs have no web build step — CI builds ship in the release).
 */
async function publishWebAssets(
  cwd: string,
  webAssetSource: string,
): Promise<void> {
  const bucket = await terraformOutput(cwd, "app_bucket_name");
  if (!bucket) {
    throw new Error(
      "Terraform output app_bucket_name is empty — cannot publish web assets.",
    );
  }
  const tempDir = mkdtempSync(pathJoinTmp("thinkwork-web-assets-"));
  let bundle: string;
  if (/^https?:\/\//.test(webAssetSource)) {
    const response = await fetch(webAssetSource, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(
        `Could not download web assets (${response.status}) from ${webAssetSource}`,
      );
    }
    bundle = join(tempDir, "web.tar.gz");
    writeFileSync(bundle, Buffer.from(await response.arrayBuffer()));
  } else {
    if (!existsSync(webAssetSource)) {
      throw new Error(`Web asset bundle not found at ${webAssetSource}.`);
    }
    bundle = webAssetSource;
  }

  // The bundle tars the built dist contents at its root (`tar -C dist .`).
  const siteDir = join(tempDir, "site");
  mkdirSync(siteDir);
  const extract = spawnSync("tar", ["-xzf", bundle, "-C", siteDir], {
    encoding: "utf8",
  });
  if (extract.status !== 0) {
    throw new Error(`Could not extract web assets: ${extract.stderr}`);
  }
  const sync = spawnSync(
    "aws",
    [
      "s3",
      "sync",
      siteDir,
      `s3://${bucket}/`,
      "--delete",
      "--only-show-errors",
    ],
    { encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
  );
  if (sync.status !== 0) {
    throw new Error(`Web asset sync to s3://${bucket} failed.`);
  }
  printSuccess(`Web assets published to s3://${bucket}`);
}

function pathJoinTmp(prefix: string): string {
  return join(tmpdir(), prefix);
}

/**
 * Apply the bundled migration history to the stage database (U10, reworked
 * after harness cycle 7). Connects directly to the cluster endpoint — the
 * platform's clusters are publicly accessible by design (password auth;
 * db:push relies on the same posture) and the migration files need full psql
 * semantics the Data API cannot provide.
 */
async function applySchemaMigrations(
  cwd: string,
  identity: { account: string; region: string },
  stage: string,
): Promise<void> {
  const drizzleDir = findBundledDrizzle();
  if (!drizzleDir) {
    printWarning(
      "Bundled migrations not found — skipping schema application. `thinkwork verify` will fail until the schema is applied.",
    );
    return;
  }

  const endpoint = await terraformOutput(cwd, "db_cluster_endpoint");
  if (!endpoint) {
    throw new Error(
      "Terraform output db_cluster_endpoint is empty — cannot apply the schema.",
    );
  }
  const creds = spawnSync(
    "aws",
    [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      `thinkwork-${stage}-db-credentials`,
      "--region",
      identity.region,
      "--query",
      "SecretString",
      "--output",
      "text",
    ],
    { encoding: "utf8" },
  );
  if (creds.status !== 0) {
    throw new Error(
      `Could not read thinkwork-${stage}-db-credentials: ${(creds.stderr ?? "").trim().slice(0, 200)}`,
    );
  }
  const parsed = JSON.parse(creds.stdout) as {
    username?: string;
    password?: string;
  };
  if (!parsed.username || !parsed.password) {
    throw new Error(
      `Secret thinkwork-${stage}-db-credentials is missing username/password.`,
    );
  }

  console.log("\n  Applying database schema (full migration history)...");
  const summary = await applyMigrations({
    drizzleDir,
    stage,
    region: identity.region,
    connection: {
      host: endpoint,
      port: 5432,
      user: parsed.username,
      password: parsed.password,
      database: "thinkwork",
    },
    log: (line) => console.log(`    ${line}`),
  });
  console.log(
    `  Schema: ${summary.applied.length} migration(s) applied, ${summary.skipped} already present` +
      (summary.skippedFiles.length > 0
        ? `, ${summary.skippedFiles.length} operator-only file(s) skipped`
        : "") +
      ".",
  );
}

/**
 * The Bedrock model-invocation logging resources (log group + account-level
 * logging configuration) are account/region singletons — only the FIRST
 * ThinkWork stage in an account may manage them, or the second stack collides
 * on the log group and, worse, clobbers then destroys the account config on
 * teardown (harness cycle-5 ledger entry). Decide once and pin the answer in
 * terraform.tfvars so reruns never flip it (the group existing on a rerun
 * would otherwise read as "someone else owns it").
 *
 * Returns the value pinned this call, or null when tfvars already pins one.
 */
export function resolveBedrockLoggingPin(
  assignments: Record<string, string>,
  logGroupExists: boolean,
): "true" | "false" | null {
  if (assignments.manage_bedrock_invocation_logging !== undefined) return null;
  return logGroupExists ? "false" : "true";
}

function ensureBedrockLoggingPin(cwd: string, region: string): void {
  const tfvarsPath = join(cwd, "terraform.tfvars");
  if (!existsSync(tfvarsPath)) return;
  const content = readFileSync(tfvarsPath, "utf8");
  const assignments: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (match) assignments[match[1]] = match[2];
  }
  const probe = spawnSync(
    "aws",
    [
      "logs",
      "describe-log-groups",
      "--log-group-name-prefix",
      "/thinkwork/bedrock/model-invocations",
      "--region",
      region,
      "--query",
      "logGroups[?logGroupName=='/thinkwork/bedrock/model-invocations'].logGroupName",
      "--output",
      "text",
    ],
    { encoding: "utf8" },
  );
  const exists = probe.status === 0 && probe.stdout.trim().length > 0;
  const pin = resolveBedrockLoggingPin(assignments, exists);
  if (pin === null) return;
  writeFileSync(
    tfvarsPath,
    upsertTfvarsValues(content, { manage_bedrock_invocation_logging: pin }),
  );
  console.log(
    pin === "true"
      ? "  Bedrock invocation logging: this stage will manage the account-level config (pinned)."
      : "  Bedrock invocation logging: already managed by another stage in this account — skipping (pinned).",
  );
}

/** Raw string assignments from the stage tfvars (engine, etc.). */
function readTfvarsSignalsRaw(cwd: string): Record<string, string> {
  const tfvarsPath = join(cwd, "terraform.tfvars");
  if (!existsSync(tfvarsPath)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(tfvarsPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/** Bundled drizzle dir: dist/drizzle next to cli.js, or the repo checkout. */
function findBundledDrizzle(): string | null {
  const bundled = pathResolve(__dirnameForDeploy, "drizzle");
  if (existsSync(join(bundled, "meta", "_journal.json"))) return bundled;
  const repo = pathResolve(
    __dirnameForDeploy,
    "..",
    "..",
    "..",
    "packages",
    "database-pg",
    "drizzle",
  );
  if (existsSync(join(repo, "meta", "_journal.json"))) return repo;
  return null;
}

const __dirnameForDeploy = dirname(fileURLToPath(import.meta.url));

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

  // Non-interactive sessions must be explicit: silently exiting 0 with no
  // action (the historical behavior) is worse than failing.
  if (!opts.yes && !process.stdout.isTTY) {
    printError(
      `Non-interactive session: pass --yes (or -y) to deploy stage "${initialStage}", or run in a terminal to confirm interactively.`,
    );
    process.exit(1);
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

  const cwd0 = resolveTierDir(terraformDir, stage, tiers[0]);
  const scaffolded = isInitScaffoldedLayout(cwd0);

  // Region resolution (harness cycle-3 ledger entry): a profile without a
  // default region makes getAwsIdentity() report region "unknown", which
  // produced AWS calls against https://dynamodb.unknown.amazonaws.com/. The
  // stage's tfvars is authoritative; identity is a fallback only when real.
  const region =
    readTfvarsSignalsRaw(cwd0).region ||
    (identity && identity.region !== "unknown" ? identity.region : "us-east-1");
  const caller = identity ? { account: identity.account, region } : null;

  // ── Preflight (R6): report every detectable blocker before any resource is
  //    created. Warn-tier checks (SES) are reported but never block (AE3). ──
  if (!opts.skipPreflight) {
    const preflightCwd = cwd0;
    const signals = readTfvarsSignals(preflightCwd);
    const ctx: PreflightContext = {
      backend:
        caller && scaffolded
          ? backendTarget(caller.account, caller.region, stage)
          : undefined,
      domain: signals.domain,
      sesConfigured: signals.sesConfigured,
    };
    console.log("\n  Preflight checks:");
    const summary = await runChecks(preflightChecks(ctx));
    for (const { name, blocking, result } of summary.results) {
      const icon = result.pass ? "✓" : blocking ? "✗" : "!";
      console.log(`    ${icon} ${name}  ${result.detail}`);
    }
    if (!summary.passed) {
      console.log("");
      printError(
        `Preflight found ${summary.failures.length} blocker(s) — nothing was deployed. ` +
          "Fix the items above and rerun (or bypass with --skip-preflight).",
      );
      process.exit(1);
    }
    if (summary.warnings.length > 0) {
      printWarning(
        `Proceeding with ${summary.warnings.length} pending item(s) tracked as external approvals.`,
      );
    }
  } else {
    printWarning("Preflight skipped (--skip-preflight).");
  }

  // ── Release artifacts (U9): packaged installs deploy a pinned release's
  //    application code, never placeholder mode. ──
  let webAssetSource: string | null = null;
  if (scaffolded && caller) {
    // Account-singleton ownership must be decided before the first apply.
    ensureBedrockLoggingPin(cwd0, caller.region);
    const release = await ensureReleaseArtifacts(
      cwd0,
      caller,
      stage,
      opts.releaseVersion,
    );
    webAssetSource = release.webAssetSource;
  }

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    printTierHeader(tier, i, tiers.length);

    const cwd = resolveTierDir(terraformDir, stage, tier);

    // Init-scaffolded layouts get the per-account remote backend (R11).
    // The repo greenfield layout keeps its own hardcoded backend for dev CI.
    let backend: BackendTarget | undefined;
    if (caller && isInitScaffoldedLayout(cwd)) {
      const ensured = ensureStateBackend(caller.account, caller.region, stage);
      backend = ensured.target;
      if (ensured.createdBucket || ensured.createdLockTable) {
        console.log(
          `  State backend provisioned: s3://${backend.bucket} + ${backend.lockTable}`,
        );
      }
    }
    console.log(
      `  Terraform dir: ${cwd}\n  State: ${backend ? `s3://${backend.bucket}/${backend.key}` : "layout-defined backend"}`,
    );

    await ensureInit(cwd, backend);
    await ensureWorkspace(cwd, stage);

    const { code, output } = await runTerraformTee(cwd, [
      "apply",
      "-auto-approve",
      `-var=stage=${stage}`,
    ]);
    if (code !== 0) {
      const lock = parseLockError(output);
      if (lock) {
        await offerStaleLockRecovery(cwd, stage, tier, lock);
      }
      printError(`Deploy failed at the ${tier} tier (exit ${code}).`);
      console.log(
        `\n  Partial state is a normal condition — rerun to converge:\n` +
          `    thinkwork deploy -s ${stage}\n` +
          `  Every tier re-applies idempotently; completed resources are untouched.\n`,
      );
      process.exit(code);
    }
  }

  // ── Schema (U10): apply journaled migrations before anything probes the
  //    database — terraform provisions an EMPTY cluster. ──
  if (scaffolded && caller) {
    await applySchemaMigrations(cwd0, caller, stage);
  }

  // ── Web assets (U9): CI-built bundles ship in the release; publish them to
  //    the stage's app bucket (packaged installs have no web build step). ──
  if (scaffolded && webAssetSource) {
    await publishWebAssets(cwd0, webAssetSource);
  }

  // ── Workspace defaults (harness cycle-7): a fresh stack must pass the
  //    workspace-seeding probe without a separate manual bootstrap step. ──
  if (scaffolded && caller) {
    console.log("\n  Seeding workspace defaults...");
    await runWorkspaceBootstrap(cwd0, stage, caller.region);
  }

  // ── Verify (U6 / R8): a deploy ends by proving the stack works, not by
  //    terraform exiting 0. Blocking probe failures fail the deploy; pending
  //    external approvals (SES, DNS) are reported and tracked (R9/AE3). ──
  if (caller) {
    const signals = readTfvarsSignalsRaw(cwd0);
    const verification = await runStageVerification({
      stage,
      region: caller.region,
      accountId: caller.account,
      apiAuthSecret: signals.api_auth_secret,
      domain: signals.customer_domain || undefined,
      sesConfigured: Boolean(
        signals.ses_parent_domain || signals.cognito_email_source_arn,
      ),
    });
    if (!verification.passed) {
      printError(
        `Deploy applied but the stack failed verification (${verification.failures.length} probe(s)). ` +
          `Fix the items above and rerun \`thinkwork deploy -s ${stage}\` — reruns converge.`,
      );
      process.exit(1);
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

/**
 * Guided recovery for a stale Terraform state lock (AE4): show holder/age,
 * offer `force-unlock` interactively, and instruct non-TTY callers. A lock
 * whose holder process is alive on another machine must NOT be force-broken,
 * so the prompt leads with the holder details and defaults to "no".
 */
async function offerStaleLockRecovery(
  cwd: string,
  stage: string,
  tier: string,
  lock: import("../lib/state-backend.js").LockInfo,
): Promise<void> {
  console.log("");
  printWarning(
    `Terraform state for "${stage}" (${tier}) is locked — a previous run likely died mid-apply.`,
  );
  console.log(`    Lock ID:   ${lock.id ?? "unknown"}`);
  console.log(`    Held by:   ${lock.who ?? "unknown"}`);
  console.log(`    Operation: ${lock.operation ?? "unknown"}`);
  console.log(`    Created:   ${lock.created ?? "unknown"}`);

  if (!process.stdout.isTTY || !lock.id) {
    console.log(
      `\n  If that run is no longer alive, release the lock and rerun the deploy:\n` +
        `    terraform force-unlock -force ${lock.id ?? "<lock-id>"}   (inside ${cwd})\n` +
        `    thinkwork deploy -s ${stage}\n`,
    );
    return;
  }

  const release = await confirm(
    `  Is the holding run dead? Release the lock now and rerun the deploy? (verify "${lock.who ?? "unknown"}" is not still applying)`,
  );
  if (!release) return;

  const code = await runTerraform(cwd, ["force-unlock", "-force", lock.id]);
  if (code === 0) {
    printSuccess(
      `Lock released. Rerun \`thinkwork deploy -s ${stage}\` to converge.`,
    );
  } else {
    printError("force-unlock failed — see terraform output above.");
  }
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
    // npm/brew install: bundled by scripts/bundle-terraform.js next to cli.js
    pathResolve(here, "scripts", "post-deploy.sh"),
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
