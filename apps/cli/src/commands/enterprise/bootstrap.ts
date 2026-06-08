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
import {
  buildEnterpriseAwsDeploymentControlPlanePlan,
  TerraformEnterpriseAwsDeploymentControlPlaneClient,
  type EnterpriseAwsDeploymentControlPlaneClient,
  type EnterpriseAwsDeploymentControlPlanePlan,
} from "./aws-deployments.js";
import {
  buildEnterpriseIdentityProviderPlan,
  parseIdentityProviderType,
  type EnterpriseIdentityProviderInput,
  type EnterpriseIdentityProviderPlan,
} from "./identity-provider.js";
import { resolveEnterpriseReleasePin } from "./release.js";

export interface EnterpriseBootstrapOptions {
  targetDir: string;
  customerSlug: string;
  repository?: string;
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
  identityProvider?: EnterpriseIdentityProviderInput;
  dispatchWorkflow?: boolean;
  dryRun?: boolean;
}

export interface EnterpriseBootstrapPlan {
  customerSlug: string;
  targetDir: string;
  repository?: string;
  stages: string[];
  accountId: string;
  region: string;
  release: ReturnType<typeof resolveEnterpriseReleasePin>;
  identityProvider?: EnterpriseIdentityProviderPlan;
  aws: EnterpriseAwsBootstrapPlan;
  deploymentControlPlanes: EnterpriseAwsDeploymentControlPlanePlan[];
  github?: EnterpriseGitHubBootstrapPlan;
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
  deploymentControlPlaneClient?: EnterpriseAwsDeploymentControlPlaneClient;
  githubClient?: EnterpriseGitHubBootstrapClient;
  saveDeployment?: (config: EnterpriseDeploymentConfig) => void;
}

export function buildEnterpriseBootstrapPlan(
  options: EnterpriseBootstrapOptions,
  identity?: AwsIdentity | null,
): EnterpriseBootstrapPlan {
  const customerSlug = validateCustomerSlug(options.customerSlug);
  const repository = options.repository
    ? parseGitHubRepository(options.repository).fullName
    : undefined;
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
  const identityProvider = buildEnterpriseIdentityProviderPlan(
    options.identityProvider,
  );

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
  const deploymentControlPlanes = buildEnterpriseAwsDeploymentControlPlanePlan({
    customerSlug,
    accountId,
    region,
    stages,
    release,
  });
  const github = repository
    ? buildEnterpriseGitHubBootstrapPlan({
        repository,
        stages,
        region,
        artifactBucket,
        stageRoles: aws.stageRoles,
        dispatchWorkflow: options.dispatchWorkflow,
      })
    : undefined;

  return {
    customerSlug,
    targetDir: resolve(options.targetDir),
    repository,
    stages,
    accountId,
    region,
    release,
    identityProvider,
    aws,
    deploymentControlPlanes,
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
  if (!options.dryRun && !plan.release.manifestSha256) {
    throw new Error(
      "Release manifest SHA-256 is required before mutating bootstrap. Pass --manifest-sha256 or use `thinkwork enterprise deploy --bootstrap` so the CLI fetches the manifest digest.",
    );
  }
  const template = plan.repository
    ? renderEnterpriseDeployRepoTemplate({
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
      })
    : { written: [], preserved: [] };

  const awsClient = deps.awsClient ?? new AwsCliEnterpriseBootstrapClient();
  const deploymentControlPlaneClient =
    deps.deploymentControlPlaneClient ??
    new TerraformEnterpriseAwsDeploymentControlPlaneClient();
  const githubClient =
    plan.repository && plan.github
      ? (deps.githubClient ??
        new GhCliEnterpriseBootstrapClient(
          parseGitHubRepository(plan.repository),
        ))
      : undefined;

  const awsResults: BootstrapStepResult[] = [];
  const githubResults: BootstrapStepResult[] = [];

  if (options.dryRun) {
    awsResults.push(
      planned(plan.aws.stateBucket, "Would ensure Terraform state bucket."),
      planned(plan.aws.lockTable, "Would ensure Terraform lock table."),
      planned(plan.aws.artifactBucket, "Would ensure release artifact bucket."),
      ...(plan.identityProvider
        ? [
            planned(
              `${plan.customerSlug}:identity-provider:${plan.identityProvider.providerName}`,
              `Would configure ${plan.identityProvider.type.toUpperCase()} identity provider metadata and store required secrets in Secrets Manager.`,
            ),
          ]
        : []),
      ...plan.deploymentControlPlanes.flatMap((controlPlane) => [
        planned(
          controlPlane.evidenceBucket,
          `Would ensure deployment evidence bucket for ${controlPlane.stage}.`,
        ),
        planned(
          controlPlane.stateMachineName,
          `Would ensure deployment orchestrator state machine for ${controlPlane.stage}.`,
        ),
        planned(
          controlPlane.codeBuildProjectName,
          `Would ensure inert deployment runner project for ${controlPlane.stage}.`,
        ),
        planned(
          controlPlane.ssmPrefix,
          `Would write deployment SSM/AppConfig profile pointers for ${controlPlane.stage}.`,
        ),
      ]),
      ...(plan.aws.oidcProviderArn
        ? [
            planned(
              plan.aws.oidcProviderArn,
              "Would ensure GitHub Actions OIDC provider.",
            ),
          ]
        : []),
      ...plan.aws.stageRoles.map((role) =>
        planned(role.roleArn, `Would ensure deploy role for ${role.stage}.`),
      ),
    );
    if (plan.repository && plan.github) {
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
          ...(plan.github?.dispatchWorkflow
            ? [
                planned(
                  `${plan.repository}:deploy.yml:${environment.stage}`,
                  `Would dispatch deploy workflow for ${environment.stage}.`,
                ),
              ]
            : []),
        ]),
      );
    }
  } else {
    awsResults.push(
      await awsClient.ensureStateBucket(plan.aws.stateBucket, plan.region),
      await awsClient.ensureLockTable(plan.aws.lockTable, plan.region),
      await awsClient.ensureArtifactBucket(
        plan.aws.artifactBucket,
        plan.region,
      ),
    );
    for (const controlPlane of plan.deploymentControlPlanes) {
      awsResults.push(
        await deploymentControlPlaneClient.ensureDeploymentControlPlane(
          controlPlane,
          {
            accountId: plan.accountId,
            region: plan.region,
            release: plan.release,
            stateBucket: plan.aws.stateBucket,
            lockTable: plan.aws.lockTable,
          },
        ),
      );
    }
    if (plan.aws.oidcProviderArn) {
      awsResults.push(await awsClient.ensureOidcProvider(plan.accountId));
    }
    for (const role of plan.aws.stageRoles) {
      awsResults.push(await awsClient.ensureDeployRole(role));
    }

    if (plan.repository && plan.github && githubClient) {
      githubResults.push(
        await githubClient.writeRepositoryFiles(plan.targetDir),
      );
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
      "Bootstrap a customer-owned ThinkWork deployment control plane.",
    )
    .option("--customer <slug>", "Customer slug, e.g. acme")
    .option(
      "--repo <owner/name>",
      "Optional legacy customer GitHub deployment repository",
    )
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
    .option(
      "--identity-provider <type>",
      "Identity provider type: google, oidc, saml, or none",
    )
    .option("--idp-provider-name <name>", "OIDC/SAML provider name")
    .option("--idp-client-id <id>", "OIDC/Google client ID")
    .option("--idp-client-secret <secret>", "OIDC/Google client secret")
    .option("--idp-issuer-url <url>", "OIDC issuer URL")
    .option("--idp-discovery-url <url>", "OIDC discovery document URL")
    .option("--idp-authorize-url <url>", "OIDC authorization endpoint URL")
    .option("--idp-token-url <url>", "OIDC token endpoint URL")
    .option("--idp-user-info-url <url>", "OIDC user-info endpoint URL")
    .option("--idp-jwks-url <url>", "OIDC JWKS endpoint URL")
    .option("--idp-scopes <scopes>", "Comma-separated OIDC scopes")
    .option("--idp-metadata-url <url>", "SAML metadata URL")
    .option("--idp-metadata-xml <xml>", "SAML metadata XML")
    .option("--idp-entity-id <id>", "Expected SAML entityID")
    .option(
      "--idp-identifiers <values>",
      "Comma-separated SAML IdP identifiers or email domains",
    )
    .option("--idp-email-attribute <name>", "IdP email attribute mapping")
    .option("--idp-name-attribute <name>", "IdP name attribute mapping")
    .option("--idp-username-attribute <name>", "IdP username attribute mapping")
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
          identityProvider?: string;
          idpProviderName?: string;
          idpClientId?: string;
          idpClientSecret?: string;
          idpIssuerUrl?: string;
          idpDiscoveryUrl?: string;
          idpAuthorizeUrl?: string;
          idpTokenUrl?: string;
          idpUserInfoUrl?: string;
          idpJwksUrl?: string;
          idpScopes?: string;
          idpMetadataUrl?: string;
          idpMetadataXml?: string;
          idpEntityId?: string;
          idpIdentifiers?: string;
          idpEmailAttribute?: string;
          idpNameAttribute?: string;
          idpUsernameAttribute?: string;
          dispatch?: boolean;
          dryRun?: boolean;
          yes?: boolean;
        },
      ) => {
        try {
          const customerSlug = await resolveCustomerSlug(opts.customer);
          const repository = resolveRepository(opts.repo);
          const identity = getAwsIdentity();
          printHeader("enterprise bootstrap", customerSlug, identity);

          if (!opts.dryRun && !opts.yes) {
            const prodStages = (opts.stage ?? ["dev", "prod"]).filter(
              isProdLike,
            );
            const message =
              prodStages.length > 0
                ? `  Bootstrap AWS deployment authority including production-like stage(s): ${prodStages.join(", ")}?`
                : "  Bootstrap AWS deployment authority?";
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
              identityProvider: resolveIdentityProviderOptions(opts),
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
    checkoutDir: plan.targetDir,
    defaultStage: plan.stages[0],
    accountId: plan.accountId,
    region: plan.region,
    stages: plan.stages,
    artifactBucket: plan.aws.artifactBucket,
    stateBucket: plan.aws.stateBucket,
    lockTable: plan.aws.lockTable,
    releaseVersion: plan.release.version,
    releaseManifestUrl: plan.release.manifestUrl,
    deploymentMode: plan.repository ? "github" : "aws",
    identityProvider: plan.identityProvider,
    controlPlanes: plan.deploymentControlPlanes,
    updatedAt: new Date().toISOString(),
  });

  return {
    target: plan.customerSlug,
    status: "updated",
    message: "Recorded local enterprise deployment metadata without secrets.",
  };
}

function resolveIdentityProviderOptions(opts: {
  identityProvider?: string;
  idpProviderName?: string;
  idpClientId?: string;
  idpClientSecret?: string;
  idpIssuerUrl?: string;
  idpDiscoveryUrl?: string;
  idpAuthorizeUrl?: string;
  idpTokenUrl?: string;
  idpUserInfoUrl?: string;
  idpJwksUrl?: string;
  idpScopes?: string;
  idpMetadataUrl?: string;
  idpMetadataXml?: string;
  idpEntityId?: string;
  idpIdentifiers?: string;
  idpEmailAttribute?: string;
  idpNameAttribute?: string;
  idpUsernameAttribute?: string;
}): EnterpriseIdentityProviderInput | undefined {
  const type = parseIdentityProviderType(opts.identityProvider);
  if (!type) return undefined;
  return {
    type,
    providerName: opts.idpProviderName,
    clientId: opts.idpClientId,
    clientSecret: opts.idpClientSecret,
    issuerUrl: opts.idpIssuerUrl,
    discoveryUrl: opts.idpDiscoveryUrl,
    authorizeUrl: opts.idpAuthorizeUrl,
    tokenUrl: opts.idpTokenUrl,
    userInfoUrl: opts.idpUserInfoUrl,
    jwksUrl: opts.idpJwksUrl,
    scopes: parseCsv(opts.idpScopes),
    metadataUrl: opts.idpMetadataUrl,
    metadataXml: opts.idpMetadataXml,
    entityId: opts.idpEntityId,
    idpIdentifiers: parseCsv(opts.idpIdentifiers),
    emailAttribute: opts.idpEmailAttribute,
    nameAttribute: opts.idpNameAttribute,
    usernameAttribute: opts.idpUsernameAttribute,
  };
}

function parseCsv(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

async function resolveCustomerSlug(flag: string | undefined): Promise<string> {
  if (flag) return flag;
  if (!process.stdin.isTTY) {
    throw new Error("Customer slug is required. Pass --customer <slug>.");
  }
  const { input } = await import("@inquirer/prompts");
  return input({ message: "Customer slug:" });
}

function resolveRepository(flag: string | undefined): string | undefined {
  return flag;
}

function printBootstrapSummary(result: EnterpriseBootstrapResult): void {
  console.log("");
  console.log("  AWS");
  for (const step of result.aws) {
    console.log(`  - ${step.status}: ${step.message}`);
  }
  console.log("  GitHub");
  if (result.github.length === 0) {
    console.log("  - planned: No GitHub repository configured.");
  } else {
    for (const step of result.github) {
      console.log(`  - ${step.status}: ${step.message}`);
    }
  }
  if (result.template.preserved.length > 0) {
    printWarning(
      `Preserved ${result.template.preserved.length} customer-owned file(s) without the ThinkWork managed marker.`,
    );
  }
}
