import { describe, expect, it, vi } from "vitest";

import {
  commitAndPushEnterpriseRepository,
  prepareEnterpriseRepository,
  type EnterpriseGitClient,
  type EnterpriseRepositoryClient,
} from "../src/commands/enterprise/repository.js";

function repoClient(exists: boolean): EnterpriseRepositoryClient {
  return {
    repositoryExists: vi.fn(async () => exists),
    createPrivateRepository: vi.fn(async (repository) => ({
      target: repository,
      status: "created",
      message: "created",
    })),
    cloneRepository: vi.fn(async (_repository, targetDir) => ({
      target: targetDir,
      status: "created",
      message: "cloned",
    })),
  };
}

function gitClient(isRepo: boolean, hasChanges = true): EnterpriseGitClient {
  return {
    isGitRepository: vi.fn(() => isRepo),
    hasChanges: vi.fn(async () => hasChanges),
    commitAll: vi.fn(async (targetDir) => ({
      target: targetDir,
      status: hasChanges ? "created" : "reused",
      message: hasChanges ? "committed" : "no changes",
    })),
    push: vi.fn(async (targetDir) => ({
      target: targetDir,
      status: "updated",
      message: "pushed",
    })),
  };
}

describe("enterprise deployment repository lifecycle", () => {
  it("reuses an existing checkout without creating or cloning", async () => {
    const repos = repoClient(false);
    const git = gitClient(true);

    const result = await prepareEnterpriseRepository(
      {
        repository: "acme/deploy",
        targetDir: "/tmp/deploy",
      },
      repos,
      git,
    );

    expect(result.steps[0].status).toBe("reused");
    expect(repos.repositoryExists).not.toHaveBeenCalled();
    expect(repos.createPrivateRepository).not.toHaveBeenCalled();
    expect(repos.cloneRepository).not.toHaveBeenCalled();
  });

  it("creates a missing private repo when --create-repo is selected, then clones it", async () => {
    const repos = repoClient(false);
    const git = gitClient(false);

    const result = await prepareEnterpriseRepository(
      {
        repository: "acme/deploy",
        targetDir: "/tmp/deploy",
        createRepo: true,
      },
      repos,
      git,
    );

    expect(result.steps.map((step) => step.status)).toEqual([
      "created",
      "created",
    ]);
    expect(repos.createPrivateRepository).toHaveBeenCalledWith("acme/deploy");
    expect(repos.cloneRepository).toHaveBeenCalledWith(
      "acme/deploy",
      "/tmp/deploy",
    );
  });

  it("fails before mutation when the repo is missing and creation was not requested", async () => {
    await expect(
      prepareEnterpriseRepository(
        { repository: "acme/deploy", targetDir: "/tmp/deploy" },
        repoClient(false),
        gitClient(false),
      ),
    ).rejects.toThrow(/Pass --create-repo/);
  });

  it("skips empty commits and pushes only when files changed", async () => {
    const changed = gitClient(true, true);
    await expect(
      commitAndPushEnterpriseRepository("/tmp/deploy", changed),
    ).resolves.toHaveLength(2);
    expect(changed.push).toHaveBeenCalledOnce();

    const unchanged = gitClient(true, false);
    await expect(
      commitAndPushEnterpriseRepository("/tmp/deploy", unchanged),
    ).resolves.toHaveLength(1);
    expect(unchanged.push).not.toHaveBeenCalled();
  });
});
