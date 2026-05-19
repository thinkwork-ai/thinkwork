import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { BootstrapStepResult } from "./aws-bootstrap.js";

export interface EnterpriseRepositoryClient {
  repositoryExists(repository: string): Promise<boolean>;
  createPrivateRepository(repository: string): Promise<BootstrapStepResult>;
  cloneRepository(
    repository: string,
    targetDir: string,
  ): Promise<BootstrapStepResult>;
}

export interface EnterpriseGitClient {
  isGitRepository(targetDir: string): boolean;
  hasChanges(targetDir: string): Promise<boolean>;
  commitAll(targetDir: string, message: string): Promise<BootstrapStepResult>;
  push(targetDir: string): Promise<BootstrapStepResult>;
}

export interface EnterpriseRepositoryPrepareOptions {
  repository: string;
  targetDir: string;
  createRepo?: boolean;
  dryRun?: boolean;
}

export interface EnterpriseRepositoryPrepareResult {
  steps: BootstrapStepResult[];
  ready: boolean;
}

export class GhCliEnterpriseRepositoryClient
  implements EnterpriseRepositoryClient
{
  async repositoryExists(repository: string): Promise<boolean> {
    try {
      gh(["repo", "view", repository, "--json", "name"]);
      return true;
    } catch {
      return false;
    }
  }

  async createPrivateRepository(
    repository: string,
  ): Promise<BootstrapStepResult> {
    gh(["repo", "create", repository, "--private"]);
    return {
      target: repository,
      status: "created",
      message: `Created private GitHub repository ${repository}.`,
    };
  }

  async cloneRepository(
    repository: string,
    targetDir: string,
  ): Promise<BootstrapStepResult> {
    gh(["repo", "clone", repository, targetDir]);
    return {
      target: targetDir,
      status: "created",
      message: `Cloned ${repository} into ${targetDir}.`,
    };
  }
}

export class GitCliEnterpriseGitClient implements EnterpriseGitClient {
  isGitRepository(targetDir: string): boolean {
    return existsSync(join(targetDir, ".git"));
  }

  async hasChanges(targetDir: string): Promise<boolean> {
    return git(["-C", targetDir, "status", "--porcelain"]).trim().length > 0;
  }

  async commitAll(
    targetDir: string,
    message: string,
  ): Promise<BootstrapStepResult> {
    git(["-C", targetDir, "add", "-A"]);
    if (!(await this.hasChanges(targetDir))) {
      return {
        target: targetDir,
        status: "reused",
        message: "Deployment repository has no file changes to commit.",
      };
    }
    git(["-C", targetDir, "commit", "-m", message]);
    return {
      target: targetDir,
      status: "created",
      message: `Committed deployment repository changes: ${message}`,
    };
  }

  async push(targetDir: string): Promise<BootstrapStepResult> {
    git(["-C", targetDir, "push", "-u", "origin", "HEAD"]);
    return {
      target: targetDir,
      status: "updated",
      message: "Pushed deployment repository changes.",
    };
  }
}

export async function prepareEnterpriseRepository(
  options: EnterpriseRepositoryPrepareOptions,
  client: EnterpriseRepositoryClient,
  gitClient: EnterpriseGitClient,
): Promise<EnterpriseRepositoryPrepareResult> {
  if (options.dryRun) {
    return {
      ready: true,
      steps: [
        {
          target: options.repository,
          status: "planned",
          message: `Would prepare managed checkout at ${options.targetDir}.`,
        },
      ],
    };
  }

  if (gitClient.isGitRepository(options.targetDir)) {
    return {
      ready: true,
      steps: [
        {
          target: options.targetDir,
          status: "reused",
          message: "Reused existing deployment repository checkout.",
        },
      ],
    };
  }

  const exists = await client.repositoryExists(options.repository);
  const steps: BootstrapStepResult[] = [];
  if (!exists) {
    if (!options.createRepo) {
      throw new Error(
        `GitHub repository ${options.repository} does not exist. Pass --create-repo to create it.`,
      );
    }
    steps.push(await client.createPrivateRepository(options.repository));
  }

  steps.push(
    await client.cloneRepository(options.repository, options.targetDir),
  );
  return { ready: true, steps };
}

export async function commitAndPushEnterpriseRepository(
  targetDir: string,
  gitClient: EnterpriseGitClient,
): Promise<BootstrapStepResult[]> {
  const commit = await gitClient.commitAll(
    targetDir,
    "chore: bootstrap ThinkWork deployment repo",
  );
  if (commit.status === "reused") return [commit];

  return [commit, await gitClient.push(targetDir)];
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}
