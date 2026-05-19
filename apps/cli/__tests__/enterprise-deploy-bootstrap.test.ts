import { describe, expect, it, vi } from "vitest";

import { runEnterpriseDeploy } from "../src/commands/enterprise/deploy.js";
import type { EnterpriseBootstrapResult } from "../src/commands/enterprise/bootstrap.js";

function bootstrapResult(): EnterpriseBootstrapResult {
  return {
    plan: {} as EnterpriseBootstrapResult["plan"],
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
    const dispatchWorkflow = vi.fn(async () => ({
      target: "acme/deploy:deploy.yml:dev",
      status: "created" as const,
      message: "dispatched",
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
        dispatchWorkflow,
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
    expect(dispatchWorkflow).toHaveBeenCalledWith("acme/deploy", "dev");
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
