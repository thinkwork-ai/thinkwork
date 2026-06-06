import { describe, expect, it, vi } from "vitest";

import {
  buildEnterpriseBootstrapPlan,
  runEnterpriseBootstrap,
} from "../src/commands/enterprise/bootstrap.js";

const identity = {
  account: "111122223333",
  region: "us-west-2",
  arn: "arn:aws:sts::111122223333:assumed-role/Admin/session",
};

describe("GitHub-free enterprise bootstrap", () => {
  it("plans AWS control-plane resources without a GitHub repository", async () => {
    const result = await runEnterpriseBootstrap(
      {
        targetDir: "/tmp/unused",
        customerSlug: "acme",
        stages: ["dev"],
        releaseVersion: "v1.2.3",
        manifestSha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        dryRun: true,
      },
      { identity, saveDeployment: vi.fn() },
    );

    expect(result.plan.repository).toBeUndefined();
    expect(result.plan.github).toBeUndefined();
    expect(result.template.written).toEqual([]);
    expect(result.github).toEqual([]);
    expect(result.plan.deploymentControlPlanes[0]).toMatchObject({
      stage: "dev",
      stateMachineName: "thinkwork-dev-deployment-orchestrator",
      codeBuildProjectName: "thinkwork-dev-deployment-runner",
      evidenceBucket: "thinkwork-dev-111122223333-deploy-evidence",
      ssmPrefix: "/thinkwork/dev/deployment",
      appConfigApplicationName: "thinkwork-dev-deployment",
      appConfigConfigurationProfileName: "deployment-config",
    });
    expect(result.plan.deploymentControlPlanes[0]?.profile).toMatchObject({
      displayName: "acme dev",
      accountId: "111122223333",
      region: "us-west-2",
      releaseVersion: "v1.2.3",
      apiEndpointParameter: "/thinkwork/dev/deployment/profile/api-endpoint",
    });
    expect(result.aws.map((step) => step.target)).toEqual(
      expect.arrayContaining([
        "acme-thinkwork-terraform-state",
        "acme-thinkwork-terraform-locks",
        "acme-thinkwork-release-artifacts",
        "thinkwork-dev-111122223333-deploy-evidence",
        "thinkwork-dev-deployment-orchestrator",
        "thinkwork-dev-deployment-runner",
        "/thinkwork/dev/deployment",
      ]),
    );
    expect(result.aws.map((step) => step.target).join("\n")).not.toContain(
      "token.actions.githubusercontent.com",
    );
  });

  it("rejects missing account and invalid slugs before naming resources", () => {
    expect(() =>
      buildEnterpriseBootstrapPlan(
        {
          targetDir: "/tmp/unused",
          customerSlug: "acme",
          stages: ["dev"],
          dryRun: true,
        },
        null,
      ),
    ).toThrow(/AWS account ID is required/);

    expect(() =>
      buildEnterpriseBootstrapPlan(
        {
          targetDir: "/tmp/unused",
          customerSlug: "Acme!",
          stages: ["dev"],
          accountId: "111122223333",
          region: "us-west-2",
          dryRun: true,
        },
        null,
      ),
    ).toThrow(/Invalid customer slug/);
  });
});
