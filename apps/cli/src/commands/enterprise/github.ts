import { execFileSync } from "node:child_process";

import type { BootstrapStepResult } from "./aws-bootstrap.js";

export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
}

export interface GitHubEnvironmentPlan {
  stage: string;
  roleArn: string;
  vars: Record<string, string>;
  secretPlaceholders: string[];
}

export interface EnterpriseGitHubBootstrapPlan {
  repository: GitHubRepository;
  environments: GitHubEnvironmentPlan[];
  dispatchWorkflow: boolean;
}

export interface EnterpriseGitHubBootstrapClient {
  ensureEnvironment(
    environment: GitHubEnvironmentPlan,
  ): Promise<BootstrapStepResult>;
  upsertEnvironmentVariables(
    environment: GitHubEnvironmentPlan,
  ): Promise<BootstrapStepResult>;
  writeRepositoryFiles(targetDir: string): Promise<BootstrapStepResult>;
  dispatchWorkflow(stage: string): Promise<BootstrapStepResult>;
}

export function parseGitHubRepository(input: string): GitHubRepository {
  const trimmed = input.trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid GitHub repository "${input}". Use owner/name, for example acme/thinkwork-deploy.`,
    );
  }
  return {
    owner: match[1],
    name: match[2],
    fullName: `${match[1]}/${match[2]}`,
  };
}

export function buildEnterpriseGitHubBootstrapPlan(options: {
  repository: string;
  stages: string[];
  region: string;
  artifactBucket: string;
  stageRoles: Array<{ stage: string; roleArn: string }>;
  dispatchWorkflow?: boolean;
}): EnterpriseGitHubBootstrapPlan {
  const repository = parseGitHubRepository(options.repository);
  return {
    repository,
    dispatchWorkflow: options.dispatchWorkflow ?? false,
    environments: options.stages.map((stage) => {
      const role = options.stageRoles.find((item) => item.stage === stage);
      if (!role) {
        throw new Error(`Missing deploy role for stage "${stage}".`);
      }
      return {
        stage,
        roleArn: role.roleArn,
        vars: {
          AWS_REGION: options.region,
          AWS_ROLE_ARN: role.roleArn,
          THINKWORK_ARTIFACT_BUCKET: options.artifactBucket,
        },
        secretPlaceholders: ["TF_VAR_DB_PASSWORD", "TF_VAR_API_AUTH_SECRET"],
      };
    }),
  };
}

export class GhCliEnterpriseBootstrapClient
  implements EnterpriseGitHubBootstrapClient
{
  constructor(private readonly repository: GitHubRepository) {}

  async ensureEnvironment(
    environment: GitHubEnvironmentPlan,
  ): Promise<BootstrapStepResult> {
    gh([
      "api",
      "--method",
      "PUT",
      `repos/${this.repository.fullName}/environments/${environment.stage}`,
      "--field",
      "wait_timer=0",
    ]);
    return {
      target: `${this.repository.fullName}:${environment.stage}`,
      status: "updated",
      message: `Ensured GitHub Environment ${environment.stage}.`,
    };
  }

  async upsertEnvironmentVariables(
    environment: GitHubEnvironmentPlan,
  ): Promise<BootstrapStepResult> {
    for (const [name, value] of Object.entries(environment.vars)) {
      gh([
        "variable",
        "set",
        name,
        "--repo",
        this.repository.fullName,
        "--env",
        environment.stage,
        "--body",
        value,
      ]);
    }
    return {
      target: `${this.repository.fullName}:${environment.stage}:vars`,
      status: "updated",
      message: `Updated non-secret GitHub Environment variables for ${environment.stage}.`,
    };
  }

  async writeRepositoryFiles(targetDir: string): Promise<BootstrapStepResult> {
    return {
      target: targetDir,
      status: "updated",
      message:
        "Repository files were written locally. Commit/push this directory or run from a checked-out deployment repo.",
    };
  }

  async dispatchWorkflow(stage: string): Promise<BootstrapStepResult> {
    gh([
      "workflow",
      "run",
      "deploy.yml",
      "--repo",
      this.repository.fullName,
      "--field",
      `stage=${stage}`,
    ]);
    return {
      target: `${this.repository.fullName}:deploy.yml:${stage}`,
      status: "created",
      message: `Dispatched deploy workflow for ${stage}.`,
    };
  }
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}
