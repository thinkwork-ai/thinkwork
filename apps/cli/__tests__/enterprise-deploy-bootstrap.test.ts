import { describe, expect, it, vi } from "vitest";

import { runEnterpriseDeploy } from "../src/commands/enterprise/deploy.js";
import type { EnterpriseBootstrapResult } from "../src/commands/enterprise/bootstrap.js";

function bootstrapResult(): EnterpriseBootstrapResult {
  return {
    plan: {
      customerSlug: "acme",
      targetDir: "/tmp/deploy",
      repository: "acme/deploy",
      stages: ["dev", "prod"],
      accountId: "123456789012",
      region: "us-east-1",
      release: {
        version: "v1.2.3",
        manifestUrl: "https://example.test/manifest.json",
        manifestSha256: "abc123",
        terraformModuleVersion: "1.2.3",
      },
      aws: {
        artifactBucket: "acme-thinkwork-release-artifacts",
        stateBucket: "acme-thinkwork-terraform-state",
        lockTable: "acme-thinkwork-terraform-locks",
        oidcProviderArn:
          "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com",
        stageRoles: [],
      },
      github: {} as EnterpriseBootstrapResult["plan"]["github"],
    },
    template: { written: ["thinkwork.lock"], preserved: [] },
    aws: [],
    github: [],
    metadata: {
      target: "acme",
      status: "updated",
      message: "Recorded local enterprise deployment metadata without secrets.",
    },
  };
}

describe("one-shot enterprise deploy bootstrap", () => {
  it("prepares repo, computes manifest checksum, bootstraps, sets secrets, commits, pushes, and dispatches", async () => {
    const runBootstrap = vi.fn(async () => bootstrapResult());
    const setEnvironmentSecret = vi.fn(async () => undefined);
    const commitAll = vi.fn(async () => ({
      target: "/tmp/deploy",
      status: "created" as const,
      message: "committed",
    }));
    const push = vi.fn(async () => ({
      target: "/tmp/deploy",
      status: "updated" as const,
      message: "pushed",
    }));
    const dispatchDeployWorkflow = vi.fn(async () => ({
      target: "acme/deploy:deploy.yml:dev",
      status: "created" as const,
      message: "dispatched",
    }));
    const latestDeployRun = vi.fn(async () => ({
      id: "123",
      url: "https://github.com/acme/deploy/actions/runs/123",
      status: "in_progress",
      failedJobs: [],
    }));
    const getRun = vi.fn(async () => ({
      id: "123",
      url: "https://github.com/acme/deploy/actions/runs/123",
      status: "completed",
      conclusion: "success",
      failedJobs: [],
    }));

    const result = await runEnterpriseDeploy(
      {
        bootstrap: true,
        customer: "acme",
        repo: "acme/deploy",
        checkoutDir: "/tmp/deploy",
        createRepo: true,
        stage: "dev",
        component: "all",
        releaseVersion: "v1.2.3",
        dbPassword: "prod-db",
        apiAuthSecret: "prod-api",
        yes: true,
      },
      {
        stdinIsTty: false,
        repositoryClient: {
          repositoryExists: vi.fn(async () => false),
          createPrivateRepository: vi.fn(async () => ({
            target: "acme/deploy",
            status: "created",
            message: "created",
          })),
          cloneRepository: vi.fn(async () => ({
            target: "/tmp/deploy",
            status: "created",
            message: "cloned",
          })),
        },
        gitClient: {
          isGitRepository: vi.fn(() => false),
          hasChanges: vi.fn(async () => true),
          commitAll,
          push,
        },
        secretSetter: { setEnvironmentSecret },
        workflowClient: {
          dispatchDeployWorkflow,
          latestDeployRun,
          getRun,
          listRunArtifacts: vi.fn(async () => ["thinkwork-deploy-dev-123"]),
        },
        discoverUrls: vi.fn(() => ({
          apiEndpoint: "https://api.example.test",
          adminUrl: "https://admin.example.test",
        })),
        sleep: vi.fn(async () => undefined),
        fetchManifest: vi.fn(async () =>
          Buffer.from("release-manifest").buffer.slice(0),
        ),
        runBootstrap,
      },
    );

    expect(result.kind).toBe("bootstrap");
    expect(runBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        stages: ["dev", "prod"],
        manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        dispatchWorkflow: false,
      }),
    );
    expect(setEnvironmentSecret).toHaveBeenCalledTimes(4);
    expect(commitAll).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledOnce();
    expect(dispatchDeployWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: "acme/deploy",
        stage: "dev",
        component: "all",
        runSmokes: true,
      }),
    );
    expect(latestDeployRun).toHaveBeenCalled();
    expect(getRun).toHaveBeenCalledWith("acme/deploy", "123");
    expect(result.workflow.run?.url).toBe(
      "https://github.com/acme/deploy/actions/runs/123",
    );
    expect(result.workflow.artifacts).toEqual(["thinkwork-deploy-dev-123"]);
    expect(result.workflow.urls.adminUrl).toBe("https://admin.example.test");
    expect(JSON.stringify(result)).not.toContain("prod-db");
    expect(JSON.stringify(result)).not.toContain("prod-api");
  });

  it("plans dry-run bootstrap without mutating repo, secrets, git, or workflow", async () => {
    const runBootstrap = vi.fn(async () => bootstrapResult());
    const result = await runEnterpriseDeploy(
      {
        bootstrap: true,
        customer: "acme",
        repo: "acme/deploy",
        checkoutDir: "/tmp/deploy",
        stage: "dev",
        component: "all",
        dryRun: true,
        yes: true,
      },
      {
        stdinIsTty: false,
        runBootstrap,
      },
    );

    expect(result.kind).toBe("bootstrap");
    expect(result.repository[0].status).toBe("planned");
    expect(result.secrets.map((step) => step.status)).toEqual([
      "planned",
      "planned",
    ]);
    expect(result.git[0].status).toBe("planned");
    expect(result.dispatch[0].status).toBe("planned");
    expect(runBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("fails before repo/AWS/GitHub mutation when the release manifest cannot be fetched", async () => {
    const repositoryExists = vi.fn(async () => true);
    const runBootstrap = vi.fn(async () => bootstrapResult());

    await expect(
      runEnterpriseDeploy(
        {
          bootstrap: true,
          customer: "acme",
          repo: "acme/deploy",
          checkoutDir: "/tmp/deploy",
          stage: "dev",
          component: "all",
          releaseVersion: "v1.2.3",
          dbPassword: "prod-db",
          apiAuthSecret: "prod-api",
          yes: true,
        },
        {
          stdinIsTty: false,
          repositoryClient: {
            repositoryExists,
            createPrivateRepository: vi.fn(),
            cloneRepository: vi.fn(),
          },
          gitClient: {
            isGitRepository: vi.fn(() => false),
            hasChanges: vi.fn(async () => false),
            commitAll: vi.fn(),
            push: vi.fn(),
          },
          fetchManifest: vi.fn(async () => {
            throw new Error("manifest unavailable");
          }),
          runBootstrap,
        },
      ),
    ).rejects.toThrow(/manifest unavailable/);

    expect(repositoryExists).not.toHaveBeenCalled();
    expect(runBootstrap).not.toHaveBeenCalled();
  });
});
