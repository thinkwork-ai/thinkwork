import { Command } from "commander";
import { resolve } from "node:path";

import type { AwsIdentity } from "../../aws.js";
import { getAwsIdentity } from "../../aws.js";
import {
  saveEnterpriseDeployment,
  type EnterpriseDeploymentConfig,
} from "../../environments.js";
import { isProdLike } from "../../config.js";
import { confirm } from "../../prompt.js";
import {
  printError,
  printHeader,
  printSuccess,
  printWarning,
} from "../../ui.js";
import {
  renderEnterpriseDeployRepoTemplate,
  validateCustomerSlug,
  validateStages,
} from "./template.js";
import {
  AwsCliEnterpriseBootstrapClient,
  buildEnterpriseAwsBootstrapPlan,
  type BootstrapStepResult,
  type EnterpriseAwsBootstrapClient,
  type EnterpriseAwsBootstrapPlan,
} from "./aws-bootstrap.js";
import {
  buildEnterpriseGitHubBootstrapPlan,
  GhCliEnterpriseBootstrapClient,
  parseGitHubRepository,
  type EnterpriseGitHubBootstrapClient,
  type EnterpriseGitHubBootstrapPlan,
} from "./github.js";
import { resolveEnterpriseReleasePin } from "./release.js";

export interface EnterpriseBootstrapOptions {
  targetDir: string;
  customerSlug: string;
  repository: string;
  stages?: string[];
  region?: string;
  accountId?: string;
  releaseVersion?: string;
  manifestUrl?: string;
  manifestSha256?: string;
  terraformModuleVersion?: string;
  artifactBucket?: string;
  stateBucket?: string;
  lockTable?: string;
  dispatchWorkflow?: boolean;
  dryRun?: boolean;
}

export interface EnterpriseBootstrapPlan {
  customerSlug: string;
  targetDir: string;
  repository: string;
  stages: string[];
  accountId: string;
  region: string;
  release: ReturnType<typeof resolveEnterpriseReleasePin>;
  aws: EnterpriseAwsBootstrapPlan;
  github: EnterpriseGitHubBootstrapPlan;
}

export interface EnterpriseBootstrapResult {
  plan: EnterpriseBootstrapPlan;
  template: {
    written: string[];
    preserved: string[];
  };
  aws: BootstrapStepResult[];
  github: BootstrapStepResult[];
  metadata: BootstrapStepResult;
}

export interface EnterpriseBootstrapDependencies {
  identity?: AwsIdentity | null;
  awsClient?: EnterpriseAwsBootstrapClient;
  githubClient?: EnterpriseGitHubBootstrapClient;
  saveDeployment?: (config: EnterpriseDeploymentConfig) => void;
}

export function buildEnterpriseBootstrapPlan(
  options: EnterpriseBootstrapOptions,
  identity?: AwsIdentity | null,
): EnterpriseBootstrapPlan {
  const customerSlug = validateCustomerSlug(options.customerSlug);
  const repository = parseGitHubRepository(options.repository).fullName;
  const stages = validateStages(options.stages ?? ["dev", "prod"]);
  const accountId = options.accountId ?? identity?.account;
  const region = options.region ?? identity?.region;

  if (!accountId) {
    throw new Error(
      "AWS account ID is required. Configure AWS credentials or pass --account-id.",
    );
  }
  if (!region || region === "unknown") {
    throw new Error(
      "AWS region is required. Configure AWS_REGION or pass --region.",
    );
  }

  const release = resolveEnterpriseReleasePin({
    releaseVersion: options.releaseVersion,
    manifestUrl: options.manifestUrl,
    manifestSha256: options.manifestSha256,
    terraformModuleVersion: options.terraformModuleVersion,
  });
  const artifactBucket =
    options.artifactBucket ?? `${customerSlug}-thinkwork-release-artifacts`;
  const stateBucket =
    options.stateBucket ?? `${customerSlug}-thinkwork-terraform-state`;
  const lockTable =
    options.lockTable ?? `${customerSlug}-thinkwork-terraform-locks`;

  const aws = buildEnterpriseAwsBootstrapPlan({
    accountId,
    region,
    repository,
    stages,
    customerSlug,
    stateBucket,
    lockTable,
    artifactBucket,
  });
  const github = buildEnterpriseGitHubBootstrapPlan({
    repository,
    stages,
    region,
    artifactBucket,
    stageRoles: aws.stageRoles,
    dispatchWorkflow: options.dispatchWorkflow,
  });

  return {
    customerSlug,
    targetDir: resolve(options.targetDir),
    repository,
    stages,
    accountId,
    region,
    release,
    aws,
    github,
  };
}

export async function runEnterpriseBootstrap(
  options: EnterpriseBootstrapOptions,
  deps: EnterpriseBootstrapDependencies = {},
): Promise<EnterpriseBootstrapResult> {
  const identity =
    deps.identity === undefined ? getAwsIdentity() : deps.identity;
  if (!options.dryRun && !identity && (!options.accountId || !options.region)) {
    throw new Error(
      "AWS identity is required before mutating AWS or GitHub resources.",
    );
  }

  const plan = buildEnterpriseBootstrapPlan(options, identity);
  const template = renderEnterpriseDeployRepoTemplate({
    targetDir: plan.targetDir,
    customerSlug: plan.customerSlug,
    stages: plan.stages,
    region: plan.region,
    accountId: plan.accountId,
    releaseVersion: plan.release.version,
    releaseManifestUrl: plan.release.manifestUrl,
    releaseManifestSha256: plan.release.manifestSha256,
    terraformModuleVersion: plan.release.terraformModuleVersion,
    artifactBucket: plan.aws.artifactBucket,
  });

  const awsClient = deps.awsClient ?? new AwsCliEnterpriseBootstrapClient();
  const githubClient =
    deps.githubClient ??
    new GhCliEnterpriseBootstrapClient(parseGitHubRepository(plan.repository));

  const awsResults: BootstrapStepResult[] = [];
  const githubResults: BootstrapStepResult[] = [];

  if (options.dryRun) {
    awsResults.push(
      planned(plan.aws.stateBucket, "Would ensure Terraform state bucket."),
      planned(plan.aws.lockTable, "Would ensure Terraform lock table."),
      planned(plan.aws.artifactBucket, "Would ensure release artifact bucket."),
      planned(
        plan.aws.oidcProviderArn,
        "Would ensure GitHub Actions OIDC provider.",
      ),
      ...plan.aws.stageRoles.map((role) =>
        planned(role.roleArn, `Would ensure deploy role for ${role.stage}.`),
      ),
    );
    githubResults.push(
      planned(plan.targetDir, "Would write deployment repository files."),
      ...plan.github.environments.flatMap((environment) => [
        planned(
          `${plan.repository}:${environment.stage}`,
          `Would ensure GitHub Environment ${environment.stage}.`,
        ),
        planned(
          `${plan.repository}:${environment.stage}:vars`,
          `Would upsert non-secret GitHub variables for ${environment.stage}.`,
        ),
        planned(
          `${plan.repository}:${environment.stage}:secrets`,
          `Would require GitHub Environment secrets for ${environment.stage}: ${environment.secretPlaceholders.join(", ")}.`,
        ),
        ...(plan.github.dispatchWorkflow
          ? [
              planned(
                `${plan.repository}:deploy.yml:${environment.stage}`,
                `Would dispatch deploy workflow for ${environment.stage}.`,
              ),
            ]
          : []),
      ]),
    );
  } else {
    awsResults.push(
      await awsClient.ensureStateBucket(plan.aws.stateBucket, plan.region),
      await awsClient.ensureLockTable(plan.aws.lockTable, plan.region),
      await awsClient.ensureArtifactBucket(
        plan.aws.artifactBucket,
        plan.region,
      ),
      await awsClient.ensureOidcProvider(plan.accountId),
    );
    for (const role of plan.aws.stageRoles) {
      awsResults.push(await awsClient.ensureDeployRole(role));
    }

    githubResults.push(await githubClient.writeRepositoryFiles(plan.targetDir));
    for (const environment of plan.github.environments) {
      githubResults.push(
        await githubClient.ensureEnvironment(environment),
        await githubClient.upsertEnvironmentVariables(environment),
        secretPlaceholderResult(plan.repository, environment),
      );
      if (plan.github.dispatchWorkflow) {
        githubResults.push(
          await githubClient.dispatchWorkflow(environment.stage),
        );
      }
    }
  }

  const metadata = options.dryRun
    ? planned(
        plan.customerSlug,
        "Would record local enterprise deployment metadata without secrets.",
      )
    : recordDeploymentMetadata(plan, deps.saveDeployment);

  return {
    plan,
    template,
    aws: awsResults,
    github: githubResults,
    metadata,
  };
}

export function registerEnterpriseBootstrapCommand(program: Command): void {
  program
    .command("bootstrap [targetDir]")
    .description(
      "Bootstrap a customer-owned ThinkWork deployment repository and CI trust bridge.",
    )
    .option("--customer <slug>", "Customer slug, e.g. acme")
    .option("--repo <owner/name>", "Customer GitHub deployment repository")
    .option("--stage <stage...>", "Deployment stage(s)", ["dev", "prod"])
    .option("--region <region>", "AWS region")
    .option("--account-id <id>", "AWS account ID")
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
    .option(
      "--artifact-bucket <bucket>",
      "Customer-owned release artifact bucket",
    )
    .option("--state-bucket <bucket>", "Terraform state bucket")
    .option("--lock-table <table>", "Terraform state lock table")
    .option("--dispatch", "Dispatch deploy workflow after bootstrap")
    .option(
      "--dry-run",
      "Render files and print the plan without mutating AWS/GitHub",
    )
    .option("-y, --yes", "Skip confirmation for mutating bootstrap")
    .action(
      async (
        targetDir: string | undefined,
        opts: {
          customer?: string;
          repo?: string;
          stage?: string[];
          region?: string;
          accountId?: string;
          releaseVersion?: string;
          manifestUrl?: string;
          manifestSha256?: string;
          terraformModuleVersion?: string;
          artifactBucket?: string;
          stateBucket?: string;
          lockTable?: string;
          dispatch?: boolean;
          dryRun?: boolean;
          yes?: boolean;
        },
      ) => {
        try {
          const customerSlug = await resolveCustomerSlug(opts.customer);
          const repository = await resolveRepository(opts.repo);
          const identity = getAwsIdentity();
          printHeader("enterprise bootstrap", customerSlug, identity);

          if (!opts.dryRun && !opts.yes) {
            const prodStages = (opts.stage ?? ["dev", "prod"]).filter(
              isProdLike,
            );
            const message =
              prodStages.length > 0
                ? `  Bootstrap deployment authority for ${repository} including production-like stage(s): ${prodStages.join(", ")}?`
                : `  Bootstrap deployment authority for ${repository}?`;
            if (!(await confirm(message))) {
              console.log("  Aborted.");
              return;
            }
          }

          const result = await runEnterpriseBootstrap(
            {
              targetDir: targetDir ?? ".",
              customerSlug,
              repository,
              stages: opts.stage,
              region: opts.region,
              accountId: opts.accountId,
              releaseVersion: opts.releaseVersion,
              manifestUrl: opts.manifestUrl,
              manifestSha256: opts.manifestSha256,
              terraformModuleVersion: opts.terraformModuleVersion,
              artifactBucket: opts.artifactBucket,
              stateBucket: opts.stateBucket,
              lockTable: opts.lockTable,
              dispatchWorkflow: opts.dispatch,
              dryRun: opts.dryRun,
            },
            { identity },
          );

          printBootstrapSummary(result);
          printSuccess(
            opts.dryRun
              ? "Enterprise bootstrap dry-run complete"
              : "Enterprise bootstrap complete",
          );
        } catch (err) {
          printError((err as Error).message);
          process.exit(1);
        }
      },
    );
}

function planned(target: string, message: string): BootstrapStepResult {
  return { target, status: "planned", message };
}

function secretPlaceholderResult(
  repository: string,
  environment: { stage: string; secretPlaceholders: string[] },
): BootstrapStepResult {
  return {
    target: `${repository}:${environment.stage}:secrets`,
    status: "planned",
    message: `Set GitHub Environment secrets for ${environment.stage}: ${environment.secretPlaceholders.join(", ")}.`,
  };
}

function recordDeploymentMetadata(
  plan: EnterpriseBootstrapPlan,
  saveDeployment = saveEnterpriseDeployment,
): BootstrapStepResult {
  saveDeployment({
    customerSlug: plan.customerSlug,
    repository: plan.repository,
    targetDir: plan.targetDir,
    accountId: plan.accountId,
    region: plan.region,
    stages: plan.stages,
    artifactBucket: plan.aws.artifactBucket,
    stateBucket: plan.aws.stateBucket,
    lockTable: plan.aws.lockTable,
    releaseVersion: plan.release.version,
    releaseManifestUrl: plan.release.manifestUrl,
    updatedAt: new Date().toISOString(),
  });

  return {
    target: plan.customerSlug,
    status: "updated",
    message: "Recorded local enterprise deployment metadata without secrets.",
  };
}

async function resolveCustomerSlug(flag: string | undefined): Promise<string> {
  if (flag) return flag;
  if (!process.stdin.isTTY) {
    throw new Error("Customer slug is required. Pass --customer <slug>.");
  }
  const { input } = await import("@inquirer/prompts");
  return input({ message: "Customer slug:" });
}

async function resolveRepository(flag: string | undefined): Promise<string> {
  if (flag) return flag;
  if (!process.stdin.isTTY) {
    throw new Error("GitHub repository is required. Pass --repo <owner/name>.");
  }
  const { input } = await import("@inquirer/prompts");
  return input({ message: "GitHub deployment repo (owner/name):" });
}

function printBootstrapSummary(result: EnterpriseBootstrapResult): void {
  console.log("");
  console.log("  AWS");
  for (const step of result.aws) {
    console.log(`  - ${step.status}: ${step.message}`);
  }
  console.log("  GitHub");
  for (const step of result.github) {
    console.log(`  - ${step.status}: ${step.message}`);
  }
  if (result.template.preserved.length > 0) {
    printWarning(
      `Preserved ${result.template.preserved.length} customer-owned file(s) without the ThinkWork managed marker.`,
    );
  }
}
