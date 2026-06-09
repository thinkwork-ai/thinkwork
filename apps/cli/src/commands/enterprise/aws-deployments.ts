import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { BootstrapStepResult } from "./aws-bootstrap.js";
import type { EnterpriseReleasePin } from "./release.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface EnterpriseAwsDeploymentControlPlanePlan {
  stage: string;
  stateMachineName: string;
  codeBuildProjectName: string;
  evidenceBucket: string;
  stateBucket: string;
  lockTable: string;
  artifactBucket: string;
  ssmPrefix: string;
  appConfigApplicationName: string;
  appConfigEnvironmentName: string;
  appConfigConfigurationProfileName: string;
  secretNames: {
    idpClientSecret: string;
    runnerEnvironment: string;
  };
  profile: EnterpriseDeploymentProfilePlan;
}

export interface EnterpriseDeploymentProfilePlan {
  displayName: string;
  stage: string;
  accountId: string;
  region: string;
  releaseVersion: string;
  apiEndpointParameter: string;
  appUrlParameter: string;
  cognitoUserPoolIdParameter: string;
  cognitoClientIdParameter: string;
}

export interface EnterpriseAwsDeploymentControlPlaneApplyOptions {
  accountId: string;
  region: string;
  release: EnterpriseReleasePin;
  stateBucket: string;
  lockTable: string;
  artifactBucket: string;
}

export interface EnterpriseAwsDeploymentControlPlaneClient {
  ensureDeploymentControlPlane(
    controlPlane: EnterpriseAwsDeploymentControlPlanePlan,
    options: EnterpriseAwsDeploymentControlPlaneApplyOptions,
  ): Promise<BootstrapStepResult>;
}

export function buildEnterpriseAwsDeploymentControlPlanePlan(options: {
  customerSlug: string;
  accountId: string;
  region: string;
  stages: string[];
  release: EnterpriseReleasePin;
  stateBucket: string;
  lockTable: string;
  artifactBucket: string;
}): EnterpriseAwsDeploymentControlPlanePlan[] {
  return options.stages.map((stage) => {
    const prefix = `thinkwork-${stage}-deployment`;
    const ssmPrefix = `/thinkwork/${stage}/deployment`;
    return {
      stage,
      stateMachineName: `${prefix}-orchestrator`,
      codeBuildProjectName: `${prefix}-runner`,
      evidenceBucket: `thinkwork-${stage}-${options.accountId}-deploy-evidence`,
      stateBucket: options.stateBucket,
      lockTable: options.lockTable,
      artifactBucket: options.artifactBucket,
      ssmPrefix,
      appConfigApplicationName: prefix,
      appConfigEnvironmentName: stage,
      appConfigConfigurationProfileName: "deployment-config",
      secretNames: {
        idpClientSecret: `${ssmPrefix}/idp-client-secret`,
        runnerEnvironment: `${ssmPrefix}/runner-secrets`,
      },
      profile: {
        displayName: `${options.customerSlug} ${stage}`,
        stage,
        accountId: options.accountId,
        region: options.region,
        releaseVersion: options.release.version,
        apiEndpointParameter: `${ssmPrefix}/profile/api-endpoint`,
        appUrlParameter: `${ssmPrefix}/profile/app-url`,
        cognitoUserPoolIdParameter: `${ssmPrefix}/profile/cognito-user-pool-id`,
        cognitoClientIdParameter: `${ssmPrefix}/profile/cognito-client-id`,
      },
    };
  });
}

export class TerraformEnterpriseAwsDeploymentControlPlaneClient implements EnterpriseAwsDeploymentControlPlaneClient {
  async ensureDeploymentControlPlane(
    controlPlane: EnterpriseAwsDeploymentControlPlanePlan,
    options: EnterpriseAwsDeploymentControlPlaneApplyOptions,
  ): Promise<BootstrapStepResult> {
    const workDir = mkdtempSync(
      join(tmpdir(), `thinkwork-${controlPlane.stage}-deployment-control-`),
    );

    try {
      writeFileSync(
        join(workDir, "main.tf"),
        renderControlPlaneMainTf(controlPlane, options),
      );
      writeFileSync(
        join(workDir, "backend.hcl"),
        renderControlPlaneBackendHcl(controlPlane, options),
      );

      execFileSync(
        "terraform",
        ["init", "-backend-config=backend.hcl", "-no-color"],
        {
          cwd: workDir,
          stdio: "inherit",
        },
      );

      const plan = spawnSync(
        "terraform",
        ["plan", "-detailed-exitcode", "-out=tfplan", "-no-color"],
        {
          cwd: workDir,
          stdio: "inherit",
        },
      );
      if (plan.status === 0) {
        return {
          target: controlPlane.stateMachineName,
          status: "reused",
          message: `Deployment control plane ${controlPlane.stateMachineName} is up to date.`,
        };
      }
      if (plan.status !== 2) {
        throw new Error(
          `Terraform plan failed for deployment control plane ${controlPlane.stateMachineName}.`,
        );
      }

      execFileSync(
        "terraform",
        ["apply", "-auto-approve", "-no-color", "tfplan"],
        {
          cwd: workDir,
          stdio: "inherit",
        },
      );
      return {
        target: controlPlane.stateMachineName,
        status: "updated",
        message: `Applied deployment control plane ${controlPlane.stateMachineName}.`,
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

function renderControlPlaneMainTf(
  controlPlane: EnterpriseAwsDeploymentControlPlanePlan,
  options: EnterpriseAwsDeploymentControlPlaneApplyOptions,
): string {
  return `terraform {
  required_version = ">= 1.5.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = ${hclString(options.region)}
}

module "deployment_control_plane" {
  source = ${hclString(findDeploymentControlPlaneModule())}

  stage      = ${hclString(controlPlane.stage)}
  account_id = ${hclString(options.accountId)}
  region     = ${hclString(options.region)}

  release_version         = ${hclString(options.release.version)}
  release_manifest_url    = ${hclString(options.release.manifestUrl)}
  release_manifest_sha256 = ${hclString(options.release.manifestSha256 ?? "")}

  terraform_state_bucket  = ${hclString(options.stateBucket)}
  terraform_lock_table    = ${hclString(options.lockTable)}
  release_artifact_bucket = ${hclString(options.artifactBucket)}

  terraform_module_version = ${hclString(options.release.terraformModuleVersion)}
}
`;
}

function renderControlPlaneBackendHcl(
  controlPlane: EnterpriseAwsDeploymentControlPlanePlan,
  options: EnterpriseAwsDeploymentControlPlaneApplyOptions,
): string {
  return `bucket         = ${hclString(options.stateBucket)}
key            = ${hclString(`deployment-control-plane/${controlPlane.stage}.tfstate`)}
region         = ${hclString(options.region)}
dynamodb_table = ${hclString(options.lockTable)}
encrypt        = true
`;
}

function findDeploymentControlPlaneModule(): string {
  const candidates = [
    resolve(__dirname, "terraform"),
    resolve(__dirname, "..", "..", "terraform"),
    resolve(__dirname, "..", "..", "..", "..", "..", "terraform"),
    resolve(process.cwd(), "terraform"),
  ];

  for (const candidate of candidates) {
    const modulePath = join(candidate, "modules/app/deployment-control-plane");
    if (existsSync(join(modulePath, "main.tf"))) return modulePath;
  }

  throw new Error(
    "Deployment control-plane Terraform module not found. The CLI package may be incomplete.",
  );
}

function hclString(value: string): string {
  return JSON.stringify(value);
}
